from typing import Optional, List
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func

from app.core.database import get_db
from app.core.auth import get_current_user, require_role
from app.models.models import (
    OutreachRecord, OutreachStatusEnum, Contact, Employee, Negation,
    NegationReasonEnum, SuppressionEntry, AuditLog, RoleEnum, ContactStatusEnum,
    LanguageEnum, Notification, Team, BusinessArea,
)
from app.schemas.schemas import (
    OutreachRecordOut, OutreachDraftRequest, OutreachSendRequest,
    OutreachOutcomeRequest, OutreachOverrideRequest, NegationCreate, NegationOut,
)
from app.services.recommendation import RecommendationService
from app.services.email_generator import EmailGeneratorService

router = APIRouter()


class GenerateProposalsRequest(BaseModel):
    limit: int = 0  # 0 = no global limit (per-consultant cap controls volume)


class GenerateEmailRequest(BaseModel):
    language: Optional[str] = None
    template_id: Optional[int] = None


@router.post("/generate-proposals")
def generate_proposals(
    data: GenerateProposalsRequest,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN, RoleEnum.BA_MANAGER)),
):
    service = RecommendationService(db)
    result = service.generate_proposals(limit=data.limit)
    return {
        "created": result["total_created"],
        "consultants_used": result["consultants_used"],
        "contacts_evaluated": result["contacts_evaluated"],
        "contacts_skipped_cooldown": result["contacts_skipped_cooldown"],
        "contacts_skipped_no_match": result["contacts_skipped_no_match"],
        "per_consultant_cap": result["per_consultant_cap"],
        "proposals": [
            {
                "contact": c["contact"].full_name,
                "employee": c["employee"].name,
                "score": round(c["score"], 1),
                "reasons": c["reasons"],
            }
            for c in result["created"]
        ],
    }


@router.post("/{outreach_id}/generate-email")
def generate_email(
    outreach_id: int,
    data: GenerateEmailRequest,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    o = (
        db.query(OutreachRecord)
        .options(
            joinedload(OutreachRecord.contact),
            joinedload(OutreachRecord.employee),
            joinedload(OutreachRecord.redirected_by),
            joinedload(OutreachRecord.redirected_from).joinedload(OutreachRecord.negation),
        )
        .filter(OutreachRecord.id == outreach_id)
        .first()
    )
    if not o:
        raise HTTPException(status_code=404, detail="Outreach record not found")
    if not o.contact or not o.employee:
        raise HTTPException(status_code=400, detail="Outreach missing contact or employee")

    # Resolve language
    lang = None
    if data.language:
        try:
            lang = LanguageEnum(data.language)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Unknown language: {data.language}")

    service = EmailGeneratorService(db)
    result = service.generate_email(
        contact=o.contact,
        employee=o.employee,
        language=lang,
        template_id=data.template_id,
    )
    return result


def _outreach_to_out(o: OutreachRecord) -> OutreachRecordOut:
    return OutreachRecordOut(
        id=o.id,
        contact_id=o.contact_id,
        employee_id=o.employee_id,
        status=o.status,
        email_subject=o.email_subject,
        email_body=o.email_body,
        email_language=o.email_language,
        proposed_slot_1_start=o.proposed_slot_1_start,
        proposed_slot_1_end=o.proposed_slot_1_end,
        proposed_slot_2_start=o.proposed_slot_2_start,
        proposed_slot_2_end=o.proposed_slot_2_end,
        message_id=o.message_id,
        sent_at=o.sent_at,
        replied_at=getattr(o, "replied_at", None),
        outcome=o.outcome,
        outcome_notes=o.outcome_notes,
        cooldown_override=o.cooldown_override,
        recommendation_score=o.recommendation_score,
        recommendation_reason=o.recommendation_reason,
        selected_attachment_ids=o.selected_attachment_ids,
        created_at=o.created_at,
        updated_at=o.updated_at,
        contact_name=o.contact.full_name if o.contact else None,
        contact_email=o.contact.email if o.contact else None,
        contact_company=o.contact.company_name if o.contact else None,
        contact_job_title=o.contact.job_title if o.contact else None,
        employee_name=o.employee.name if o.employee else None,
        team_name=o.employee.team.name if (o.employee and o.employee.team) else None,
        business_area_name=o.employee.business_area.name if (o.employee and o.employee.business_area) else None,
        # Redirect provenance
        redirected_from_id=getattr(o, "redirected_from_id", None),
        redirected_by_id=getattr(o, "redirected_by_id", None),
        redirected_by_name=(
            o.redirected_by.name
            if getattr(o, "redirected_by", None) else None
        ),
        redirected_at=o.created_at if getattr(o, "redirected_from_id", None) else None,
        redirect_notes=(
            o.redirected_from.negation.notes
            if (getattr(o, "redirected_from", None) and o.redirected_from and o.redirected_from.negation)
            else None
        ),
    )


@router.get("/filters")
def get_outreach_filters(
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    """Return available filter values for outreach list UI."""
    # Statuses
    statuses = [s.value for s in OutreachStatusEnum]

    # Consultants (employees who have outreach records)
    emp_ids_with_outreach = db.query(OutreachRecord.employee_id).distinct().subquery()
    consultants = (
        db.query(Employee.id, Employee.name)
        .filter(Employee.id.in_(db.query(emp_ids_with_outreach)))
        .order_by(Employee.name)
        .all()
    )

    # Companies (distinct from contacts linked to outreach)
    contact_ids = db.query(OutreachRecord.contact_id).distinct().subquery()
    companies = (
        db.query(Contact.company_name)
        .filter(Contact.id.in_(db.query(contact_ids)), Contact.company_name.isnot(None))
        .distinct()
        .order_by(Contact.company_name)
        .all()
    )

    # Business areas
    bas = db.query(BusinessArea.id, BusinessArea.name).order_by(BusinessArea.name).all()

    # Teams
    teams = db.query(Team.id, Team.name).order_by(Team.name).all()

    # Outcomes (distinct non-null values)
    outcomes = (
        db.query(OutreachRecord.outcome)
        .filter(OutreachRecord.outcome.isnot(None), OutreachRecord.outcome != "")
        .distinct()
        .order_by(OutreachRecord.outcome)
        .all()
    )

    return {
        "statuses": statuses,
        "consultants": [{"id": c.id, "name": c.name} for c in consultants],
        "companies": [c[0] for c in companies],
        "business_areas": [{"id": b.id, "name": b.name} for b in bas],
        "teams": [{"id": t.id, "name": t.name} for t in teams],
        "outcomes": [o[0] for o in outcomes],
    }


@router.get("/")
def list_outreach(
    status: Optional[OutreachStatusEnum] = None,
    statuses: Optional[str] = Query(None, description="Comma-separated list of statuses"),
    employee_id: Optional[int] = None,
    employee_ids: Optional[str] = Query(None, description="Comma-separated employee IDs"),
    contact_id: Optional[int] = None,
    team_id: Optional[int] = None,
    team_ids: Optional[str] = Query(None, description="Comma-separated team IDs"),
    business_area_id: Optional[int] = None,
    ba_ids: Optional[str] = Query(None, description="Comma-separated BA IDs"),
    companies: Optional[str] = Query(None, description="Comma-separated company names"),
    outcomes: Optional[str] = Query(None, description="Comma-separated outcomes"),
    search: Optional[str] = Query(None, description="Search contact name/title/company or consultant name"),
    sort_by: str = Query("recommendation_score", description="Sort field"),
    sort_dir: str = Query("desc", description="Sort direction: asc or desc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    query = db.query(OutreachRecord).options(
        joinedload(OutreachRecord.contact),
        joinedload(OutreachRecord.employee),
        joinedload(OutreachRecord.redirected_by),
        joinedload(OutreachRecord.redirected_from).joinedload(OutreachRecord.negation),
    )

    if statuses:
        status_list = [s.strip() for s in statuses.split(",") if s.strip()]
        if status_list:
            query = query.filter(OutreachRecord.status.in_(status_list))
    elif status:
        query = query.filter(OutreachRecord.status == status)

    if employee_ids:
        emp_id_list = [int(x) for x in employee_ids.split(",") if x.strip().isdigit()]
        if emp_id_list:
            query = query.filter(OutreachRecord.employee_id.in_(emp_id_list))
    elif employee_id:
        query = query.filter(OutreachRecord.employee_id == employee_id)

    if contact_id:
        query = query.filter(OutreachRecord.contact_id == contact_id)

    if companies:
        company_list = [c.strip() for c in companies.split(",") if c.strip()]
        if company_list:
            matching_cids = db.query(Contact.id).filter(Contact.company_name.in_(company_list)).scalar_subquery()
            query = query.filter(OutreachRecord.contact_id.in_(matching_cids))

    if outcomes:
        outcome_list = [o.strip() for o in outcomes.split(",") if o.strip()]
        if outcome_list:
            query = query.filter(OutreachRecord.outcome.in_(outcome_list))

    # Free-text search across contact & employee fields
    if search and search.strip():
        term = f"%{search.strip()}%"
        # Use subqueries to avoid join conflicts with eager loading
        matching_contact_ids = (
            db.query(Contact.id)
            .filter(
                Contact.full_name.ilike(term)
                | Contact.job_title.ilike(term)
                | Contact.company_name.ilike(term)
            )
            .scalar_subquery()
        )
        matching_employee_ids = (
            db.query(Employee.id)
            .filter(Employee.name.ilike(term))
            .scalar_subquery()
        )
        query = query.filter(
            OutreachRecord.contact_id.in_(matching_contact_ids)
            | OutreachRecord.employee_id.in_(matching_employee_ids)
        )
    if team_ids:
        tid_list = [int(x) for x in team_ids.split(",") if x.strip().isdigit()]
        if tid_list:
            team_emp_ids = db.query(Employee.id).filter(Employee.team_id.in_(tid_list)).scalar_subquery()
            query = query.filter(OutreachRecord.employee_id.in_(team_emp_ids))
    elif team_id:
        team_emp_ids = db.query(Employee.id).filter(Employee.team_id == team_id).scalar_subquery()
        query = query.filter(OutreachRecord.employee_id.in_(team_emp_ids))

    if ba_ids:
        ba_list = [int(x) for x in ba_ids.split(",") if x.strip().isdigit()]
        if ba_list:
            ba_emp_ids = db.query(Employee.id).filter(Employee.business_area_id.in_(ba_list)).scalar_subquery()
            query = query.filter(OutreachRecord.employee_id.in_(ba_emp_ids))
    elif business_area_id:
        ba_emp_ids = db.query(Employee.id).filter(Employee.business_area_id == business_area_id).scalar_subquery()
        query = query.filter(OutreachRecord.employee_id.in_(ba_emp_ids))

    # Role-based visibility scoping
    if current_user.role == RoleEnum.ADMIN:
        pass  # sees everything

    elif current_user.role == RoleEnum.BA_MANAGER:
        # Sees outreach for consultants + team managers in their BA (+ themselves)
        ba_employee_ids = (
            db.query(Employee.id)
            .filter(
                Employee.business_area_id == current_user.business_area_id,
                Employee.role.in_([RoleEnum.CONSULTANT, RoleEnum.TEAM_MANAGER]),
            )
            .scalar_subquery()
        )
        query = query.filter(
            OutreachRecord.employee_id.in_(ba_employee_ids)
            | (OutreachRecord.employee_id == current_user.id)
        )

    elif current_user.role == RoleEnum.TEAM_MANAGER:
        # Sees outreach for consultants in their team (+ themselves)
        team_consultant_ids = (
            db.query(Employee.id)
            .filter(
                Employee.team_id == current_user.team_id,
                Employee.role == RoleEnum.CONSULTANT,
            )
            .scalar_subquery()
        )
        query = query.filter(
            OutreachRecord.employee_id.in_(team_consultant_ids)
            | (OutreachRecord.employee_id == current_user.id)
        )

    else:
        # Consultant: only their own
        query = query.filter(OutreachRecord.employee_id == current_user.id)

    # Get total count before pagination
    # Use a separate count query to avoid issues with joinedload
    count_query = query.with_entities(func.count(OutreachRecord.id))
    # Strip eager loads for count (they cause issues with .count())
    count_query = count_query.options()  # clear options
    total = db.query(func.count()).select_from(
        query.with_entities(OutreachRecord.id).subquery()
    ).scalar()

    # Server-side sorting
    SORT_MAP = {
        "contact_name": Contact.full_name,
        "contact_job_title": Contact.job_title,
        "contact_company": Contact.company_name,
        "employee_name": Employee.name,
        "status": OutreachRecord.status,
        "recommendation_score": OutreachRecord.recommendation_score,
        "sent_at": OutreachRecord.sent_at,
        "outcome": OutreachRecord.outcome,
        "updated_at": OutreachRecord.updated_at,
    }
    sort_col = SORT_MAP.get(sort_by, OutreachRecord.recommendation_score)

    # For joined columns, ensure the join is explicit
    if sort_by in ("contact_name", "contact_job_title", "contact_company"):
        query = query.outerjoin(Contact, OutreachRecord.contact_id == Contact.id)
    elif sort_by == "employee_name":
        query = query.outerjoin(Employee, OutreachRecord.employee_id == Employee.id)

    if sort_dir == "asc":
        # Nulls last for ascending
        query = query.order_by(sort_col.asc().nullslast())
    else:
        # Nulls last for descending
        query = query.order_by(sort_col.desc().nullslast())

    records = (
        query
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    # Deduplicate (joins can cause duplicates with eager loading)
    seen = set()
    unique_records = []
    for r in records:
        if r.id not in seen:
            seen.add(r.id)
            unique_records.append(r)

    total_pages = (total + page_size - 1) // page_size if total > 0 else 1

    return {
        "items": [_outreach_to_out(o) for o in unique_records],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }


@router.get("/{outreach_id}", response_model=OutreachRecordOut)
def get_outreach(
    outreach_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    o = (
        db.query(OutreachRecord)
        .options(
            joinedload(OutreachRecord.contact),
            joinedload(OutreachRecord.employee),
            joinedload(OutreachRecord.redirected_by),
            joinedload(OutreachRecord.redirected_from).joinedload(OutreachRecord.negation),
        )
        .filter(OutreachRecord.id == outreach_id)
        .first()
    )
    if not o:
        raise HTTPException(status_code=404, detail="Outreach record not found")
    return _outreach_to_out(o)


@router.post("/{outreach_id}/accept", response_model=OutreachRecordOut)
def accept_outreach(
    outreach_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    o = db.query(OutreachRecord).filter(OutreachRecord.id == outreach_id).first()
    if not o:
        raise HTTPException(status_code=404, detail="Outreach record not found")
    if o.status != OutreachStatusEnum.PROPOSED:
        raise HTTPException(status_code=400, detail="Can only accept proposed outreach")
    if o.employee_id != current_user.id and current_user.role == RoleEnum.CONSULTANT:
        raise HTTPException(status_code=403, detail="Not assigned to you")

    o.status = OutreachStatusEnum.ACCEPTED
    db.add(AuditLog(
        employee_id=current_user.id,
        action="accept_outreach",
        entity_type="outreach_record",
        entity_id=o.id,
    ))
    db.commit()
    db.refresh(o)
    return _outreach_to_out(o)


@router.post("/{outreach_id}/draft", response_model=OutreachRecordOut)
def save_draft(
    outreach_id: int,
    data: OutreachDraftRequest,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    o = db.query(OutreachRecord).filter(OutreachRecord.id == outreach_id).first()
    if not o:
        raise HTTPException(status_code=404, detail="Outreach record not found")
    if o.status not in (OutreachStatusEnum.ACCEPTED, OutreachStatusEnum.DRAFT):
        raise HTTPException(status_code=400, detail="Can only draft accepted/draft outreach")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(o, key, value)
    o.status = OutreachStatusEnum.DRAFT

    db.commit()
    db.refresh(o)
    return _outreach_to_out(o)


@router.post("/{outreach_id}/send", response_model=OutreachRecordOut)
def send_outreach(
    outreach_id: int,
    data: OutreachSendRequest,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    o = db.query(OutreachRecord).filter(OutreachRecord.id == outreach_id).first()
    if not o:
        raise HTTPException(status_code=404, detail="Outreach record not found")
    if o.status not in (OutreachStatusEnum.DRAFT, OutreachStatusEnum.ACCEPTED):
        raise HTTPException(status_code=400, detail="Cannot send from current status")

    o.email_subject = data.email_subject
    o.email_body = data.email_body
    o.email_language = data.email_language

    # In prototype: mark as prepared (Graph not integrated yet)
    now = datetime.now(timezone.utc)
    o.status = OutreachStatusEnum.PREPARED
    o.sent_at = now

    # Record the send as an interaction on the contact
    if o.contact_id:
        contact = db.query(Contact).filter(Contact.id == o.contact_id).first()
        if contact:
            contact.last_activity_date = now
            contact.days_since_interaction = 0

    db.add(AuditLog(
        employee_id=current_user.id,
        action="send_outreach",
        entity_type="outreach_record",
        entity_id=o.id,
        details=f"Marked as prepared; subject={o.email_subject}",
    ))
    db.commit()
    db.refresh(o)
    return _outreach_to_out(o)


@router.post("/{outreach_id}/mark-sent", response_model=OutreachRecordOut)
def mark_sent(
    outreach_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    o = db.query(OutreachRecord).filter(OutreachRecord.id == outreach_id).first()
    if not o:
        raise HTTPException(status_code=404, detail="Outreach record not found")
    if o.status != OutreachStatusEnum.PREPARED:
        raise HTTPException(status_code=400, detail="Can only mark prepared records as sent")

    o.status = OutreachStatusEnum.SENT
    if not o.sent_at:
        o.sent_at = datetime.now(timezone.utc)
    sent_ts = o.sent_at

    # Record the send as an interaction on the contact
    if o.contact_id:
        contact = db.query(Contact).filter(Contact.id == o.contact_id).first()
        if contact:
            contact.last_activity_date = sent_ts
            contact.days_since_interaction = 0

    db.add(AuditLog(
        employee_id=current_user.id,
        action="mark_sent",
        entity_type="outreach_record",
        entity_id=o.id,
    ))
    db.commit()
    db.refresh(o)
    return _outreach_to_out(o)


@router.post("/{outreach_id}/revert-to-draft", response_model=OutreachRecordOut)
def revert_to_draft(
    outreach_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    o = db.query(OutreachRecord).filter(OutreachRecord.id == outreach_id).first()
    if not o:
        raise HTTPException(status_code=404, detail="Outreach record not found")
    if o.status != OutreachStatusEnum.PREPARED:
        raise HTTPException(status_code=400, detail="Can only revert prepared records to draft")

    o.status = OutreachStatusEnum.DRAFT
    o.sent_at = None  # clear the sent timestamp since we're reverting

    db.add(AuditLog(
        employee_id=current_user.id,
        action="revert_to_draft",
        entity_type="outreach_record",
        entity_id=o.id,
    ))
    db.commit()
    db.refresh(o)
    return _outreach_to_out(o)


@router.post("/{outreach_id}/outcome", response_model=OutreachRecordOut)
def set_outcome(
    outreach_id: int,
    data: OutreachOutcomeRequest,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    o = db.query(OutreachRecord).filter(OutreachRecord.id == outreach_id).first()
    if not o:
        raise HTTPException(status_code=404, detail="Outreach record not found")

    status_map = {
        "replied": OutreachStatusEnum.REPLIED,
        "meeting_booked": OutreachStatusEnum.MEETING_BOOKED,
        "closed_met": OutreachStatusEnum.CLOSED_MET,
        "closed_no_response": OutreachStatusEnum.CLOSED_NO_RESPONSE,
        "closed_not_relevant": OutreachStatusEnum.CLOSED_NOT_RELEVANT,
        "closed_bounced": OutreachStatusEnum.CLOSED_BOUNCED,
    }

    new_status = status_map.get(data.outcome)
    if not new_status:
        raise HTTPException(status_code=400, detail=f"Invalid outcome: {data.outcome}")

    o.status = new_status
    o.outcome = data.outcome
    o.outcome_notes = data.outcome_notes

    now = datetime.now(timezone.utc)

    # Bounce handling: flag the contact
    if data.outcome == "closed_bounced" and o.contact_id:
        contact = db.query(Contact).filter(Contact.id == o.contact_id).first()
        if contact:
            contact.bounced_at = now
            contact.status = ContactStatusEnum.INACTIVE_MISSING

    # Reply handling: set replied_at + update contact last activity
    if data.outcome == "replied":
        o.replied_at = now
        if o.contact_id:
            contact = db.query(Contact).filter(Contact.id == o.contact_id).first()
            if contact:
                contact.last_activity_date = now
                contact.days_since_interaction = 0

    db.add(AuditLog(
        employee_id=current_user.id,
        action="set_outcome",
        entity_type="outreach_record",
        entity_id=o.id,
        new_value=data.outcome,
    ))
    db.commit()
    db.refresh(o)
    return _outreach_to_out(o)


@router.post("/{outreach_id}/negate", response_model=NegationOut)
def negate_outreach(
    outreach_id: int,
    data: NegationCreate,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    o = db.query(OutreachRecord).options(
        joinedload(OutreachRecord.contact),
    ).filter(OutreachRecord.id == outreach_id).first()
    if not o:
        raise HTTPException(status_code=404, detail="Outreach record not found")
    if o.status != OutreachStatusEnum.PROPOSED:
        raise HTTPException(status_code=400, detail="Can only negate proposed outreach")

    # Validate redirect target when reason is another_consultant_better
    redirect_target = None
    if data.reason == NegationReasonEnum.ANOTHER_CONSULTANT_BETTER:
        if not data.redirect_to_employee_id:
            raise HTTPException(
                status_code=400,
                detail="redirect_to_employee_id is required when reason is another_consultant_better",
            )
        if data.redirect_to_employee_id == o.employee_id:
            raise HTTPException(status_code=400, detail="Cannot redirect to the same consultant")
        redirect_target = db.query(Employee).filter(
            Employee.id == data.redirect_to_employee_id,
            Employee.is_active == True,
        ).first()
        if not redirect_target:
            raise HTTPException(status_code=404, detail="Target consultant not found or inactive")

    negation = Negation(
        outreach_record_id=o.id,
        employee_id=current_user.id,
        reason=data.reason,
        notes=data.notes,
    )
    db.add(negation)

    o.status = OutreachStatusEnum.NEGATED

    # Handle do-not-contact
    if data.reason == NegationReasonEnum.DO_NOT_CONTACT:
        contact = db.query(Contact).filter(Contact.id == o.contact_id).first()
        if contact:
            contact.status = ContactStatusEnum.SUPPRESSED
            suppression = SuppressionEntry(
                contact_id=contact.id,
                reason=f"Do-not-contact request via negation #{negation.id}",
                added_by_id=current_user.id,
            )
            db.add(suppression)

    # Handle redirect: create new outreach for target consultant
    redirected_outreach_id = None
    if redirect_target:
        new_outreach = OutreachRecord(
            contact_id=o.contact_id,
            employee_id=redirect_target.id,
            status=OutreachStatusEnum.PROPOSED,
            recommendation_score=None,
            recommendation_reason=f"Redirected by {current_user.name}",
            redirected_from_id=o.id,
            redirected_by_id=current_user.id,
        )
        db.add(new_outreach)
        db.flush()
        redirected_outreach_id = new_outreach.id

        # Notify the receiving consultant
        contact_name = o.contact.full_name if o.contact else "a contact"
        db.add(Notification(
            employee_id=redirect_target.id,
            notification_type="outreach_redirect",
            title="Outreach redirected to you",
            message=f"{current_user.name} redirected outreach for {contact_name} to you.",
            link=f"/outreach/{new_outreach.id}",
            reference_type="outreach_record",
            reference_id=new_outreach.id,
            is_read=False,
        ))

    audit_value = f"reason={data.reason.value}; notes={data.notes}"
    if redirect_target:
        audit_value += f"; redirected_to={redirect_target.name}(id={redirect_target.id})"

    db.add(AuditLog(
        employee_id=current_user.id,
        action="negate_outreach",
        entity_type="outreach_record",
        entity_id=o.id,
        new_value=audit_value,
    ))
    db.commit()
    db.refresh(negation)

    result = NegationOut.model_validate(negation)
    result.redirected_outreach_id = redirected_outreach_id
    return result


class RegisterReplyRequest(BaseModel):
    notes: Optional[str] = None


@router.post("/{outreach_id}/register-reply", response_model=OutreachRecordOut)
def register_reply(
    outreach_id: int,
    data: RegisterReplyRequest,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    """Register that a contact replied to this outreach."""
    o = (
        db.query(OutreachRecord)
        .options(
            joinedload(OutreachRecord.contact),
            joinedload(OutreachRecord.employee),
            joinedload(OutreachRecord.redirected_by),
            joinedload(OutreachRecord.redirected_from).joinedload(OutreachRecord.negation),
        )
        .filter(OutreachRecord.id == outreach_id)
        .first()
    )
    if not o:
        raise HTTPException(status_code=404, detail="Outreach record not found")

    if o.status not in (OutreachStatusEnum.SENT, OutreachStatusEnum.PREPARED):
        raise HTTPException(
            status_code=400,
            detail="Can only register a reply on sent or prepared outreach",
        )

    now = datetime.now(timezone.utc)
    o.status = OutreachStatusEnum.REPLIED
    o.outcome = "replied"
    o.replied_at = now
    if data.notes:
        o.outcome_notes = data.notes

    # Update contact last activity
    if o.contact_id:
        contact = db.query(Contact).filter(Contact.id == o.contact_id).first()
        if contact:
            contact.last_activity_date = now
            contact.days_since_interaction = 0

    db.add(AuditLog(
        employee_id=current_user.id,
        action="register_reply",
        entity_type="outreach_record",
        entity_id=o.id,
        details=f"Reply registered; notes={data.notes}",
    ))
    db.commit()
    db.refresh(o)
    return _outreach_to_out(o)
