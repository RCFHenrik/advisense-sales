import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Set, Tuple

from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, or_

from app.models.models import (
    Contact, Employee, OutreachRecord, OutreachStatusEnum,
    SuppressionEntry, Meeting, SystemConfig, ContactStatusEnum,
    HotTopic, ClassificationLookup, CoverageGap,
)
from app.core.config import settings
from app.services.scoring import ScoringService


class RecommendationService:
    """Consultant recommendation engine.

    Analyses contacts and proposes the best consultant for each,
    considering domain expertise, geography, seniority alignment,
    and duplicate prevention.

    Uses inverted indices for fast candidate lookup during bulk
    proposal generation.
    """

    def __init__(self, db: Session):
        self.db = db
        self.scoring = ScoringService(db)
        self._load_config()
        # Batch caches — populated by _preload_batch_data()
        self._employees_cache: Optional[List[Employee]] = None
        self._meetings_by_contact: Optional[Dict[int, List[Meeting]]] = None
        self._classifications_cache: Optional[Dict[tuple, ClassificationLookup]] = None
        self._pending_counts_by_employee: Optional[Dict[int, int]] = None
        self._cooldown_contact_ids: Optional[Set[int]] = None
        self._suppressed_contact_ids: Optional[Set[int]] = None
        self._pending_outreach_contact_ids: Optional[Set[int]] = None
        self._opt_out_1on1_ids: Optional[Set[int]] = None
        # Inverted indices: employee_id → set of candidate contact_ids
        self._idx_team: Optional[Dict[int, Set[int]]] = None
        self._idx_ba: Optional[Dict[int, Set[int]]] = None
        self._idx_geo: Optional[Dict[int, Set[int]]] = None
        self._idx_domain: Optional[Dict[int, Set[int]]] = None
        self._idx_meetings: Optional[Dict[int, Set[int]]] = None
        self._idx_classification: Optional[Dict[int, Set[int]]] = None
        self._idx_expert_area: Optional[Dict[int, Set[int]]] = None
        self._idx_relevance_tags: Optional[Dict[int, Set[int]]] = None
        # Contact lookup by id
        self._contacts_by_id: Optional[Dict[int, Contact]] = None
        # Pre-computed employee attributes
        self._emp_domain_tags: Optional[Dict[int, List[str]]] = None
        self._emp_relevance_tags: Optional[Dict[int, List[str]]] = None
        self._emp_seniority_level: Optional[Dict[int, int]] = None
        # Contact seniority cache
        self._contact_seniority: Optional[Dict[int, float]] = None
        # Classification per contact (pre-lowered)
        self._contact_classification: Optional[Dict[int, dict]] = None
        # Coverage gap map: normalized_company_name -> CoverageGap
        self._gap_map: Optional[Dict[str, "CoverageGap"]] = None

    def _load_config(self):
        self.cooldown_days_outreach = self._get_config_int(
            "cooldown_days_outreach", settings.DEFAULT_COOLDOWN_DAYS_OUTREACH
        )
        self.cooldown_days_activity = self._get_config_int(
            "cooldown_days_last_activity", settings.DEFAULT_COOLDOWN_DAYS_LAST_ACTIVITY
        )

    def _get_config_int(self, key: str, default: int) -> int:
        config = self.db.query(SystemConfig).filter(SystemConfig.key == key).first()
        if config:
            try:
                return int(config.value)
            except ValueError:
                pass
        return default

    # ── Batch preloading ─────────────────────────────────────────────────

    def _preload_batch_data(self, contacts: List[Contact], employees: List[Employee]) -> None:
        """Pre-load all data needed for scoring in bulk queries
        and build inverted indices for fast candidate lookup.

        This eliminates N+1 query problems and reduces the scoring
        from O(contacts × employees) to O(contacts + employees + matches).
        """
        now = datetime.now(timezone.utc)
        contact_ids = [c.id for c in contacts]

        self._employees_cache = employees
        self._contacts_by_id = {c.id: c for c in contacts}

        # 1. Load ALL meetings grouped by contact_id (with pre-lowered employee names)
        all_meetings = (
            self.db.query(Meeting)
            .filter(Meeting.contact_id.in_(contact_ids))
            .all()
        ) if contact_ids else []
        self._meetings_by_contact = defaultdict(list)
        self._meeting_names_by_contact: Dict[int, List[str]] = defaultdict(list)
        for m in all_meetings:
            self._meetings_by_contact[m.contact_id].append(m)
            self._meeting_names_by_contact[m.contact_id].append(
                (m.employee_name_corrected or m.employee_name or "").lower()
            )

        # 2. Load ALL classification lookups
        all_classifications = self.db.query(ClassificationLookup).all()
        self._classifications_cache = {}
        for cl in all_classifications:
            key = (cl.job_title, cl.client_group_domicile, cl.client_tier, cl.client_industry)
            self._classifications_cache[key] = cl

        # 3. Load pending outreach counts per employee
        pending_rows = (
            self.db.query(
                OutreachRecord.employee_id,
                func.count(OutreachRecord.id),
            )
            .filter(OutreachRecord.status.in_([
                OutreachStatusEnum.PROPOSED,
                OutreachStatusEnum.ACCEPTED,
                OutreachStatusEnum.DRAFT,
            ]))
            .group_by(OutreachRecord.employee_id)
            .all()
        )
        self._pending_counts_by_employee = {eid: cnt for eid, cnt in pending_rows}

        # 4. Pre-compute cooldown sets
        cutoff = now - timedelta(days=self.cooldown_days_outreach)

        cooldown_rows = (
            self.db.query(OutreachRecord.contact_id)
            .filter(
                OutreachRecord.contact_id.in_(contact_ids),
                OutreachRecord.status.in_([
                    OutreachStatusEnum.SENT,
                    OutreachStatusEnum.PREPARED,
                    OutreachStatusEnum.REPLIED,
                    OutreachStatusEnum.MEETING_BOOKED,
                    OutreachStatusEnum.CLOSED_MET,
                ]),
                OutreachRecord.sent_at >= cutoff,
            )
            .distinct()
            .all()
        ) if contact_ids else []
        self._cooldown_contact_ids = {row[0] for row in cooldown_rows}

        suppressed_rows = (
            self.db.query(SuppressionEntry.contact_id)
            .filter(
                SuppressionEntry.contact_id.in_(contact_ids),
                SuppressionEntry.is_active == True,
            )
            .all()
        ) if contact_ids else []
        self._suppressed_contact_ids = {row[0] for row in suppressed_rows}

        pending_contact_rows = (
            self.db.query(OutreachRecord.contact_id)
            .filter(
                OutreachRecord.contact_id.in_(contact_ids),
                OutreachRecord.status.in_([
                    OutreachStatusEnum.PROPOSED,
                    OutreachStatusEnum.ACCEPTED,
                    OutreachStatusEnum.DRAFT,
                    OutreachStatusEnum.PREPARED,
                ]),
            )
            .distinct()
            .all()
        ) if contact_ids else []
        self._pending_outreach_contact_ids = {row[0] for row in pending_contact_rows}

        # 4b. Pre-load opt-out (one-on-one) contact IDs
        opt_out_rows = (
            self.db.query(Contact.id)
            .filter(
                Contact.id.in_(contact_ids),
                Contact.opt_out_one_on_one == True,
            )
            .all()
        ) if contact_ids else []
        self._opt_out_1on1_ids = {row[0] for row in opt_out_rows}

        # 5. Filter to eligible contacts (not blocked by cooldown)
        blocked_ids = self._cooldown_contact_ids | self._suppressed_contact_ids | self._pending_outreach_contact_ids | self._opt_out_1on1_ids
        eligible_ids = {c.id for c in contacts} - blocked_ids

        # 6. Pre-compute employee attributes (all lowercased once)
        seniority_map = {"junior": 1, "mid": 2, "senior": 3, "principal": 4, "partner": 5}
        self._emp_seniority_level = {}
        self._emp_domain_tags = {}
        self._emp_attrs = {}  # emp_id → dict of pre-lowered attributes
        for emp in employees:
            self._emp_seniority_level[emp.id] = seniority_map.get(
                (emp.seniority or "").lower(), 2
            )
            if emp.domain_expertise_tags:
                try:
                    tags = json.loads(emp.domain_expertise_tags)
                except (json.JSONDecodeError, TypeError):
                    tags = [t.strip() for t in emp.domain_expertise_tags.split(",")]
                self._emp_domain_tags[emp.id] = [t.lower() for t in tags if t]
            else:
                self._emp_domain_tags[emp.id] = []
            # Parse relevance_tags
            if emp.relevance_tags:
                try:
                    rtags = json.loads(emp.relevance_tags)
                except (json.JSONDecodeError, TypeError):
                    rtags = [t.strip() for t in emp.relevance_tags.split(",")]
                self._emp_relevance_tags[emp.id] = [t.lower() for t in rtags if t]
            else:
                self._emp_relevance_tags[emp.id] = []
            # Pre-compute lowered attributes for fast scoring
            self._emp_attrs[emp.id] = {
                "name_lower": emp.name.lower() if emp.name else "",
                "team_lower": emp.team.name.lower() if emp.team and emp.team.name else "",
                "ba_lower": emp.business_area.name.lower() if emp.business_area and emp.business_area.name else "",
                "geo_lower": emp.site.country_code.lower() if emp.site and emp.site.country_code else "",
                "profile_lower": emp.profile_description.lower() if emp.profile_description else "",
                "has_profile": bool(emp.profile_description),
                "name_tokens": [t.lower() for t in emp.name.split()] if emp.name else [],
            }

        # 7. Pre-compute contact attributes (all lowercased once)
        self._contact_seniority = {}
        self._contact_attrs = {}  # contact_id → dict of pre-lowered attributes
        for c in contacts:
            if c.id in eligible_ids:
                self._contact_seniority[c.id] = self.scoring._estimate_seniority(c.job_title)
                # Pre-compute target words for profile matching
                target = " ".join(filter(None, [c.responsibility_domain, c.sector])).lower()
                target_words = frozenset(
                    w for raw in target.split()
                    if len((w := raw.strip(",.;:/()"))) > 3
                ) if target else frozenset()
                # Parse expert_areas JSON
                expert_tags: List[str] = []
                if c.expert_areas:
                    try:
                        _ea = json.loads(c.expert_areas)
                        expert_tags = [t.lower() for t in _ea if isinstance(t, str) and t]
                    except (json.JSONDecodeError, TypeError):
                        expert_tags = [t.strip().lower() for t in c.expert_areas.split(",") if t.strip()]

                # Parse relevance_tags JSON
                relevance_tags: List[str] = []
                if c.relevance_tags:
                    try:
                        _rt = json.loads(c.relevance_tags)
                        relevance_tags = [t.lower() for t in _rt if isinstance(t, str) and t]
                    except (json.JSONDecodeError, TypeError):
                        relevance_tags = [t.strip().lower() for t in c.relevance_tags.split(",") if t.strip()]

                self._contact_attrs[c.id] = {
                    "domain_lower": c.responsibility_domain.lower() if c.responsibility_domain else "",
                    "owner_team_lower": c.owner_team.lower() if c.owner_team else "",
                    "owner_ba_lower": c.owner_business_area.lower() if c.owner_business_area else "",
                    "geo_lower": c.group_domicile.lower() if c.group_domicile else "",
                    "target_words": target_words,
                    "has_domain": bool(c.responsibility_domain),
                    "has_owner_team": bool(c.owner_team),
                    "has_owner_ba": bool(c.owner_business_area),
                    "has_geo": bool(c.group_domicile),
                    "expert_tags": expert_tags,
                    "has_expert_tags": bool(expert_tags),
                    "relevance_tags": relevance_tags,
                    "has_relevance_tags": bool(relevance_tags),
                    "is_decision_maker": bool(getattr(c, "is_decision_maker", False)),
                }

        # 8. Pre-compute classification lookups per contact (with lowered strings)
        self._contact_classification = {}
        for c in contacts:
            if c.id in eligible_ids and c.job_title and c.group_domicile:
                cl = self._find_classification_cached(c)
                if cl:
                    self._contact_classification[c.id] = {
                        "reg1": cl.top_registrator_1.lower() if cl.top_registrator_1 else None,
                        "reg2": cl.top_registrator_2.lower() if cl.top_registrator_2 else None,
                        "team1": cl.top_team_1.lower() if cl.top_team_1 else None,
                        "team2": cl.top_team_2.lower() if cl.top_team_2 else None,
                        "ba1": cl.top_ba_1.lower() if cl.top_ba_1 else None,
                        "ba2": cl.top_ba_2.lower() if cl.top_ba_2 else None,
                    }

        # 9. Pre-load coverage gap data (for gap-fill bonus in scoring)
        all_gaps = self.db.query(CoverageGap).all()
        self._gap_map = {g.company_name_normalized: g for g in all_gaps}

        # ── Build inverted indices ──────────────────────────────────────
        # For each employee, pre-compute which contacts match on each dimension.
        # This lets generate_proposals_fast() only score actual candidates.

        # Index: team match (contact.owner_team == employee.team.name)
        contacts_by_team: Dict[str, Set[int]] = defaultdict(set)
        for c in contacts:
            if c.id in eligible_ids and c.owner_team:
                contacts_by_team[c.owner_team.lower()].add(c.id)

        self._idx_team = {}
        for emp in employees:
            if emp.team and emp.team.name:
                team_key = emp.team.name.lower()
                if team_key in contacts_by_team:
                    self._idx_team[emp.id] = contacts_by_team[team_key]

        # Index: BA match (contact.owner_business_area == employee.business_area.name)
        contacts_by_ba: Dict[str, Set[int]] = defaultdict(set)
        for c in contacts:
            if c.id in eligible_ids and c.owner_business_area:
                contacts_by_ba[c.owner_business_area.lower()].add(c.id)

        self._idx_ba = {}
        for emp in employees:
            if emp.business_area and emp.business_area.name:
                ba_key = emp.business_area.name.lower()
                if ba_key in contacts_by_ba:
                    self._idx_ba[emp.id] = contacts_by_ba[ba_key]

        # Index: geographic match (contact.group_domicile == employee.site.country_code)
        contacts_by_geo: Dict[str, Set[int]] = defaultdict(set)
        for c in contacts:
            if c.id in eligible_ids and c.group_domicile:
                contacts_by_geo[c.group_domicile.lower()].add(c.id)

        self._idx_geo = {}
        for emp in employees:
            if emp.site and emp.site.country_code:
                geo_key = emp.site.country_code.lower()
                if geo_key in contacts_by_geo:
                    self._idx_geo[emp.id] = contacts_by_geo[geo_key]

        # Index: domain match (contact.responsibility_domain ↔ employee.domain_expertise_tags)
        # Reverse approach: for each contact, find matching employees
        self._idx_domain = defaultdict(set)
        # Collect all unique employee tags
        all_emp_tags: List[Tuple[int, str]] = []  # (emp_id, tag_lower)
        for emp in employees:
            for tag in self._emp_domain_tags.get(emp.id, []):
                all_emp_tags.append((emp.id, tag))

        if all_emp_tags:
            for c in contacts:
                if c.id not in eligible_ids or not c.responsibility_domain:
                    continue
                domain_lower = c.responsibility_domain.lower()
                for emp_id, tag in all_emp_tags:
                    if tag in domain_lower or domain_lower in tag:
                        self._idx_domain[emp_id].add(c.id)
        self._idx_domain = dict(self._idx_domain)

        # Index: meetings (contacts that have had meetings with this employee)
        # Build employee name token → employee_id lookup (reverse index)
        emp_token_to_ids: Dict[str, Set[int]] = defaultdict(set)
        for emp in employees:
            if emp.name:
                for token in emp.name.lower().split():
                    if len(token) >= 2:  # skip very short tokens
                        emp_token_to_ids[token].add(emp.id)

        self._idx_meetings = defaultdict(set)
        for contact_id, meetings in self._meetings_by_contact.items():
            if contact_id not in eligible_ids:
                continue
            # Find which employees match any meeting name for this contact
            matched_emp_ids: Set[int] = set()
            for m in meetings:
                emp_name = (m.employee_name_corrected or m.employee_name or "").lower()
                for token, eids in emp_token_to_ids.items():
                    if token in emp_name:
                        matched_emp_ids |= eids
            for eid in matched_emp_ids:
                self._idx_meetings[eid].add(contact_id)
        self._idx_meetings = dict(self._idx_meetings)  # convert from defaultdict

        # Index: classification match (contacts whose classification references this employee)
        # Build reverse lookups: registrator_name → emp_ids, team_name → emp_ids, ba_name → emp_ids
        emp_by_name_token: Dict[str, Set[int]] = defaultdict(set)
        emp_by_team: Dict[str, Set[int]] = defaultdict(set)
        emp_by_ba: Dict[str, Set[int]] = defaultdict(set)
        for emp in employees:
            if emp.name:
                emp_by_name_token[emp.name.lower()].add(emp.id)
            if emp.team and emp.team.name:
                emp_by_team[emp.team.name.lower()].add(emp.id)
            if emp.business_area and emp.business_area.name:
                emp_by_ba[emp.business_area.name.lower()].add(emp.id)

        self._idx_classification = defaultdict(set)
        for c in contacts:
            if c.id not in eligible_ids or not c.job_title or not c.group_domicile:
                continue
            cl = self._find_classification_cached(c)
            if not cl:
                continue
            # Find employees that match this classification
            matched_emp_ids: Set[int] = set()
            for reg_name in [cl.top_registrator_1, cl.top_registrator_2]:
                if reg_name:
                    reg_lower = reg_name.lower()
                    for emp_name_lower, eids in emp_by_name_token.items():
                        if reg_lower in emp_name_lower:
                            matched_emp_ids |= eids
            for team_name in [cl.top_team_1, cl.top_team_2]:
                if team_name:
                    eids = emp_by_team.get(team_name.lower())
                    if eids:
                        matched_emp_ids |= eids
            for ba_name in [cl.top_ba_1, cl.top_ba_2]:
                if ba_name:
                    eids = emp_by_ba.get(ba_name.lower())
                    if eids:
                        matched_emp_ids |= eids
            for eid in matched_emp_ids:
                self._idx_classification[eid].add(c.id)
        self._idx_classification = dict(self._idx_classification)

        # Index: expert area match (contact.expert_areas ↔ employee.domain_expertise_tags)
        self._idx_expert_area = defaultdict(set)
        if all_emp_tags:
            for c in contacts:
                if c.id not in eligible_ids:
                    continue
                c_ea = self._contact_attrs.get(c.id, {}).get("expert_tags", [])
                if not c_ea:
                    continue
                for emp_id, emp_tag in all_emp_tags:
                    for ea_tag in c_ea:
                        if ea_tag in emp_tag or emp_tag in ea_tag:
                            self._idx_expert_area[emp_id].add(c.id)
                            break
        self._idx_expert_area = dict(self._idx_expert_area)

        # Index: relevance tag match (contact.relevance_tags <-> employee.relevance_tags)
        all_emp_rtags: List[Tuple[int, str]] = []
        for emp in employees:
            for tag in self._emp_relevance_tags.get(emp.id, []):
                all_emp_rtags.append((emp.id, tag))

        self._idx_relevance_tags = defaultdict(set)
        if all_emp_rtags:
            for c in contacts:
                if c.id not in eligible_ids:
                    continue
                c_rt = self._contact_attrs.get(c.id, {}).get("relevance_tags", [])
                if not c_rt:
                    continue
                for emp_id, emp_tag in all_emp_rtags:
                    for rt_tag in c_rt:
                        if rt_tag == emp_tag or rt_tag in emp_tag or emp_tag in rt_tag:
                            self._idx_relevance_tags[emp_id].add(c.id)
                            break
        self._idx_relevance_tags = dict(self._idx_relevance_tags)

    def _clear_caches(self):
        """Clear all batch caches and indices."""
        self._employees_cache = None
        self._meetings_by_contact = None
        self._classifications_cache = None
        self._pending_counts_by_employee = None
        self._cooldown_contact_ids = None
        self._suppressed_contact_ids = None
        self._pending_outreach_contact_ids = None
        self._opt_out_1on1_ids = None
        self._idx_team = None
        self._idx_ba = None
        self._idx_geo = None
        self._idx_domain = None
        self._idx_meetings = None
        self._idx_classification = None
        self._idx_expert_area = None
        self._idx_relevance_tags = None
        self._contacts_by_id = None
        self._emp_domain_tags = None
        self._emp_relevance_tags = None
        self._emp_seniority_level = None
        self._contact_seniority = None
        self._contact_classification = None
        self._emp_attrs = None
        self._contact_attrs = None
        self._meeting_names_by_contact = None

    # ── Cooldown check ───────────────────────────────────────────────────

    def check_cooldown(self, contact: Contact) -> Tuple[bool, Optional[str]]:
        """Check if a contact is in cooldown. Returns (blocked, reason)."""
        if self._cooldown_contact_ids is not None:
            return self._check_cooldown_cached(contact)
        return self._check_cooldown_query(contact)

    def _check_cooldown_cached(self, contact: Contact) -> Tuple[bool, Optional[str]]:
        """Fast cooldown check using pre-loaded sets."""
        if contact.id in self._cooldown_contact_ids:
            return True, f"Outreach sent within last {self.cooldown_days_outreach} days"
        if contact.id in self._suppressed_contact_ids:
            return True, "Contact is on suppression list"
        if contact.id in self._pending_outreach_contact_ids:
            return True, "Active outreach already in progress"
        if self._opt_out_1on1_ids and contact.id in self._opt_out_1on1_ids:
            return True, "Contact opted out of one-on-one emails"
        return False, None

    def _check_cooldown_query(self, contact: Contact) -> Tuple[bool, Optional[str]]:
        """Original per-query cooldown check for single-contact use."""
        now = datetime.now(timezone.utc)
        recent_outreach = (
            self.db.query(OutreachRecord)
            .filter(
                OutreachRecord.contact_id == contact.id,
                OutreachRecord.status.in_([
                    OutreachStatusEnum.SENT,
                    OutreachStatusEnum.PREPARED,
                    OutreachStatusEnum.REPLIED,
                    OutreachStatusEnum.MEETING_BOOKED,
                    OutreachStatusEnum.CLOSED_MET,
                ]),
                OutreachRecord.sent_at >= now - timedelta(days=self.cooldown_days_outreach),
            )
            .first()
        )
        if recent_outreach:
            return True, f"Outreach sent within last {self.cooldown_days_outreach} days (sent {recent_outreach.sent_at})"

        if contact.last_activity_date:
            last_activity = contact.last_activity_date
            if last_activity.tzinfo is None:
                last_activity = last_activity.replace(tzinfo=timezone.utc)

        suppressed = (
            self.db.query(SuppressionEntry)
            .filter(SuppressionEntry.contact_id == contact.id, SuppressionEntry.is_active == True)
            .first()
        )
        if suppressed:
            return True, "Contact is on suppression list"

        pending = (
            self.db.query(OutreachRecord)
            .filter(
                OutreachRecord.contact_id == contact.id,
                OutreachRecord.status.in_([
                    OutreachStatusEnum.PROPOSED,
                    OutreachStatusEnum.ACCEPTED,
                    OutreachStatusEnum.DRAFT,
                    OutreachStatusEnum.PREPARED,
                ]),
            )
            .first()
        )
        if pending:
            return True, f"Active outreach already in progress (status: {pending.status.value})"

        if getattr(contact, "opt_out_one_on_one", False):
            return True, "Contact opted out of one-on-one emails"

        return False, None

    # ── Single-contact recommendation (for detail pages etc.) ────────────

    def recommend_consultant(self, contact: Contact) -> List[dict]:
        """Rank consultants for a given contact.

        Returns list of {employee, score, reasons} sorted by match score.
        """
        employees = self._employees_cache
        if employees is None:
            employees = (
                self.db.query(Employee)
                .filter(Employee.is_active == True)
                .options(
                    joinedload(Employee.team),
                    joinedload(Employee.business_area),
                    joinedload(Employee.site),
                )
                .all()
            )

        scored = []
        for emp in employees:
            score, reasons = self._match_score(contact, emp)
            if score > 0:
                scored.append({"employee": emp, "score": score, "reasons": reasons})

        scored.sort(key=lambda x: x["score"], reverse=True)
        return scored[:5]

    # ── Fast bulk scoring using inverted indices ─────────────────────────

    def _get_candidates_for_employee(self, emp_id: int) -> Set[int]:
        """Get the union of all contacts that match this employee
        on at least one scoring dimension."""
        candidates: Set[int] = set()
        if self._idx_team and emp_id in self._idx_team:
            candidates |= self._idx_team[emp_id]
        if self._idx_ba and emp_id in self._idx_ba:
            candidates |= self._idx_ba[emp_id]
        if self._idx_geo and emp_id in self._idx_geo:
            candidates |= self._idx_geo[emp_id]
        if self._idx_domain and emp_id in self._idx_domain:
            candidates |= self._idx_domain[emp_id]
        if self._idx_meetings and emp_id in self._idx_meetings:
            candidates |= self._idx_meetings[emp_id]
        if self._idx_classification and emp_id in self._idx_classification:
            candidates |= self._idx_classification[emp_id]
        if self._idx_expert_area and emp_id in self._idx_expert_area:
            candidates |= self._idx_expert_area[emp_id]
        if self._idx_relevance_tags and emp_id in self._idx_relevance_tags:
            candidates |= self._idx_relevance_tags[emp_id]
        return candidates

    def _match_score_fast(self, contact_id: int, emp_id: int, employee: Employee) -> Tuple[float, List[str]]:
        """Optimized match scoring using pre-computed caches.

        Uses pre-lowered attributes to avoid any .lower() calls in the hot loop.
        """
        score = 0.0
        reasons = []

        ea = self._emp_attrs[emp_id]
        ca = self._contact_attrs[contact_id]

        # Domain expertise match
        tags = self._emp_domain_tags.get(emp_id)
        if tags and ca["has_domain"]:
            domain_lower = ca["domain_lower"]
            for tag in tags:
                if tag in domain_lower or domain_lower in tag:
                    score += 30
                    reasons.append(f"Domain match: {tag}")
                    break

        # Team/BA match
        if ca["has_owner_team"] and ea["team_lower"]:
            if ca["owner_team_lower"] == ea["team_lower"]:
                score += 20
                reasons.append("Team match")
        elif ca["has_owner_ba"] and ea["ba_lower"]:
            if ca["owner_ba_lower"] == ea["ba_lower"]:
                score += 15
                reasons.append("Business area match")

        # Geographic proximity
        if ca["has_geo"] and ea["geo_lower"]:
            if ca["geo_lower"] == ea["geo_lower"]:
                score += 15
                reasons.append("Geographic match")

        # Seniority alignment
        emp_seniority = self._emp_seniority_level[emp_id]
        contact_seniority = self._contact_seniority.get(contact_id, 0.3)

        if contact_seniority >= 0.8 and emp_seniority >= 4:
            score += 15
            reasons.append("Senior-to-senior alignment")
        elif contact_seniority >= 0.6 and emp_seniority >= 3:
            score += 10
            reasons.append("Seniority alignment")
        elif abs(contact_seniority * 5 - emp_seniority) <= 1:
            score += 5
            reasons.append("Approximate seniority match")

        # Previous relationship bonus (using pre-lowered meeting names)
        meeting_names = self._meeting_names_by_contact.get(contact_id)
        if meeting_names:
            name_tokens = ea["name_tokens"]
            if name_tokens:
                count = 0
                for emp_name in meeting_names:
                    if any(token in emp_name for token in name_tokens):
                        count += 1
                if count > 0:
                    if count == 1:
                        meeting_bonus = 15
                    elif count == 2:
                        meeting_bonus = 25
                    else:
                        meeting_bonus = 35
                    meeting_bonus = min(meeting_bonus, 40)
                    score += meeting_bonus
                    reasons.append(f"Previous meetings: {count} (+{int(meeting_bonus)} pts)")

        # Classification data match (using pre-lowered cache)
        cl_data = self._contact_classification.get(contact_id)
        if cl_data:
            enl = ea["name_lower"]
            etl = ea["team_lower"]
            ebl = ea["ba_lower"]

            if cl_data["reg1"] and cl_data["reg1"] in enl:
                score += 25
                reasons.append("Top registrator for this profile (+25 pts)")
            elif cl_data["reg2"] and cl_data["reg2"] in enl:
                score += 15
                reasons.append("2nd registrator for this profile (+15 pts)")

            if cl_data["team1"] and cl_data["team1"] == etl:
                score += 10
                reasons.append("Top team for this profile (+10 pts)")
            elif cl_data["team2"] and cl_data["team2"] == etl:
                score += 5
                reasons.append("2nd team for this profile (+5 pts)")

            if cl_data["ba1"] and cl_data["ba1"] == ebl:
                score += 10
                reasons.append("Top BA for this profile (+10 pts)")
            elif cl_data["ba2"] and cl_data["ba2"] == ebl:
                score += 5
                reasons.append("2nd BA for this profile (+5 pts)")

        # Profile description keyword match
        target_words = ca["target_words"]
        if ea["has_profile"] and target_words:
            profile_lower = ea["profile_lower"]
            matched = [w for w in target_words if w in profile_lower]
            if matched:
                profile_bonus = min(len(matched) * 5, 20)
                score += profile_bonus
                reasons.append(f"Profile match: {', '.join(list(matched)[:3])} (+{int(profile_bonus)} pts)")

        # Expert area match (contact.expert_areas ↔ employee.domain_expertise_tags)
        c_ea = ca.get("expert_tags", [])
        if tags and c_ea:
            for tag in tags:
                for ea_tag in c_ea:
                    if tag in ea_tag or ea_tag in tag:
                        score += 20
                        reasons.append(f"Expert area match: {ea_tag} (+20 pts)")
                        break
                else:
                    continue
                break

        # Relevance tag match (contact.relevance_tags <-> employee.relevance_tags)
        emp_rtags = self._emp_relevance_tags.get(emp_id, [])
        c_rt = ca.get("relevance_tags", [])
        if emp_rtags and c_rt:
            matched_rt = []
            for emp_tag in emp_rtags:
                for rt_tag in c_rt:
                    if rt_tag == emp_tag or rt_tag in emp_tag or emp_tag in rt_tag:
                        matched_rt.append(rt_tag)
                        break
            if matched_rt:
                rt_bonus = min(len(matched_rt) * 10, 40)
                score += rt_bonus
                reasons.append(f"Relevance tag match: {', '.join(matched_rt[:3])} (+{int(rt_bonus)} pts)")

        # Decision maker bonus
        if ca.get("is_decision_maker"):
            score += 10
            reasons.append("Decision maker (+10 pts)")

        # Workload balance
        pending_count = self._pending_counts_by_employee.get(emp_id, 0)
        if pending_count < employee.outreach_target_per_week:
            score += 5
            reasons.append("Below target workload")

        # Coverage gap fill bonus
        if self._gap_map and contact.company_name and contact.responsibility_domain:
            import json as _json
            gap = self._gap_map.get(contact.company_name.lower().strip())
            if gap:
                domain_lower = contact.responsibility_domain.lower()
                try:
                    crit_domains = _json.loads(gap.missing_domains_critical) if gap.missing_domains_critical else []
                except (ValueError, TypeError):
                    crit_domains = []
                try:
                    crit_titles = _json.loads(gap.missing_titles_critical) if gap.missing_titles_critical else []
                except (ValueError, TypeError):
                    crit_titles = []
                fills_critical = (
                    any(d.lower() in domain_lower or domain_lower in d.lower() for d in crit_domains)
                    or any(t.lower() in domain_lower or domain_lower in t.lower() for t in crit_titles)
                )
                if fills_critical:
                    score += 10
                    reasons.append("Fills critical coverage gap (+10 pts)")

        return score, reasons

    # ── Original _match_score (for single-contact use) ───────────────────

    def _match_score(self, contact: Contact, employee: Employee) -> Tuple[float, List[str]]:
        score = 0.0
        reasons = []

        # Domain expertise match
        if employee.domain_expertise_tags and contact.responsibility_domain:
            try:
                tags = json.loads(employee.domain_expertise_tags)
            except (json.JSONDecodeError, TypeError):
                tags = [t.strip() for t in employee.domain_expertise_tags.split(",")]
            domain_lower = contact.responsibility_domain.lower()
            for tag in tags:
                if tag.lower() in domain_lower or domain_lower in tag.lower():
                    score += 30
                    reasons.append(f"Domain match: {tag}")
                    break

        # Team/BA match
        if contact.owner_team and employee.team:
            if contact.owner_team.lower() == employee.team.name.lower():
                score += 20
                reasons.append("Team match")
        elif contact.owner_business_area and employee.business_area:
            if contact.owner_business_area.lower() == employee.business_area.name.lower():
                score += 15
                reasons.append("Business area match")

        # Geographic proximity
        if contact.group_domicile and employee.site:
            if contact.group_domicile.lower() == employee.site.country_code.lower():
                score += 15
                reasons.append("Geographic match")

        # Seniority alignment
        seniority_map = {"junior": 1, "mid": 2, "senior": 3, "principal": 4, "partner": 5}
        emp_seniority = seniority_map.get((employee.seniority or "").lower(), 2)
        contact_seniority = self.scoring._estimate_seniority(contact.job_title)
        if contact_seniority >= 0.8 and emp_seniority >= 4:
            score += 15
            reasons.append("Senior-to-senior alignment")
        elif contact_seniority >= 0.6 and emp_seniority >= 3:
            score += 10
            reasons.append("Seniority alignment")
        elif abs(contact_seniority * 5 - emp_seniority) <= 1:
            score += 5
            reasons.append("Approximate seniority match")

        # Previous relationship bonus
        if self._meetings_by_contact is not None:
            previous_meetings = self._count_meetings_cached(contact.id, employee)
        else:
            previous_meetings = self._count_meetings_query(contact.id, employee)
        if previous_meetings > 0:
            if previous_meetings == 1:
                meeting_bonus = 15
            elif previous_meetings == 2:
                meeting_bonus = 25
            else:
                meeting_bonus = 35
            meeting_bonus = min(meeting_bonus, 40)
            score += meeting_bonus
            reasons.append(f"Previous meetings: {previous_meetings} (+{int(meeting_bonus)} pts)")

        # Classification data match
        if contact.job_title and contact.group_domicile:
            cl = self._find_classification(contact)
            if cl:
                emp_name_lower = employee.name.lower() if employee.name else ""
                emp_team = employee.team.name.lower() if employee.team else ""
                emp_ba = employee.business_area.name.lower() if employee.business_area else ""
                if cl.top_registrator_1 and cl.top_registrator_1.lower() in emp_name_lower:
                    score += 25
                    reasons.append("Top registrator for this profile (+25 pts)")
                elif cl.top_registrator_2 and cl.top_registrator_2.lower() in emp_name_lower:
                    score += 15
                    reasons.append("2nd registrator for this profile (+15 pts)")
                if cl.top_team_1 and cl.top_team_1.lower() == emp_team:
                    score += 10
                    reasons.append("Top team for this profile (+10 pts)")
                elif cl.top_team_2 and cl.top_team_2.lower() == emp_team:
                    score += 5
                    reasons.append("2nd team for this profile (+5 pts)")
                if cl.top_ba_1 and cl.top_ba_1.lower() == emp_ba:
                    score += 10
                    reasons.append("Top BA for this profile (+10 pts)")
                elif cl.top_ba_2 and cl.top_ba_2.lower() == emp_ba:
                    score += 5
                    reasons.append("2nd BA for this profile (+5 pts)")

        # Expert area match (contact.expert_areas ↔ employee.domain_expertise_tags)
        if employee.domain_expertise_tags and contact.expert_areas:
            try:
                emp_tags = json.loads(employee.domain_expertise_tags)
            except (json.JSONDecodeError, TypeError):
                emp_tags = [t.strip() for t in employee.domain_expertise_tags.split(",")]
            try:
                contact_eas = json.loads(contact.expert_areas)
            except (json.JSONDecodeError, TypeError):
                contact_eas = [t.strip() for t in contact.expert_areas.split(",")]
            for etag in emp_tags:
                for cea in contact_eas:
                    if etag.lower() in cea.lower() or cea.lower() in etag.lower():
                        score += 20
                        reasons.append(f"Expert area match: {cea} (+20 pts)")
                        break
                else:
                    continue
                break

        # Decision maker bonus
        if getattr(contact, "is_decision_maker", False):
            score += 10
            reasons.append("Decision maker (+10 pts)")

        # Profile description keyword match
        if employee.profile_description and (contact.responsibility_domain or contact.sector):
            desc_lower = employee.profile_description.lower()
            target = " ".join(filter(None, [contact.responsibility_domain, contact.sector])).lower()
            target_words = {w.strip(",.;:/()") for w in target.split() if len(w.strip(",.;:/()")) > 3}
            matched = [w for w in target_words if w in desc_lower]
            if matched:
                profile_bonus = min(len(matched) * 5, 20)
                score += profile_bonus
                reasons.append(f"Profile match: {', '.join(list(matched)[:3])} (+{int(profile_bonus)} pts)")

        # Coverage gap fill bonus
        if contact.company_name and contact.responsibility_domain:
            import json as _json
            if self._gap_map is None:
                all_gaps = self.db.query(CoverageGap).all()
                self._gap_map = {g.company_name_normalized: g for g in all_gaps}
            gap = self._gap_map.get(contact.company_name.lower().strip())
            if gap:
                domain_lower = contact.responsibility_domain.lower()
                try:
                    crit_domains = _json.loads(gap.missing_domains_critical) if gap.missing_domains_critical else []
                except (ValueError, TypeError):
                    crit_domains = []
                try:
                    crit_titles = _json.loads(gap.missing_titles_critical) if gap.missing_titles_critical else []
                except (ValueError, TypeError):
                    crit_titles = []
                fills_critical = (
                    any(d.lower() in domain_lower or domain_lower in d.lower() for d in crit_domains)
                    or any(t.lower() in domain_lower or domain_lower in t.lower() for t in crit_titles)
                )
                if fills_critical:
                    score += 10
                    reasons.append("Fills critical coverage gap (+10 pts)")

        # Workload balance
        if self._pending_counts_by_employee is not None:
            pending_count = self._pending_counts_by_employee.get(employee.id, 0)
        else:
            pending_count = (
                self.db.query(OutreachRecord)
                .filter(
                    OutreachRecord.employee_id == employee.id,
                    OutreachRecord.status.in_([
                        OutreachStatusEnum.PROPOSED,
                        OutreachStatusEnum.ACCEPTED,
                        OutreachStatusEnum.DRAFT,
                    ]),
                )
                .count()
            )
        if pending_count < employee.outreach_target_per_week:
            score += 5
            reasons.append("Below target workload")

        return score, reasons

    def _count_meetings_cached(self, contact_id: int, employee: Employee) -> int:
        """Count meetings between a contact and employee using cached data."""
        meetings = self._meetings_by_contact.get(contact_id, [])
        if not meetings or not employee.name:
            return 0
        name_tokens = [t.lower() for t in employee.name.split()]
        count = 0
        for m in meetings:
            emp_name = (m.employee_name_corrected or m.employee_name or "").lower()
            if any(token in emp_name for token in name_tokens):
                count += 1
        return count

    def _count_meetings_query(self, contact_id: int, employee: Employee) -> int:
        """Count meetings between a contact and employee via DB query."""
        name_tokens = employee.name.split() if employee.name else []
        name_filters = []
        for token in name_tokens:
            like = f"%{token}%"
            name_filters.append(Meeting.employee_name_corrected.ilike(like))
            name_filters.append(Meeting.employee_name.ilike(like))
        if not name_filters:
            return 0
        return (
            self.db.query(Meeting)
            .filter(Meeting.contact_id == contact_id, or_(*name_filters))
            .count()
        )

    def _find_classification(self, contact: Contact) -> Optional[ClassificationLookup]:
        """Find best classification match for a contact."""
        if self._classifications_cache is not None:
            return self._find_classification_cached(contact)
        return self._find_classification_query(contact)

    def _find_classification_cached(self, contact: Contact) -> Optional[ClassificationLookup]:
        """Find classification from in-memory cache."""
        jt = contact.job_title
        gd = contact.group_domicile
        tier = contact.client_tier
        sector = contact.sector

        key = (jt, gd, tier, sector)
        cl = self._classifications_cache.get(key)
        if cl:
            return cl
        if sector:
            cl = self._classifications_cache.get((jt, gd, tier, None))
            if cl:
                return cl
        if tier:
            cl = self._classifications_cache.get((jt, gd, None, sector))
            if cl:
                return cl
        return self._classifications_cache.get((jt, gd, None, None))

    def _find_classification_query(self, contact: Contact) -> Optional[ClassificationLookup]:
        """Find classification via DB query (original behavior)."""
        classification = (
            self.db.query(ClassificationLookup)
            .filter(
                ClassificationLookup.job_title == contact.job_title,
                ClassificationLookup.client_group_domicile == contact.group_domicile,
            )
        )
        if contact.client_tier:
            classification = classification.filter(
                ClassificationLookup.client_tier == contact.client_tier,
            )
        if contact.sector:
            classification = classification.filter(
                ClassificationLookup.client_industry == contact.sector,
            )
        return classification.first()

    # ── Proposal generation ──────────────────────────────────────────────

    def generate_proposals(self, limit: int = 0) -> dict:
        """Generate outreach proposals with a per-consultant cap.

        Uses inverted indices to avoid scoring every contact against
        every consultant. Instead, for each consultant we only score
        contacts that match on at least one dimension.

        Strategy:
        1. Pre-load all data + build inverted indices
        2. For each consultant with remaining capacity:
           - Get candidate contacts via index union
           - Score only those candidates
           - Pick the best ones (up to remaining capacity)
        3. Ensure each contact is assigned at most once

        Returns a summary dict with created proposals and statistics.
        """
        per_consultant_cap = self._get_config_int("outreach_proposals_per_consultant", 15)

        # Score all contacts first (priority scoring)
        self.scoring.score_all_contacts()

        # Count existing pending outreach per consultant
        pending_rows = (
            self.db.query(
                OutreachRecord.employee_id,
                func.count(OutreachRecord.id),
            )
            .filter(OutreachRecord.status.in_([
                OutreachStatusEnum.PROPOSED,
                OutreachStatusEnum.ACCEPTED,
                OutreachStatusEnum.DRAFT,
            ]))
            .group_by(OutreachRecord.employee_id)
            .all()
        )
        consultant_pending: dict[int, int] = {eid: cnt for eid, cnt in pending_rows}

        # Get all active consultants
        active_employees = (
            self.db.query(Employee)
            .filter(Employee.is_active == True)
            .options(
                joinedload(Employee.team),
                joinedload(Employee.business_area),
                joinedload(Employee.site),
            )
            .all()
        )

        # Determine remaining capacity per consultant
        consultant_remaining: dict[int, int] = {}
        for emp in active_employees:
            existing = consultant_pending.get(emp.id, 0)
            remaining = max(0, per_consultant_cap - existing)
            if remaining > 0:
                consultant_remaining[emp.id] = remaining

        if not consultant_remaining:
            return {
                "created": [],
                "total_created": 0,
                "consultants_used": 0,
                "contacts_evaluated": 0,
                "contacts_skipped_cooldown": 0,
                "contacts_skipped_no_match": 0,
                "per_consultant_cap": per_consultant_cap,
            }

        # Get eligible contacts ordered by priority
        max_scan = max(2000, sum(consultant_remaining.values()) * 3)
        contacts = (
            self.db.query(Contact)
            .filter(Contact.status == ContactStatusEnum.ACTIVE)
            .order_by(Contact.is_pinned.desc(), Contact.priority_score.desc().nullslast())
            .limit(max_scan)
            .all()
        )

        # ── Batch preload + build inverted indices ──
        self._preload_batch_data(contacts, active_employees)

        # Filter to only consultants with capacity
        employees_with_capacity = [e for e in active_employees if e.id in consultant_remaining]
        employee_by_id = {e.id: e for e in active_employees}

        # Track which contacts have already been assigned
        assigned_contact_ids: Set[int] = set()
        blocked_ids = self._cooldown_contact_ids | self._suppressed_contact_ids | self._pending_outreach_contact_ids

        # Build priority-ordered contact id list (for tie-breaking)
        contact_priority = {c.id: (c.is_pinned or False, c.priority_score or 0.0) for c in contacts}

        created = []
        consultant_new: dict[int, int] = {}
        skipped_cooldown = len(blocked_ids)

        # ── Main loop: iterate consultants, find best contacts ──
        # Sort consultants so those with least existing pending go first
        # (gives fairer distribution)
        employees_with_capacity.sort(
            key=lambda e: consultant_pending.get(e.id, 0)
        )

        for emp in employees_with_capacity:
            remaining = consultant_remaining.get(emp.id, 0)
            if remaining <= 0:
                continue

            # Check global limit
            if limit > 0 and len(created) >= limit:
                break

            # Get candidate contacts for this employee via inverted indices
            candidates = self._get_candidates_for_employee(emp.id)

            # Remove already-assigned and blocked contacts
            candidates = candidates - assigned_contact_ids - blocked_ids

            if not candidates:
                continue

            # Score each candidate
            scored_candidates = []
            for cid in candidates:
                if cid not in self._contact_attrs:
                    continue
                sc, reasons = self._match_score_fast(cid, emp.id, emp)
                if sc > 0:
                    # Use priority as tiebreaker
                    pinned, priority = contact_priority.get(cid, (False, 0.0))
                    contact = self._contacts_by_id[cid]
                    scored_candidates.append((sc, pinned, priority, contact, reasons))

            # Sort by score desc, then pinned desc, then priority desc
            scored_candidates.sort(key=lambda x: (x[0], x[1], x[2]), reverse=True)

            # Take top N (up to remaining capacity)
            assigned_count = 0
            for sc, pinned, priority, contact, reasons in scored_candidates:
                if assigned_count >= remaining:
                    break
                if limit > 0 and len(created) >= limit:
                    break
                if contact.id in assigned_contact_ids:
                    continue  # might have been assigned by another consultant in this loop

                record = OutreachRecord(
                    contact_id=contact.id,
                    employee_id=emp.id,
                    status=OutreachStatusEnum.PROPOSED,
                    recommendation_score=sc,
                    recommendation_reason="; ".join(reasons),
                )
                self.db.add(record)
                created.append({
                    "contact": contact,
                    "employee": emp,
                    "score": sc,
                    "reasons": reasons,
                })

                assigned_contact_ids.add(contact.id)
                assigned_count += 1

            if assigned_count > 0:
                consultant_new[emp.id] = assigned_count

        self.db.commit()
        self._clear_caches()

        return {
            "created": created,
            "total_created": len(created),
            "consultants_used": len(consultant_new),
            "contacts_evaluated": len(contacts),
            "contacts_skipped_cooldown": skipped_cooldown,
            "contacts_skipped_no_match": len(contacts) - skipped_cooldown - len(assigned_contact_ids),
            "per_consultant_cap": per_consultant_cap,
        }
