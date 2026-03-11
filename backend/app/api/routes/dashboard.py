from datetime import datetime, timedelta, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, case
from app.core.filter_utils import apply_multi_filter

from app.core.database import get_db
from app.core.auth import get_current_user, require_role
from app.models.models import (
    OutreachRecord, OutreachStatusEnum, Contact, Employee, Negation,
    RoleEnum, Meeting, Team, BusinessArea,
    Campaign, CampaignRecipient, CampaignRecipientStatusEnum,
    CoverageGap,
)
from app.schemas.schemas import DashboardStats

router = APIRouter()


def _get_employee_scope(db: Session, current_user: Employee) -> Optional[List[int]]:
    """Return the list of employee IDs visible to current_user, or None for admin (unrestricted).

    Hierarchy rules (strictly downward — managers never see peers/superiors):
      ADMIN         → unrestricted (returns None)
      BA_MANAGER    → consultants + team_managers in their BA  (+ themselves)
      TEAM_MANAGER  → consultants in their team                (+ themselves)
      CONSULTANT    → only themselves
    """
    if current_user.role == RoleEnum.ADMIN:
        return None  # sees everything

    elif current_user.role == RoleEnum.BA_MANAGER:
        ids = [r[0] for r in db.query(Employee.id).filter(
            Employee.business_area_id == current_user.business_area_id,
            Employee.role.in_([RoleEnum.CONSULTANT, RoleEnum.TEAM_MANAGER]),
        ).all()]
        if current_user.id not in ids:
            ids.append(current_user.id)
        return ids

    elif current_user.role == RoleEnum.TEAM_MANAGER:
        ids = [r[0] for r in db.query(Employee.id).filter(
            Employee.team_id == current_user.team_id,
            Employee.role == RoleEnum.CONSULTANT,
        ).all()]
        if current_user.id not in ids:
            ids.append(current_user.id)
        return ids

    else:  # CONSULTANT
        return [current_user.id]


@router.get("/stats", response_model=DashboardStats)
def get_dashboard_stats(
    business_area_id: Optional[int] = None,
    team_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    total_contacts = db.query(Contact).count()
    active_contacts = db.query(Contact).filter(Contact.status == "active").count()

    scope = _get_employee_scope(db, current_user)
    outreach_query = db.query(OutreachRecord)
    if scope is not None:
        outreach_query = outreach_query.filter(OutreachRecord.employee_id.in_(scope))
    elif business_area_id:
        outreach_query = outreach_query.join(Employee).filter(Employee.business_area_id == business_area_id)
    elif team_id:
        outreach_query = outreach_query.join(Employee).filter(Employee.team_id == team_id)

    total_week = outreach_query.filter(OutreachRecord.created_at >= week_ago).count()
    total_month = outreach_query.filter(OutreachRecord.created_at >= month_ago).count()

    pending = outreach_query.filter(OutreachRecord.status == OutreachStatusEnum.PROPOSED).count()

    sent_week = outreach_query.filter(
        OutreachRecord.sent_at >= week_ago,
        OutreachRecord.status.in_([
            OutreachStatusEnum.SENT, OutreachStatusEnum.PREPARED,
            OutreachStatusEnum.REPLIED, OutreachStatusEnum.MEETING_BOOKED,
            OutreachStatusEnum.CLOSED_MET,
        ])
    ).count()

    meetings = outreach_query.filter(
        OutreachRecord.status == OutreachStatusEnum.MEETING_BOOKED
    ).count()

    neg_query = db.query(Negation)
    if scope is not None:
        neg_query = neg_query.filter(Negation.employee_id.in_(scope))
    neg_count = neg_query.count()

    return DashboardStats(
        total_contacts=total_contacts,
        active_contacts=active_contacts,
        total_outreach_this_week=total_week,
        total_outreach_this_month=total_month,
        pending_proposals=pending,
        sent_this_week=sent_week,
        meetings_booked=meetings,
        negation_count=neg_count,
    )


@router.get("/outreach-by-status")
def outreach_by_status(
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    scope = _get_employee_scope(db, current_user)
    query = db.query(OutreachRecord.status, func.count(OutreachRecord.id)).group_by(OutreachRecord.status)
    if scope is not None:
        query = query.filter(OutreachRecord.employee_id.in_(scope))
    results = query.all()
    return [{"status": r[0].value if r[0] else "unknown", "count": r[1]} for r in results]


@router.get("/outreach-by-ba")
def outreach_by_business_area(
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.BA_MANAGER, RoleEnum.ADMIN)),
):
    from app.models.models import BusinessArea
    results = (
        db.query(BusinessArea.name, func.count(OutreachRecord.id))
        .join(Employee, Employee.business_area_id == BusinessArea.id)
        .join(OutreachRecord, OutreachRecord.employee_id == Employee.id)
        .group_by(BusinessArea.name)
        .all()
    )
    return [{"business_area": r[0], "count": r[1]} for r in results]


@router.get("/outreach-by-team")
def outreach_by_team(
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    from app.models.models import Team
    scope = _get_employee_scope(db, current_user)
    query = (
        db.query(Team.name, func.count(OutreachRecord.id))
        .join(Employee, Employee.team_id == Team.id)
        .join(OutreachRecord, OutreachRecord.employee_id == Employee.id)
        .group_by(Team.name)
    )
    if scope is not None:
        query = query.filter(OutreachRecord.employee_id.in_(scope))
    results = query.all()
    return [{"team": r[0], "count": r[1]} for r in results]


@router.get("/outreach-by-site")
def outreach_by_site(
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    from app.models.models import Site
    results = (
        db.query(Site.name, func.count(OutreachRecord.id))
        .join(Employee, Employee.site_id == Site.id)
        .join(OutreachRecord, OutreachRecord.employee_id == Employee.id)
        .group_by(Site.name)
        .all()
    )
    return [{"site": r[0], "count": r[1]} for r in results]


@router.get("/consultant-leaderboard")
def consultant_leaderboard(
    days: int = Query(30, ge=7, le=365),
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    scope = _get_employee_scope(db, current_user)
    query = (
        db.query(
            Employee.id,
            Employee.name,
            func.count(OutreachRecord.id).label("total"),
            func.count(case(
                (OutreachRecord.status.in_([
                    OutreachStatusEnum.SENT, OutreachStatusEnum.PREPARED,
                ]), 1)
            )).label("sent"),
            func.count(case(
                (OutreachRecord.status == OutreachStatusEnum.MEETING_BOOKED, 1)
            )).label("meetings"),
        )
        .join(OutreachRecord, OutreachRecord.employee_id == Employee.id)
        .filter(OutreachRecord.created_at >= since)
        .group_by(Employee.id, Employee.name)
        .order_by(func.count(OutreachRecord.id).desc())
        .limit(20)
    )
    if scope is not None:
        query = query.filter(Employee.id.in_(scope))
    results = query.all()
    return [
        {
            "employee_id": r[0],
            "employee_name": r[1],
            "total_outreach": r[2],
            "sent": r[3],
            "meetings_booked": r[4],
        }
        for r in results
    ]


@router.get("/consultant-summary")
def consultant_summary(
    team_id: Optional[int] = None,
    business_area_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    """Per-consultant breakdown: proposed / accepted / sent / negated counts + rolling objectives."""
    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    scope = _get_employee_scope(db, current_user)

    query = (
        db.query(
            Employee.id,                                     # r[0]
            Employee.name,                                   # r[1]
            Team.name.label("team_name"),                    # r[2]
            BusinessArea.name.label("business_area_name"),   # r[3]
            Employee.outreach_target_per_week,               # r[4]
            Employee.outreach_target_per_month,              # r[5]
            func.count(OutreachRecord.id).label("total"),    # r[6]
            func.count(case(
                (OutreachRecord.status == OutreachStatusEnum.PROPOSED, 1)
            )).label("proposed"),                            # r[7]
            func.count(case(
                (OutreachRecord.status == OutreachStatusEnum.ACCEPTED, 1)
            )).label("accepted"),                            # r[8]
            func.count(case(
                (OutreachRecord.status.in_([
                    OutreachStatusEnum.SENT, OutreachStatusEnum.PREPARED,
                    OutreachStatusEnum.REPLIED, OutreachStatusEnum.MEETING_BOOKED,
                    OutreachStatusEnum.CLOSED_MET,
                ]), 1)
            )).label("sent"),                                # r[9]
            func.count(case(
                (OutreachRecord.status == OutreachStatusEnum.NEGATED, 1)
            )).label("negated"),                             # r[10]
            func.count(case(
                (OutreachRecord.sent_at >= week_ago, 1)
            )).label("sent_7d"),                             # r[11]
            func.count(case(
                (OutreachRecord.sent_at >= month_ago, 1)
            )).label("sent_30d"),                            # r[12]
        )
        .outerjoin(OutreachRecord, OutreachRecord.employee_id == Employee.id)
        .outerjoin(Team, Employee.team_id == Team.id)
        .outerjoin(BusinessArea, Employee.business_area_id == BusinessArea.id)
        .filter(Employee.is_active == True)
        .group_by(Employee.id, Employee.name, Team.name, BusinessArea.name,
                  Employee.outreach_target_per_week, Employee.outreach_target_per_month)
    )

    if scope is not None:
        query = query.filter(Employee.id.in_(scope))
    if team_id:
        query = query.filter(Employee.team_id == team_id)
    if business_area_id:
        query = query.filter(Employee.business_area_id == business_area_id)

    results = query.order_by(Employee.name).all()
    return [
        {
            "employee_id": r[0],
            "employee_name": r[1],
            "team_name": r[2] or "—",
            "business_area_name": r[3] or "—",
            "outreach_target_per_week": r[4],
            "outreach_target_per_month": r[5],
            "total": r[6],
            "proposed": r[7],
            "accepted": r[8],
            "sent": r[9],
            "negated": r[10],
            "sent_7d": r[11],
            "sent_30d": r[12],
        }
        for r in results
    ]


# ── Aggregated Analytics ──────────────────────────────────────────────

TIME_PERIOD_MAP = {
    "last_week": timedelta(days=7),
    "last_2_weeks": timedelta(days=14),
    "last_3_weeks": timedelta(days=21),
    "last_month": timedelta(days=30),
    "last_quarter": timedelta(days=90),
    "last_year": timedelta(days=365),
    "last_3_years": timedelta(days=1095),
    "last_5_years": timedelta(days=1825),
    "ever": None,
}

SENT_LIKE_STATUSES = [
    OutreachStatusEnum.SENT,
    OutreachStatusEnum.PREPARED,
    OutreachStatusEnum.REPLIED,
    OutreachStatusEnum.MEETING_BOOKED,
    OutreachStatusEnum.CLOSED_MET,
]


@router.get("/analytics")
def get_analytics(
    time_period: str = Query("last_month"),
    responsibility_domain: Optional[str] = None,
    group_domicile: Optional[str] = None,
    client_tier: Optional[str] = None,
    sector: Optional[str] = None,
    owner_business_area: Optional[str] = None,
    owner_team: Optional[str] = None,
    is_decision_maker: Optional[bool] = None,
    employee_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    """Aggregated analytics dashboard with filters and time period."""
    now = datetime.now(timezone.utc)
    delta = TIME_PERIOD_MAP.get(time_period)
    cutoff = (now - delta) if delta else None

    # Role-based employee scope
    scope = _get_employee_scope(db, current_user)

    # Build contact filter subquery if any contact-level filters are active
    has_contact_filters = any([
        responsibility_domain, group_domicile, client_tier,
        sector, owner_business_area, owner_team,
        is_decision_maker is not None,
    ])

    contact_ids_subq = None
    if has_contact_filters:
        cq = db.query(Contact.id)
        cq = apply_multi_filter(cq, Contact.responsibility_domain, responsibility_domain)
        cq = apply_multi_filter(cq, Contact.group_domicile, group_domicile)
        cq = apply_multi_filter(cq, Contact.client_tier, client_tier)
        cq = apply_multi_filter(cq, Contact.sector, sector)
        cq = apply_multi_filter(cq, Contact.owner_business_area, owner_business_area)
        cq = apply_multi_filter(cq, Contact.owner_team, owner_team)
        if is_decision_maker is not None:
            cq = cq.filter(Contact.is_decision_maker == is_decision_maker)
        contact_ids_subq = cq.subquery()

    # ── KPI A: Total contacts (no time filter) ──
    total_contacts_q = db.query(func.count(Contact.id))
    if has_contact_filters:
        total_contacts_q = total_contacts_q.filter(Contact.id.in_(db.query(contact_ids_subq.c.id)))
    total_contacts = total_contacts_q.scalar() or 0

    # ── Build outreach base query ──
    outreach_base = db.query(OutreachRecord)
    if scope is not None:
        outreach_base = outreach_base.filter(OutreachRecord.employee_id.in_(scope))
    if employee_id:
        outreach_base = outreach_base.filter(OutreachRecord.employee_id == employee_id)
    if has_contact_filters:
        outreach_base = outreach_base.filter(
            OutreachRecord.contact_id.in_(db.query(contact_ids_subq.c.id))
        )
    if cutoff:
        outreach_base = outreach_base.filter(OutreachRecord.created_at >= cutoff)

    # ── KPI B-E: Outreach metrics ──
    interacted_contacts = (
        outreach_base.with_entities(func.count(func.distinct(OutreachRecord.contact_id)))
        .scalar() or 0
    )
    outreach_total = outreach_base.count()
    outreach_sent = (
        outreach_base.filter(OutreachRecord.status.in_(SENT_LIKE_STATUSES)).count()
    )
    meetings_booked = (
        outreach_base.filter(OutreachRecord.status == OutreachStatusEnum.MEETING_BOOKED).count()
    )

    # ── KPI F: Campaigns sent ──
    camp_q = db.query(func.count(CampaignRecipient.id)).filter(
        CampaignRecipient.status == CampaignRecipientStatusEnum.SENT,
    )
    if cutoff:
        camp_q = camp_q.filter(CampaignRecipient.sent_at >= cutoff)
    if has_contact_filters:
        camp_q = camp_q.filter(
            CampaignRecipient.contact_id.in_(db.query(contact_ids_subq.c.id))
        )
    campaigns_sent = camp_q.scalar() or 0

    # ── Query B: Outreach by Status ──
    status_rows = (
        outreach_base.with_entities(OutreachRecord.status, func.count(OutreachRecord.id))
        .group_by(OutreachRecord.status)
        .all()
    )
    outreach_by_status = [
        {"status": r[0].value if r[0] else "unknown", "count": r[1]}
        for r in status_rows
    ]

    # ── Query C: Distribution by Tier ──
    tier_rows = (
        outreach_base
        .join(Contact, OutreachRecord.contact_id == Contact.id)
        .with_entities(Contact.client_tier, func.count(OutreachRecord.id))
        .group_by(Contact.client_tier)
        .all()
    )
    distribution_by_tier = [
        {"label": r[0] or "Unknown", "value": r[1]}
        for r in tier_rows
    ]

    # ── Query D: Distribution by Sector ──
    sector_rows = (
        outreach_base
        .join(Contact, OutreachRecord.contact_id == Contact.id)
        .with_entities(Contact.sector, func.count(OutreachRecord.id))
        .group_by(Contact.sector)
        .all()
    )
    distribution_by_sector = [
        {"label": r[0] or "Unknown", "value": r[1]}
        for r in sector_rows
    ]

    # ── Query E: Activity Over Time ──
    if time_period in ("last_week", "last_2_weeks", "last_3_weeks"):
        bucket_expr = func.strftime('%Y-%m-%d', OutreachRecord.created_at)
        time_bucket = "daily"
    elif time_period in ("last_month", "last_quarter"):
        bucket_expr = func.strftime('%Y-%W', OutreachRecord.created_at)
        time_bucket = "weekly"
    else:
        bucket_expr = func.strftime('%Y-%m', OutreachRecord.created_at)
        time_bucket = "monthly"

    time_rows = (
        outreach_base
        .with_entities(
            bucket_expr.label("bucket"),
            func.count(case(
                (OutreachRecord.status.in_(SENT_LIKE_STATUSES), 1),
            )).label("outreach"),
            func.count(case(
                (OutreachRecord.status == OutreachStatusEnum.MEETING_BOOKED, 1),
            )).label("meetings"),
        )
        .group_by("bucket")
        .order_by("bucket")
        .all()
    )
    activity_over_time = [
        {"date": r[0], "outreach": r[1], "meetings": r[2]}
        for r in time_rows
    ]

    # ── Query F: Coverage Gaps by Industry ──
    gap_q = db.query(CoverageGap)

    # Apply contact-level filters to gap data where applicable
    gap_q = apply_multi_filter(gap_q, CoverageGap.tier, client_tier)
    gap_q = apply_multi_filter(gap_q, CoverageGap.industry, sector)

    gap_rows = gap_q.all()

    # Pre-compute closed gaps: contacts that match a missing domain AND have meetings
    import json as _json
    from collections import defaultdict

    # Collect all company names from gaps
    gap_company_norms = list({g.company_name_normalized for g in gap_rows})

    # Get contacts at those companies with their domains — indexed by company
    # Two-step approach to avoid slow correlated EXISTS subquery
    meetings_by_company: dict[str, set[str]] = defaultdict(set)
    if gap_company_norms:
        # Step 1: Get contact IDs that have meetings (fast via index)
        contact_ids_with_meetings = set(
            r[0] for r in db.query(Meeting.contact_id).distinct().all()
        )
        # Step 2: Get contacts at gap companies with domains
        gap_norms_set = set(gap_company_norms)
        contacts_at_gap = (
            db.query(Contact.id, Contact.company_name, Contact.responsibility_domain)
            .filter(
                Contact.status == "active",
                Contact.responsibility_domain.isnot(None),
                Contact.responsibility_domain != "",
            )
            .all()
        )
        for cid, c_company, c_domain in contacts_at_gap:
            if c_company and c_domain:
                norm = c_company.lower().strip()
                if norm in gap_norms_set and cid in contact_ids_with_meetings:
                    meetings_by_company[norm].add(c_domain.lower().strip())

    # Group by industry and compute closed gaps
    gap_by_industry: dict[str, dict] = {}
    total_critical_gaps = 0
    total_closed_gaps = 0
    companies_with_gaps = 0
    for g in gap_rows:
        label = g.industry or "Unknown"
        if label not in gap_by_industry:
            gap_by_industry[label] = {"label": label, "critical": 0, "potential": 0, "closed": 0}
        gap_by_industry[label]["critical"] += g.critical_gap_count or 0
        gap_by_industry[label]["potential"] += g.potential_gap_count or 0
        total_critical_gaps += g.critical_gap_count or 0
        if (g.critical_gap_count or 0) > 0:
            companies_with_gaps += 1

        # Count closed gaps — O(domains * company_domains) instead of O(domains * all_meetings)
        closed_for_company = 0
        company_domains = meetings_by_company.get(g.company_name_normalized, set())
        if company_domains:
            try:
                crit_domains = _json.loads(g.missing_domains_critical) if g.missing_domains_critical else []
            except (ValueError, TypeError):
                crit_domains = []
            for d in crit_domains:
                d_lower = d.lower().strip()
                for contact_domain in company_domains:
                    if d_lower in contact_domain or contact_domain in d_lower:
                        closed_for_company += 1
                        break
        gap_by_industry[label]["closed"] += closed_for_company
        total_closed_gaps += closed_for_company

    # Sort by critical desc, take top 12
    gap_chart_data = sorted(gap_by_industry.values(), key=lambda x: x["critical"], reverse=True)[:12]

    return {
        "kpis": {
            "total_contacts": total_contacts,
            "interacted_contacts": interacted_contacts,
            "outreach_total": outreach_total,
            "outreach_sent": outreach_sent,
            "meetings_booked": meetings_booked,
            "campaigns_sent": campaigns_sent,
            "coverage_gaps_critical": total_critical_gaps,
            "companies_with_gaps": companies_with_gaps,
        },
        "outreach_by_status": outreach_by_status,
        "distribution_by_tier": distribution_by_tier,
        "distribution_by_sector": distribution_by_sector,
        "activity_over_time": activity_over_time,
        "time_bucket": time_bucket,
        "gap_by_industry": gap_chart_data,
        "gap_kpi": {
            "total_critical": total_critical_gaps,
            "companies_with_gaps": companies_with_gaps,
            "closed_gaps": total_closed_gaps,
        },
    }
