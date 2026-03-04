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
    LanguageEnum,
)
from app.schemas.schemas import (
    OutreachRecordOut, OutreachDraftRequest, OutreachSendRequest,
    OutreachOutcomeRequest, OutreachOverrideRequest, NegationCreate, NegationOut,
)
from app.services.recommendation import RecommendationService
from app.services.email_generator import EmailGeneratorService

router = APIRouter()


class GenerateProposalsRequest(BaseModel):
    limit: int = 20


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
    created = service.generate_proposals(limit=data.limit)
    return {"created": len(created), "proposals": [
        {
            "contact": c["contact"].full_name,
            "employee": c["employee"].name,
            "score": round(c["score"], 1),
            "reasons": c["reasons"],
        }
        for c in created
    ]}


@router.post("/{outreach_id}/generate-email")
def generate_email(
    outreach_id: int,
    data: GenerateEmailRequest,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    o = (
        db.query(OutreachRecord)
        .options(joinedload(OutreachRecord.contact), joinedload(OutreachRecord.employee))
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
        outcome=o.outcome,
        outcome_notes=o.outcome_notes,
        cooldown_override=o.cooldown_override,
        recommendation_score=o.recommendation_score,
        recommendation_reason=o.recommendation_reason,
        created_at=o.created_at,
        updated_at=o.updated_at,
        contact_name=o.contact.full_name if o.contact else None,
        contact_email=o.contact.email if o.contact else None,
        contact_company=o.contact.company_name if o.contact else None,
        contact_job_title=o.contact.job_title if o.contact else None,
        employee_name=o.employee.name if o.employee else None,
        team_name=o.employee.team.name if (o.employee and o.employee.team) else None,
        business_area_name=o.employee.business_area.name if (o.employee and o.employee.business_area) else None,
    )


@router.get("/", response_model=List[OutreachRecordOut])
def list_outreach(
    status: Optional[OutreachStatusEnum] = None,
    employee_id: Optional[int] = None,
    contact_id: Optional[int] = None,
    team_id: Optional[int] = None,
    business_area_id: Optional[int] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    query = db.query(OutreachRecord).options(
        joinedload(OutreachRecord.contact),
        joinedload(OutreachRecord.employee),
    )

    if status:
        query = query.filter(OutreachRecord.status == status)
    if employee_id:
        query = query.filter(OutreachRecord.employee_id == employee_id)
    if contact_id:
        query = query.filter(OutreachRecord.contact_id == contact_id)
    if team_id:
        team_emp_ids = db.query(Employee.id).filter(Employee.team_id == team_id).scalar_subquery()
        query = query.filter(OutreachRecord.employee_id.in_(team_emp_ids))
    if business_area_id:
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

    records = (
        query.order_by(OutreachRecord.updated_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return [_outreach_to_out(o) for o in records]


@router.get("/{outreach_id}", response_model=OutreachRecordOut)
def get_outreach(
    outreach_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    o = (
        db.query(OutreachRecord)
        .options(joinedload(OutreachRecord.contact), joinedload(OutreachRecord.employee))
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
    o = db.query(OutreachRecord).filter(OutreachRecord.id == outreach_id).first()
    if not o:
        raise HTTPException(status_code=404, detail="Outreach record not found")
    if o.status != OutreachStatusEnum.PROPOSED:
        raise HTTPException(status_code=400, detail="Can only negate proposed outreach")

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

    db.add(AuditLog(
        employee_id=current_user.id,
        action="negate_outreach",
        entity_type="outreach_record",
        entity_id=o.id,
        new_value=f"reason={data.reason.value}; notes={data.notes}",
    ))
    db.commit()
    db.refresh(negation)
    return NegationOut.model_validate(negation)
