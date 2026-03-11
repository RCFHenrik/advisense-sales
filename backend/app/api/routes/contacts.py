from typing import Optional, List
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, and_, func
from app.core.filter_utils import apply_multi_filter, apply_multi_ilike

from app.core.database import get_db
from app.core.auth import get_current_user
from app.core.config import settings
from app.models.models import (
    Contact, ContactStatusEnum, Employee, Meeting, Negation, NegationReasonEnum,
    OutreachRecord, OutreachStatusEnum, RoleEnum, SystemConfig,
    Campaign, CampaignRecipient, CampaignRecipientStatusEnum, AuditLog,
    CoverageGap,
)
from app.schemas.schemas import (
    ContactOut, ContactListResponse, ContactUpdate,
    QuickCreateContactRequest, QuickCreateContactResponse,
)

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

    # Build contact-specific maps
    cleared_map = {c.id: c.stop_flag_cleared_at for c in contacts}
    contact_map = {c.id: c for c in contacts}

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

        # Bounced flag: contact has bounced_at set and is INACTIVE_MISSING
        c_obj = contact_map.get(cid)
        if c_obj and getattr(c_obj, "bounced_at", None) is not None:
            if c_obj.status == ContactStatusEnum.INACTIVE_MISSING and "stop" not in flags:
                flags.append("bounced")

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
    relevance_tag: Optional[str] = None,
    is_decision_maker: Optional[bool] = None,
    opt_out_one_on_one: Optional[bool] = None,
    opt_out_marketing_info: Optional[bool] = None,
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

    query = apply_multi_filter(query, Contact.client_tier, client_tier)
    query = apply_multi_filter(query, Contact.sector, sector)
    query = apply_multi_filter(query, Contact.responsibility_domain, responsibility_domain)
    query = apply_multi_filter(query, Contact.owner_business_area, owner_business_area)
    query = apply_multi_filter(query, Contact.owner_team, owner_team)
    query = apply_multi_filter(query, Contact.group_domicile, group_domicile)
    if has_historical_revenue is not None:
        query = query.filter(Contact.has_historical_revenue == has_historical_revenue)
    if relevant_search is not None:
        query = query.filter(Contact.relevant_search == relevant_search)
    query = apply_multi_ilike(query, Contact.relevance_tags, relevance_tag)
    if is_decision_maker is not None:
        query = query.filter(Contact.is_decision_maker == is_decision_maker)
    if opt_out_one_on_one is not None:
        query = query.filter(Contact.opt_out_one_on_one == opt_out_one_on_one)
    if opt_out_marketing_info is not None:
        query = query.filter(Contact.opt_out_marketing_info == opt_out_marketing_info)

    total = query.count()

    # Sorting: pinned first, then by sort field
    sort_col = getattr(Contact, sort_by, Contact.priority_score)
    order = sort_col.desc() if sort_desc else sort_col.asc()
    query = query.order_by(Contact.is_pinned.desc(), order)

    contacts = query.offset((page - 1) * page_size).limit(page_size).all()

    # Compute status flags for the page of contacts
    contact_ids = [c.id for c in contacts]
    flags_map = _compute_contact_flags(contact_ids, contacts, db)

    # Batch-load coverage gaps for this page's companies
    company_names_norm = list(set(
        c.company_name.lower().strip()
        for c in contacts if c.company_name
    ))
    gap_map = {}
    if company_names_norm:
        gaps = db.query(CoverageGap).filter(
            CoverageGap.company_name_normalized.in_(company_names_norm)
        ).all()
        gap_map = {g.company_name_normalized: g for g in gaps}

    # Batch-lookup owner details from Employee + related tables
    owner_names = list(set(c.owner_name for c in contacts if c.owner_name))
    owner_info_map = {}  # name.lower() -> dict with email, seniority, ba, team, site
    if owner_names:
        from sqlalchemy import func as _func
        from app.models.models import BusinessArea, Team, Site
        owner_rows = (
            db.query(
                Employee.name, Employee.email, Employee.seniority,
                BusinessArea.name.label("ba_name"),
                Team.name.label("team_name"),
                Site.name.label("site_name"),
            )
            .outerjoin(BusinessArea, Employee.business_area_id == BusinessArea.id)
            .outerjoin(Team, Employee.team_id == Team.id)
            .outerjoin(Site, Employee.site_id == Site.id)
            .filter(_func.lower(Employee.name).in_([n.lower() for n in owner_names]))
            .all()
        )
        for r in owner_rows:
            if not r.name:
                continue
            email = r.email if r.email and not r.email.startswith("pending-") else None
            owner_info_map[r.name.lower()] = {
                "email": email,
                "seniority": r.seniority,
                "business_area": r.ba_name,
                "team": r.team_name,
                "site": r.site_name,
            }

    # Build response with flags + gap data + owner info
    contact_dicts = []
    for c in contacts:
        out = ContactOut.model_validate(c)
        out.contact_flags = flags_map.get(c.id, ["available"])
        # Attach gap counts
        if c.company_name:
            gap = gap_map.get(c.company_name.lower().strip())
            if gap:
                out.coverage_gap_critical = gap.critical_gap_count
                out.coverage_gap_potential = gap.potential_gap_count
        # Attach owner info (prefer Employee lookup over Contact's denormalized fields)
        if c.owner_name:
            info = owner_info_map.get(c.owner_name.lower(), {})
            out.owner_email = info.get("email")
            out.owner_seniority = info.get("seniority") or c.owner_seniority
            out.owner_business_area = info.get("business_area") or out.owner_business_area
            out.owner_team = info.get("team") or out.owner_team
            out.owner_org_site = info.get("site") or c.owner_org_site
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

    # Extract unique relevance_tags from JSON arrays
    import json as _json
    raw_rts = [r[0] for r in db.query(Contact.relevance_tags).distinct().filter(Contact.relevance_tags.isnot(None)).all()]
    relevance_tags_set: set[str] = set()
    for raw in raw_rts:
        try:
            tags = _json.loads(raw)
            if isinstance(tags, list):
                for t in tags:
                    if t and isinstance(t, str):
                        relevance_tags_set.add(t.strip())
        except (_json.JSONDecodeError, TypeError):
            for t in raw.split(","):
                if t.strip():
                    relevance_tags_set.add(t.strip())

    return {
        "client_tiers": sorted(tiers),
        "sectors": sorted(sectors),
        "responsibility_domains": sorted(domains),
        "business_areas": sorted(bas),
        "teams": sorted(teams),
        "group_domiciles": sorted(domiciles),
        "relevance_tags": sorted(relevance_tags_set),
        "has_decision_makers": db.query(Contact.id).filter(Contact.is_decision_maker == True).count() > 0,
    }



@router.get("/export-contact-edits")
def export_contact_edits(
    client_tier: Optional[str] = None,
    sector: Optional[str] = None,
    responsibility_domain: Optional[str] = None,
    owner_business_area: Optional[str] = None,
    owner_team: Optional[str] = None,
    group_domicile: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    """Export contacts with any manual edits (name, email, title, expert areas, decision maker)."""
    from io import BytesIO
    from openpyxl import Workbook
    from fastapi.responses import StreamingResponse

    # Find contacts edited via audit log (name/email changes)
    edited_ids = [
        r[0] for r in db.query(AuditLog.entity_id).filter(
            AuditLog.entity_type == "contact",
            AuditLog.action.in_(["update_contact_title", "update_contact_name", "update_contact_email"]),
        ).distinct().all()
    ]

    # Also include contacts with edited titles (original_job_title set)
    query = db.query(Contact).filter(
        Contact.status != ContactStatusEnum.SUPPRESSED,
        or_(
            and_(Contact.original_job_title.isnot(None), Contact.original_job_title != Contact.job_title),
            Contact.id.in_(edited_ids) if edited_ids else False,
        ),
    )
    query = apply_multi_filter(query, Contact.client_tier, client_tier)
    query = apply_multi_filter(query, Contact.sector, sector)
    query = apply_multi_filter(query, Contact.responsibility_domain, responsibility_domain)
    query = apply_multi_filter(query, Contact.owner_business_area, owner_business_area)
    query = apply_multi_filter(query, Contact.owner_team, owner_team)
    query = apply_multi_filter(query, Contact.group_domicile, group_domicile)

    contacts = query.order_by(Contact.company_name, Contact.full_name).all()

    wb = Workbook()
    ws = wb.active
    ws.title = "Contact Edits"
    headers = [
        "Full Name", "Email", "Company",
        "Job Title", "Original Title",
        "Decision Maker",
        "Domain", "Last Modified",
    ]
    ws.append(headers)

    # Style headers bold
    from openpyxl.styles import Font
    for cell in ws[1]:
        cell.font = Font(bold=True)

    for c in contacts:
        ws.append([
            c.full_name,
            c.email,
            c.company_name,
            c.job_title,
            c.original_job_title or "",
            "Yes" if c.is_decision_maker else "No",
            c.responsibility_domain,
            c.updated_at.strftime("%Y-%m-%d %H:%M") if c.updated_at else "",
        ])

    # Auto-size columns
    for col in ws.columns:
        max_len = 0
        col_letter = col[0].column_letter
        for cell in col:
            try:
                max_len = max(max_len, len(str(cell.value or "")))
            except:
                pass
        ws.column_dimensions[col_letter].width = min(max_len + 3, 50)

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="contact_edits_{timestamp}.xlsx"'},
    )


@router.post("/quick-create", response_model=QuickCreateContactResponse)
def quick_create_contact(
    payload: QuickCreateContactRequest,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    """Create a minimal contact (name + email) for gap-filling.
    Tracked with data_source='app_created'."""
    # Split name into first/last
    parts = payload.name.strip().split(None, 1)
    first_name = parts[0] if parts else payload.name.strip()
    last_name = parts[1] if len(parts) > 1 else ""

    contact = Contact(
        first_name=first_name,
        last_name=last_name,
        full_name=payload.name.strip(),
        email=payload.email.strip().lower(),
        company_name=payload.company_name,
        job_title=payload.job_title,
        responsibility_domain=payload.responsibility_domain,
        status=ContactStatusEnum.ACTIVE,
        data_source="app_created",
        contact_created_by_id=current_user.id,
    )
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return QuickCreateContactResponse(
        id=contact.id,
        full_name=contact.full_name,
        email=contact.email,
        company_name=contact.company_name,
        data_source=contact.data_source,
    )


@router.get("/export-diff")
def export_diff_contacts(
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    """Export all app-created contacts as CSV for MasterData diff."""
    from io import StringIO
    import csv
    from fastapi.responses import StreamingResponse

    contacts = (
        db.query(Contact)
        .filter(Contact.data_source == "app_created")
        .order_by(Contact.id.desc())
        .all()
    )

    buf = StringIO()
    writer = csv.writer(buf)
    writer.writerow(["id", "full_name", "email", "company_name", "job_title",
                      "responsibility_domain", "created_by_id", "created_at"])
    for c in contacts:
        writer.writerow([
            c.id, c.full_name, c.email, c.company_name or "",
            c.job_title or "", c.responsibility_domain or "",
            c.contact_created_by_id or "", c.created_at or "",
        ])

    buf.seek(0)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="app_created_contacts_{timestamp}.csv"'},
    )


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


@router.patch("/{contact_id}", response_model=ContactOut)
def update_contact(
    contact_id: int,
    payload: ContactUpdate,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    contact = db.query(Contact).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    updates = payload.model_dump(exclude_unset=True)

    # If job_title is being changed, capture original before overwriting
    if "job_title" in updates and updates["job_title"] != contact.job_title:
        old_title = contact.job_title
        if not contact.original_job_title:
            contact.original_job_title = old_title
        db.add(AuditLog(
            employee_id=current_user.id,
            action="update_contact_title",
            entity_type="contact",
            entity_id=contact.id,
            old_value=old_title,
            new_value=updates["job_title"],
        ))

    # Audit log for name changes
    name_changed = False
    for name_field in ("first_name", "last_name"):
        if name_field in updates and updates[name_field] != getattr(contact, name_field):
            db.add(AuditLog(
                employee_id=current_user.id,
                action="update_contact_name",
                entity_type="contact",
                entity_id=contact.id,
                old_value=getattr(contact, name_field),
                new_value=updates[name_field],
            ))
            name_changed = True

    # Audit log for email changes
    if "email" in updates and updates["email"] != contact.email:
        db.add(AuditLog(
            employee_id=current_user.id,
            action="update_contact_email",
            entity_type="contact",
            entity_id=contact.id,
            old_value=contact.email,
            new_value=updates["email"],
        ))

    for field, value in updates.items():
        setattr(contact, field, value)

    # Recompute full_name if first or last name changed (only if at least one has content)
    if name_changed:
        parts = [contact.first_name or "", contact.last_name or ""]
        computed = " ".join(p for p in parts if p).strip()
        if computed:
            contact.full_name = computed

    db.commit()
    db.refresh(contact)
    return ContactOut.model_validate(contact)


@router.get("/{contact_id}/history")
def get_contact_history(
    contact_id: int,
    limit: int = Query(0, ge=0, le=50),
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    """Return outreach + meetings + campaign history for a contact.

    Pass limit > 0 to cap the number of records per category (e.g. limit=3 for tooltip).
    """
    contact = db.query(Contact).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    outreach_query = (
        db.query(OutreachRecord)
        .options(joinedload(OutreachRecord.employee), joinedload(OutreachRecord.template))
        .filter(OutreachRecord.contact_id == contact_id)
        .order_by(OutreachRecord.created_at.desc())
    )
    if limit > 0:
        outreach_query = outreach_query.limit(limit)
    outreach = outreach_query.all()

    meetings_query = (
        db.query(Meeting)
        .filter(Meeting.contact_id == contact_id)
        .order_by(Meeting.activity_date.desc())
    )
    if limit > 0:
        meetings_query = meetings_query.limit(limit)
    meetings = meetings_query.all()

    # Campaign sends for this contact (last 365 days)
    cutoff_365 = datetime.now(timezone.utc) - timedelta(days=365)
    campaign_query = (
        db.query(CampaignRecipient)
        .join(Campaign, CampaignRecipient.campaign_id == Campaign.id)
        .options(
            joinedload(CampaignRecipient.campaign).joinedload(Campaign.created_by)
        )
        .filter(
            CampaignRecipient.contact_id == contact_id,
            CampaignRecipient.status == CampaignRecipientStatusEnum.SENT,
            CampaignRecipient.sent_at >= cutoff_365,
        )
        .order_by(CampaignRecipient.sent_at.desc())
    )
    if limit > 0:
        campaign_query = campaign_query.limit(limit)
    campaign_recipients = campaign_query.all()

    result = {
        "outreach": [
            {
                "id": o.id,
                "employee_id": o.employee_id,
                "employee_name": o.employee.name if o.employee else None,
                "status": o.status.value,
                "sent_at": o.sent_at,
                "email_subject": o.email_subject,
                "template_name": o.template.name if o.template else None,
                "recommendation_score": o.recommendation_score,
                "outcome": o.outcome,
                "replied_at": getattr(o, "replied_at", None),
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
        "campaigns": [
            {
                "id": cr.id,
                "campaign_name": cr.campaign.name if cr.campaign else None,
                "email_subject": cr.campaign.email_subject if cr.campaign else None,
                "sent_at": cr.sent_at,
                "status": cr.status.value if cr.status else "sent",
                "created_by_name": cr.campaign.created_by.name if cr.campaign and cr.campaign.created_by else None,
            }
            for cr in campaign_recipients
        ],
    }

    # Attach coverage gap data for the contact's company
    gap_data = None
    if contact.company_name:
        import json as _json
        gap = db.query(CoverageGap).filter(
            CoverageGap.company_name_normalized == contact.company_name.lower().strip()
        ).first()
        if gap:
            gap_data = {
                "critical_gap_count": gap.critical_gap_count,
                "potential_gap_count": gap.potential_gap_count,
                "missing_domains_critical": _json.loads(gap.missing_domains_critical) if gap.missing_domains_critical else [],
                "missing_titles_critical": _json.loads(gap.missing_titles_critical) if gap.missing_titles_critical else [],
                "missing_domains_potential": _json.loads(gap.missing_domains_potential) if gap.missing_domains_potential else [],
                "missing_titles_potential": _json.loads(gap.missing_titles_potential) if gap.missing_titles_potential else [],
            }
    result["coverage_gap"] = gap_data

    return result


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


@router.post("/{contact_id}/clear-bounce")
def clear_bounce_flag(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    """Clear the bounced flag for a contact (managers only)."""
    if current_user.role not in (RoleEnum.TEAM_MANAGER, RoleEnum.BA_MANAGER, RoleEnum.ADMIN):
        raise HTTPException(status_code=403, detail="Only managers can clear bounce flags")

    contact = db.query(Contact).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    contact.bounced_at = None
    contact.status = ContactStatusEnum.ACTIVE
    db.commit()
    return {"cleared": True, "contact_id": contact_id}


@router.delete("/{contact_id}")
def delete_contact(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    """Soft-delete a contact by setting status to SUPPRESSED (admin/manager only)."""
    if current_user.role not in (RoleEnum.TEAM_MANAGER, RoleEnum.BA_MANAGER, RoleEnum.ADMIN):
        raise HTTPException(status_code=403, detail="Only managers and admins can delete contacts")

    contact = db.query(Contact).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    if contact.status == ContactStatusEnum.SUPPRESSED:
        raise HTTPException(status_code=400, detail="Contact is already suppressed/deleted")

    contact.status = ContactStatusEnum.SUPPRESSED
    db.commit()
    return {"deleted": True, "contact_id": contact_id}
