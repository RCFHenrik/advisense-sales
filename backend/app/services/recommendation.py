import json
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session
from sqlalchemy import func, or_

from app.models.models import (
    Contact, Employee, OutreachRecord, OutreachStatusEnum,
    SuppressionEntry, Meeting, SystemConfig, ContactStatusEnum,
    HotTopic,
)
from app.core.config import settings
from app.services.scoring import ScoringService


class RecommendationService:
    """Consultant recommendation engine.

    Analyses contacts and proposes the best consultant for each,
    considering domain expertise, geography, seniority alignment,
    and duplicate prevention.
    """

    def __init__(self, db: Session):
        self.db = db
        self.scoring = ScoringService(db)
        self._load_config()

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

    def check_cooldown(self, contact: Contact) -> Tuple[bool, Optional[str]]:
        """Check if a contact is in cooldown. Returns (blocked, reason)."""
        now = datetime.now(timezone.utc)

        # Check outreach cooldown
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

        # Check last activity cooldown
        if contact.last_activity_date:
            last_activity = contact.last_activity_date
            # SQLite stores datetimes without timezone; make it UTC-aware for comparison
            if last_activity.tzinfo is None:
                last_activity = last_activity.replace(tzinfo=timezone.utc)
            days_since = (now - last_activity).days
            if days_since < self.cooldown_days_activity:
                # Activity is recent — this is actually good for contact but we check configurable threshold
                pass

        # Check suppression
        suppressed = (
            self.db.query(SuppressionEntry)
            .filter(SuppressionEntry.contact_id == contact.id, SuppressionEntry.is_active == True)
            .first()
        )
        if suppressed:
            return True, "Contact is on suppression list"

        # Check pending outreach
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

        return False, None

    def recommend_consultant(self, contact: Contact) -> List[dict]:
        """Rank consultants for a given contact.

        Returns list of {employee, score, reasons} sorted by match score.
        """
        employees = (
            self.db.query(Employee)
            .filter(Employee.is_active == True)
            .all()
        )

        scored = []
        for emp in employees:
            score, reasons = self._match_score(contact, emp)
            if score > 0:
                scored.append({"employee": emp, "score": score, "reasons": reasons})

        scored.sort(key=lambda x: x["score"], reverse=True)
        return scored[:5]

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

        # Previous relationship bonus (tiered by meeting count)
        name_tokens = employee.name.split()
        name_filters = []
        for token in name_tokens:
            like = f"%{token}%"
            name_filters.append(Meeting.employee_name_corrected.ilike(like))
            name_filters.append(Meeting.employee_name.ilike(like))

        previous_meetings = (
            self.db.query(Meeting)
            .filter(Meeting.contact_id == contact.id, or_(*name_filters))
            .count()
        ) if name_filters else 0

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

        # Workload balance (fewer pending outreach = higher score)
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

    def generate_proposals(self, limit: int = 50) -> List[dict]:
        """Generate outreach proposals for eligible contacts.

        Returns list of created outreach records.
        """
        # Score all contacts first
        self.scoring.score_all_contacts()

        # Get eligible contacts ordered by priority
        contacts = (
            self.db.query(Contact)
            .filter(Contact.status == ContactStatusEnum.ACTIVE)
            .order_by(Contact.is_pinned.desc(), Contact.priority_score.desc().nullslast())
            .limit(limit * 2)  # Get more than needed to account for cooldowns
            .all()
        )

        created = []
        for contact in contacts:
            if len(created) >= limit:
                break

            blocked, reason = self.check_cooldown(contact)
            if blocked:
                continue

            recommendations = self.recommend_consultant(contact)
            if not recommendations:
                continue

            best = recommendations[0]
            record = OutreachRecord(
                contact_id=contact.id,
                employee_id=best["employee"].id,
                status=OutreachStatusEnum.PROPOSED,
                recommendation_score=best["score"],
                recommendation_reason="; ".join(best["reasons"]),
            )
            self.db.add(record)
            created.append({
                "contact": contact,
                "employee": best["employee"],
                "score": best["score"],
                "reasons": best["reasons"],
            })

        self.db.commit()
        return created
