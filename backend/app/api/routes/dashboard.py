from datetime import datetime, timedelta, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, case

from app.core.database import get_db
from app.core.auth import get_current_user, require_role
from app.models.models import (
    OutreachRecord, OutreachStatusEnum, Contact, Employee, Negation,
    RoleEnum, Meeting, Team, BusinessArea,
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
