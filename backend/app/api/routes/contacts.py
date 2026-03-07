from typing import Optional, List
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, func

from app.core.database import get_db
from app.core.auth import get_current_user
from app.core.config import settings
from app.models.models import (
    Contact, ContactStatusEnum, Employee, Meeting, Negation, NegationReasonEnum,
    OutreachRecord, OutreachStatusEnum, RoleEnum, SystemConfig,
)
from app.schemas.schemas import ContactOut, ContactListResponse

BLOCKING_NEGATION_REASONS = [
    NegationReasonEnum.SENSITIVE_SITUATION,
    NegationReasonEnum.NOT_APPROPRIATE_TIMING,
    NegationReasonEnum.DO_NOT_CONTACT,
]

SENT_STATUSES = [
    OutreachStatusEnum.SENT,
    OutreachStatusEnum.REPLIED,
    OutreachStatusEnum.MEETING_BOOKED,
]


def _get_cooldown_days(db: Session) -> int:
    """Read cooldown_days_outreach from SystemConfig, or use default."""
    config = db.query(SystemConfig).filter(SystemConfig.key == "cooldown_days_outreach").first()
    if config:
        try:
            return int(config.value)
        except ValueError:
            pass
    return settings.DEFAULT_COOLDOWN_DAYS_OUTREACH


def _compute_contact_flags(
    contact_ids: List[int], contacts: list, db: Session
) -> dict:
    """Compute status flags for a batch of contacts. Returns {contact_id: [flags]}."""
    if not contact_ids:
        return {}

    now = datetime.now(timezone.utc)

    # 1. Stop flags: contacts with blocking negations
    stop_rows = (
        db.query(OutreachRecord.contact_id, func.max(Negation.created_at))
        .join(Negation, Negation.outreach_record_id == OutreachRecord.id)
        .filter(
            OutreachRecord.contact_id.in_(contact_ids),
            Negation.reason.in_(BLOCKING_NEGATION_REASONS),
        )
        .group_by(OutreachRecord.contact_id)
        .all()
    )
    stop_map = {cid: neg_date for cid, neg_date in stop_rows}

    # 2. Mail sent recently (within 7 days)
    seven_days_ago = now - timedelta(days=7)
    mail_recent = set(
        r[0] for r in db.query(OutreachRecord.contact_id)
        .filter(
            OutreachRecord.contact_id.in_(contact_ids),
            OutreachRecord.sent_at >= seven_days_ago,
            OutreachRecord.status.in_(SENT_STATUSES),
        )
        .distinct()
        .all()
    )

    # 3. Cooldown (8 days to cooldown_days_outreach)
    cooldown_days = _get_cooldown_days(db)
    eight_days_ago = now - timedelta(days=8)
    cooldown_start = now - timedelta(days=cooldown_days)
    in_cooldown = set(
        r[0] for r in db.query(OutreachRecord.contact_id)
        .filter(
            OutreachRecord.contact_id.in_(contact_ids),
            OutreachRecord.sent_at >= cooldown_start,
            OutreachRecord.sent_at < eight_days_ago,
            OutreachRecord.status.in_(SENT_STATUSES),
        )
        .distinct()
        .all()
    )

    # Build contact-specific cleared-at map
    cleared_map = {c.id: c.stop_flag_cleared_at for c in contacts}

    # Build flags per contact
    flags_map = {}
    for cid in contact_ids:
        flags = []
        neg_date = stop_map.get(cid)
        cleared_at = cleared_map.get(cid)
        if neg_date:
            # Make timezone-aware for comparison if needed
            if neg_date.tzinfo is None:
                neg_date = neg_date.replace(tzinfo=timezone.utc)
            if cleared_at is not None:
                if cleared_at.tzinfo is None:
                    cleared_at = cleared_at.replace(tzinfo=timezone.utc)
                if neg_date > cleared_at:
                    flags.append("stop")
            else:
                flags.append("stop")
        if cid in mail_recent:
            flags.append("mail_recent")
        elif cid in in_cooldown:
            flags.append("cooldown")
        if not flags:
            flags.append("available")
        flags_map[cid] = flags

    return flags_map

router = APIRouter()


@router.get("/", response_model=ContactListResponse)
def list_contacts(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    search: Optional[str] = None,
    client_tier: Optional[str] = None,
    sector: Optional[str] = None,
    responsibility_domain: Optional[str] = None,
    status: Optional[ContactStatusEnum] = None,
    owner_business_area: Optional[str] = None,
    owner_team: Optional[str] = None,
    group_domicile: Optional[str] = None,
    has_historical_revenue: Optional[bool] = None,
    relevant_search: Optional[bool] = None,
    sort_by: str = Query("priority_score", regex="^(priority_score|last_activity_date|full_name|company_name|client_name|sector|job_title|days_since_interaction|revenue|client_tier|group_domicile|owner_name)$"),
    sort_desc: bool = True,
    current_user: Employee = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Contact)

    if status:
        query = query.filter(Contact.status == status)
    else:
        query = query.filter(Contact.status != ContactStatusEnum.SUPPRESSED)

    if search:
        like = f"%{search}%"
        query = query.filter(
            or_(
                Contact.full_name.ilike(like),
                Contact.email.ilike(like),
                Contact.company_name.ilike(like),
                Contact.job_title.ilike(like),
            )
        )

    if client_tier:
        query = query.filter(Contact.client_tier == client_tier)
    if sector:
        query = query.filter(Contact.sector == sector)
    if responsibility_domain:
        query = query.filter(Contact.responsibility_domain == responsibility_domain)
    if owner_business_area:
        query = query.filter(Contact.owner_business_area == owner_business_area)
    if owner_team:
        query = query.filter(Contact.owner_team == owner_team)
    if group_domicile:
        query = query.filter(Contact.group_domicile == group_domicile)
    if has_historical_revenue is not None:
        query = query.filter(Contact.has_historical_revenue == has_historical_revenue)
    if relevant_search is not None:
        query = query.filter(Contact.relevant_search == relevant_search)

    total = query.count()

    # Sorting: pinned first, then by sort field
    sort_col = getattr(Contact, sort_by, Contact.priority_score)
    order = sort_col.desc() if sort_desc else sort_col.asc()
    query = query.order_by(Contact.is_pinned.desc(), order)

    contacts = query.offset((page - 1) * page_size).limit(page_size).all()

    # Compute status flags for the page of contacts
    contact_ids = [c.id for c in contacts]
    flags_map = _compute_contact_flags(contact_ids, contacts, db)

    # Build response with flags
    contact_dicts = []
    for c in contacts:
        out = ContactOut.model_validate(c)
        out.contact_flags = flags_map.get(c.id, ["available"])
        contact_dicts.append(out)

    return ContactListResponse(
        contacts=contact_dicts,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/filters")
def get_filter_options(
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    tiers = [r[0] for r in db.query(Contact.client_tier).distinct().filter(Contact.client_tier.isnot(None)).all()]
    sectors = [r[0] for r in db.query(Contact.sector).distinct().filter(Contact.sector.isnot(None)).all()]
    domains = [r[0] for r in db.query(Contact.responsibility_domain).distinct().filter(Contact.responsibility_domain.isnot(None)).all()]
    bas = [r[0] for r in db.query(Contact.owner_business_area).distinct().filter(Contact.owner_business_area.isnot(None)).all()]
    teams = [r[0] for r in db.query(Contact.owner_team).distinct().filter(Contact.owner_team.isnot(None)).all()]
    domiciles = [r[0] for r in db.query(Contact.group_domicile).distinct().filter(Contact.group_domicile.isnot(None)).all()]

    return {
        "client_tiers": sorted(tiers),
        "sectors": sorted(sectors),
        "responsibility_domains": sorted(domains),
        "business_areas": sorted(bas),
        "teams": sorted(teams),
        "group_domiciles": sorted(domiciles),
    }


@router.get("/{contact_id}", response_model=ContactOut)
def get_contact(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    contact = db.query(Contact).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    return ContactOut.model_validate(contact)


@router.get("/{contact_id}/history")
def get_contact_history(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    contact = db.query(Contact).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    outreach = (
        db.query(OutreachRecord)
        .filter(OutreachRecord.contact_id == contact_id)
        .order_by(OutreachRecord.created_at.desc())
        .all()
    )

    meetings = contact.meetings

    return {
        "outreach": [
            {
                "id": o.id,
                "employee_id": o.employee_id,
                "employee_name": o.employee.name if o.employee else None,
                "status": o.status.value,
                "sent_at": o.sent_at,
                "outcome": o.outcome,
                "created_at": o.created_at,
            }
            for o in outreach
        ],
        "meetings": [
            {
                "id": m.id,
                "employee_name": m.employee_name_corrected or m.employee_name,
                "activity_date": m.activity_date,
                "details": m.details,
                "outcome": m.outcome,
            }
            for m in meetings
        ],
    }


@router.post("/{contact_id}/pin")
def pin_contact(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    if current_user.role not in (RoleEnum.TEAM_MANAGER, RoleEnum.BA_MANAGER, RoleEnum.ADMIN):
        raise HTTPException(status_code=403, detail="Only managers can pin contacts")

    contact = db.query(Contact).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    contact.is_pinned = not contact.is_pinned
    contact.pinned_by_id = current_user.id if contact.is_pinned else None
    db.commit()
    return {"pinned": contact.is_pinned}


@router.get("/{contact_id}/meeting-participants")
def get_meeting_participants(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    """Return consultants who have had meetings with this contact, with meeting counts."""
    contact = db.query(Contact).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    rows = (
        db.query(
            func.coalesce(Meeting.employee_name_corrected, Meeting.employee_name).label("employee_name"),
            func.count(Meeting.id).label("meeting_count"),
        )
        .filter(Meeting.contact_id == contact_id)
        .group_by(func.coalesce(Meeting.employee_name_corrected, Meeting.employee_name))
        .order_by(func.count(Meeting.id).desc())
        .all()
    )
    return [
        {"employee_name": r.employee_name, "meeting_count": r.meeting_count}
        for r in rows
        if r.employee_name
    ]


@router.post("/{contact_id}/clear-stop")
def clear_stop_flag(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    """Clear the stop flag for a contact (admin/manager only)."""
    if current_user.role not in (RoleEnum.TEAM_MANAGER, RoleEnum.BA_MANAGER, RoleEnum.ADMIN):
        raise HTTPException(status_code=403, detail="Only managers can clear stop flags")

    contact = db.query(Contact).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    contact.stop_flag_cleared_at = datetime.now(timezone.utc)
    db.commit()
    return {"cleared": True, "contact_id": contact_id}
