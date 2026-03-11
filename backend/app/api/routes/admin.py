import json
from io import BytesIO
from pathlib import Path
from typing import Optional, List
from sqlalchemy import or_

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.auth import require_role, get_current_user
from app.models.models import (
    Employee, RoleEnum, BusinessArea, Team, Site, SystemConfig,
    ColumnMapping, AuditLog, SuppressionEntry, Contact, ContactStatusEnum,
    BankHoliday, SiteLanguage, EmployeeSiteLanguage,
    Meeting, OutreachRecord, Negation, JobTitleDomain,
    ClassificationLookup, FileUpload,
    EmailTemplate, TemplateAttachment, HotTopic,
    Campaign, CampaignRecipient, CampaignAttachment, CampaignStatusEnum,
)
from app.schemas.schemas import (
    BusinessAreaOut, BusinessAreaCreate, TeamOut, TeamCreate,
    SiteOut, SiteCreate, SystemConfigOut, SystemConfigUpdate,
    ColumnMappingOut, ColumnMappingCreate, ColumnMappingUpdate,
    AuditLogOut, SiteLanguageOut, SiteLanguageCreate, SiteLanguageUpdate,
    ResetExecuteRequest,
)

router = APIRouter()


# ── Business Areas ────────────────────────────────────────────────────

@router.get("/business-areas", response_model=List[BusinessAreaOut])
def list_business_areas(
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN, RoleEnum.BA_MANAGER, RoleEnum.TEAM_MANAGER)),
):
    return [BusinessAreaOut.model_validate(ba) for ba in db.query(BusinessArea).order_by(BusinessArea.name).all()]


@router.post("/business-areas", response_model=BusinessAreaOut)
def create_business_area(
    data: BusinessAreaCreate,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN)),
):
    ba = BusinessArea(name=data.name)
    db.add(ba)
    db.commit()
    db.refresh(ba)
    return BusinessAreaOut.model_validate(ba)


# ── Teams ─────────────────────────────────────────────────────────────

@router.get("/teams", response_model=List[TeamOut])
def list_teams(
    business_area_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN, RoleEnum.BA_MANAGER, RoleEnum.TEAM_MANAGER)),
):
    query = db.query(Team)
    if business_area_id:
        query = query.filter(Team.business_area_id == business_area_id)

    teams = query.order_by(Team.name).all()
    return [
        TeamOut(
            id=t.id,
            name=t.name,
            business_area_id=t.business_area_id,
            business_area_name=t.business_area.name if t.business_area else None,
            outreach_target_per_week=t.outreach_target_per_week,
        )
        for t in teams
    ]


@router.post("/teams", response_model=TeamOut)
def create_team(
    data: TeamCreate,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN)),
):
    t = Team(
        name=data.name,
        business_area_id=data.business_area_id,
        outreach_target_per_week=data.outreach_target_per_week,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return TeamOut(
        id=t.id,
        name=t.name,
        business_area_id=t.business_area_id,
        business_area_name=t.business_area.name if t.business_area else None,
        outreach_target_per_week=t.outreach_target_per_week,
    )


# ── Sites ─────────────────────────────────────────────────────────────

@router.get("/sites", response_model=List[SiteOut])
def list_sites(
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN, RoleEnum.BA_MANAGER, RoleEnum.TEAM_MANAGER)),
):
    return [SiteOut.model_validate(s) for s in db.query(Site).order_by(Site.name).all()]


@router.post("/sites", response_model=SiteOut)
def create_site(
    data: SiteCreate,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN)),
):
    s = Site(name=data.name, country_code=data.country_code)
    db.add(s)
    db.commit()
    db.refresh(s)
    return SiteOut.model_validate(s)


# ── Site Languages ───────────────────────────────────────────────────

@router.get("/site-languages", response_model=List[SiteLanguageOut])
def list_site_languages(
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(
        RoleEnum.ADMIN, RoleEnum.BA_MANAGER, RoleEnum.TEAM_MANAGER, RoleEnum.CONSULTANT
    )),
):
    """List all site languages. Available to all roles for dropdown population."""
    return [
        SiteLanguageOut.model_validate(sl)
        for sl in db.query(SiteLanguage).filter(SiteLanguage.is_active == True).order_by(SiteLanguage.name).all()
    ]


@router.post("/site-languages", response_model=SiteLanguageOut)
def create_site_language(
    data: SiteLanguageCreate,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN, RoleEnum.BA_MANAGER)),
):
    existing = db.query(SiteLanguage).filter(SiteLanguage.name == data.name).first()
    if existing:
        if not existing.is_active:
            existing.is_active = True
            if data.code:
                existing.code = data.code
            db.commit()
            db.refresh(existing)
            return SiteLanguageOut.model_validate(existing)
        raise HTTPException(status_code=400, detail="Language already exists")

    sl = SiteLanguage(name=data.name, code=data.code)
    db.add(sl)
    db.commit()
    db.refresh(sl)
    return SiteLanguageOut.model_validate(sl)


@router.put("/site-languages/{language_id}", response_model=SiteLanguageOut)
def update_site_language(
    language_id: int,
    data: SiteLanguageUpdate,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN, RoleEnum.BA_MANAGER)),
):
    sl = db.query(SiteLanguage).filter(SiteLanguage.id == language_id).first()
    if not sl:
        raise HTTPException(status_code=404, detail="Language not found")
    if data.name is not None:
        sl.name = data.name
    if data.code is not None:
        sl.code = data.code.strip() if data.code.strip() else None
    db.commit()
    db.refresh(sl)
    return SiteLanguageOut.model_validate(sl)


@router.delete("/site-languages/{language_id}")
def delete_site_language(
    language_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN, RoleEnum.BA_MANAGER)),
):
    sl = db.query(SiteLanguage).filter(SiteLanguage.id == language_id).first()
    if not sl:
        raise HTTPException(status_code=404, detail="Language not found")
    sl.is_active = False
    db.commit()
    return {"status": "deleted"}


# ── Column Mappings ───────────────────────────────────────────────────

@router.get("/column-mappings", response_model=List[ColumnMappingOut])
def list_column_mappings(
    file_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN)),
):
    query = db.query(ColumnMapping)
    if file_type:
        query = query.filter(ColumnMapping.file_type == file_type)
    return [ColumnMappingOut.model_validate(m) for m in query.order_by(ColumnMapping.file_type, ColumnMapping.logical_field).all()]


@router.post("/column-mappings", response_model=ColumnMappingOut)
def create_column_mapping(
    data: ColumnMappingCreate,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN)),
):
    existing = db.query(ColumnMapping).filter(
        ColumnMapping.file_type == data.file_type,
        ColumnMapping.logical_field == data.logical_field,
    ).first()
    if existing:
        existing.physical_column = data.physical_column
        existing.is_required = data.is_required
        db.commit()
        db.refresh(existing)
        return ColumnMappingOut.model_validate(existing)

    m = ColumnMapping(
        file_type=data.file_type,
        logical_field=data.logical_field,
        physical_column=data.physical_column,
        is_required=data.is_required,
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return ColumnMappingOut.model_validate(m)


@router.put("/column-mappings/{mapping_id}", response_model=ColumnMappingOut)
def update_column_mapping(
    mapping_id: int,
    data: ColumnMappingUpdate,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN)),
):
    m = db.query(ColumnMapping).filter(ColumnMapping.id == mapping_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Mapping not found")
    m.physical_column = data.physical_column
    db.commit()
    db.refresh(m)
    return ColumnMappingOut.model_validate(m)


@router.post("/column-mappings/reset")
def reset_column_mappings(
    file_type: str = Query(..., description="File type to reset: contacts, meetings"),
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN, RoleEnum.BA_MANAGER)),
):
    """Delete all column mappings for a file type, forcing fresh defaults on next upload."""
    deleted = db.query(ColumnMapping).filter(ColumnMapping.file_type == file_type).delete()
    db.commit()
    return {"status": "reset", "file_type": file_type, "deleted": deleted}


# ── FX Rates (accessible to all authenticated users) ─────────────────

@router.get("/fx-rates")
def get_fx_rates(
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    """Return FX rates as {currency_code: rate} dict. Accessible to all users."""
    rates = db.query(SystemConfig).filter(SystemConfig.key.like("fx_rate_%")).all()
    return {r.key.replace("fx_rate_", ""): float(r.value) for r in rates}


# ── System Config ─────────────────────────────────────────────────────

@router.get("/config", response_model=List[SystemConfigOut])
def list_config(
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN, RoleEnum.BA_MANAGER)),
):
    return [SystemConfigOut.model_validate(c) for c in db.query(SystemConfig).order_by(SystemConfig.key).all()]


@router.put("/config/{key}", response_model=SystemConfigOut)
def update_config(
    key: str,
    data: SystemConfigUpdate,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN, RoleEnum.BA_MANAGER)),
):
    config = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    if not config:
        config = SystemConfig(key=key, value=data.value, updated_by_id=current_user.id)
        db.add(config)
    else:
        db.add(AuditLog(
            employee_id=current_user.id,
            action="update_config",
            entity_type="system_config",
            entity_id=config.id,
            old_value=config.value,
            new_value=data.value,
        ))
        config.value = data.value
        config.updated_by_id = current_user.id

    db.commit()
    db.refresh(config)
    return SystemConfigOut.model_validate(config)


@router.delete("/config/{key}")
def delete_config(
    key: str,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN, RoleEnum.BA_MANAGER)),
):
    """Delete a config entry. Only FX rate entries may be deleted for safety."""
    config = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    if not config:
        raise HTTPException(status_code=404, detail="Config entry not found")
    if not key.startswith("fx_rate_"):
        raise HTTPException(status_code=400, detail="Only FX rate entries may be deleted")
    db.add(AuditLog(
        employee_id=current_user.id,
        action="delete_config",
        entity_type="system_config",
        entity_id=config.id,
        old_value=config.value,
    ))
    db.delete(config)
    db.commit()
    return {"status": "deleted"}


# ── Suppression List ──────────────────────────────────────────────────

@router.get("/suppression-list")
def list_suppressed(
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN)),
):
    entries = db.query(SuppressionEntry).filter(SuppressionEntry.is_active == True).all()
    return [
        {
            "id": e.id,
            "contact_id": e.contact_id,
            "reason": e.reason,
            "added_by_id": e.added_by_id,
            "hubspot_update_required": e.hubspot_update_required,
            "created_at": e.created_at,
        }
        for e in entries
    ]


@router.delete("/suppression-list/{entry_id}")
def remove_suppression(
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN)),
):
    entry = db.query(SuppressionEntry).filter(SuppressionEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Suppression entry not found")

    from datetime import datetime, timezone
    entry.is_active = False
    entry.removed_by_id = current_user.id
    entry.removed_at = datetime.now(timezone.utc)

    contact = db.query(Contact).filter(Contact.id == entry.contact_id).first()
    if contact:
        contact.status = ContactStatusEnum.ACTIVE

    db.add(AuditLog(
        employee_id=current_user.id,
        action="remove_suppression",
        entity_type="suppression_entry",
        entity_id=entry.id,
        details=f"Removed suppression for contact {entry.contact_id}",
    ))
    db.commit()
    return {"status": "removed"}


# ── Audit Log ─────────────────────────────────────────────────────────

@router.get("/audit-log", response_model=List[AuditLogOut])
def list_audit_log(
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN)),
):
    query = db.query(AuditLog)
    if entity_type:
        query = query.filter(AuditLog.entity_type == entity_type)
    if entity_id:
        query = query.filter(AuditLog.entity_id == entity_id)

    logs = (
        query.order_by(AuditLog.timestamp.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return [AuditLogOut.model_validate(log) for log in logs]


# ── System Reset ─────────────────────────────────────────────────────

@router.get("/reset-preview")
def reset_preview(
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN)),
):
    """Return counts of all data that would be cleared by a system reset."""
    upload_dir = Path(__file__).resolve().parent.parent.parent / "uploads" / "consultants"
    files_on_disk = list(upload_dir.iterdir()) if upload_dir.exists() else []
    total_size = sum(f.stat().st_size for f in files_on_disk if f.is_file())

    imported_consultants = db.query(Employee).filter(
        Employee.uploaded_batch_id.isnot(None),
        Employee.role == RoleEnum.CONSULTANT,
    ).count()

    return {
        "contacts_count": db.query(Contact).count(),
        "meetings_count": db.query(Meeting).count(),
        "outreach_records_count": db.query(OutreachRecord).count(),
        "negations_count": db.query(Negation).count(),
        "campaigns_count": db.query(Campaign).count(),
        "campaign_recipients_count": db.query(CampaignRecipient).count(),
        "campaign_attachments_count": db.query(CampaignAttachment).count(),
        "suppression_entries_count": db.query(SuppressionEntry).filter(
            SuppressionEntry.is_active == True
        ).count(),
        "imported_consultants_count": imported_consultants,
        "jobtitle_domains_count": db.query(JobTitleDomain).count(),
        "classification_lookups_count": db.query(ClassificationLookup).count(),
        "file_uploads_count": db.query(FileUpload).count(),
        "files_on_disk_count": len([f for f in files_on_disk if f.is_file()]),
        "files_on_disk_size_mb": round(total_size / (1024 * 1024), 2),
    }


@router.post("/reset-backup")
def reset_backup(
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN)),
):
    """Generate and download a JSON backup of interaction data before reset."""
    from datetime import datetime, timezone

    # Gather outreach records that represent real interactions (not just proposals)
    from app.models.models import OutreachStatusEnum
    interaction_statuses = {
        OutreachStatusEnum.DRAFT,
        OutreachStatusEnum.PREPARED,
        OutreachStatusEnum.SENT,
        OutreachStatusEnum.REPLIED,
        OutreachStatusEnum.MEETING_BOOKED,
        OutreachStatusEnum.CLOSED_MET,
        OutreachStatusEnum.CLOSED_NO_RESPONSE,
        OutreachStatusEnum.CLOSED_NOT_RELEVANT,
        OutreachStatusEnum.CLOSED_BOUNCED,
    }
    outreach_records = (
        db.query(OutreachRecord)
        .options(joinedload(OutreachRecord.contact), joinedload(OutreachRecord.employee))
        .filter(OutreachRecord.status.in_(interaction_statuses))
        .all()
    )
    outreach_data = []
    for o in outreach_records:
        outreach_data.append({
            "id": o.id,
            "contact_id": o.contact_id,
            "contact_full_name": o.contact.full_name if o.contact else None,
            "contact_email": o.contact.email if o.contact else None,
            "contact_company": o.contact.company_name if o.contact else None,
            "contact_job_title": o.contact.job_title if o.contact else None,
            "employee_id": o.employee_id,
            "employee_name": o.employee.name if o.employee else None,
            "employee_email": o.employee.email if o.employee else None,
            "status": o.status.value if o.status else None,
            "email_subject": o.email_subject,
            "email_body": o.email_body,
            "email_language": o.email_language.value if o.email_language else None,
            "sent_at": o.sent_at.isoformat() if o.sent_at else None,
            "outcome": o.outcome,
            "outcome_notes": o.outcome_notes,
            "recommendation_score": o.recommendation_score,
            "created_at": o.created_at.isoformat() if o.created_at else None,
            "updated_at": o.updated_at.isoformat() if o.updated_at else None,
        })

    # Gather negations with contact context via outreach
    negations = (
        db.query(Negation)
        .options(joinedload(Negation.outreach_record).joinedload(OutreachRecord.contact))
        .options(joinedload(Negation.employee))
        .all()
    )
    negation_data = []
    for n in negations:
        contact = n.outreach_record.contact if n.outreach_record else None
        negation_data.append({
            "id": n.id,
            "outreach_record_id": n.outreach_record_id,
            "contact_full_name": contact.full_name if contact else None,
            "contact_email": contact.email if contact else None,
            "employee_id": n.employee_id,
            "employee_name": n.employee.name if n.employee else None,
            "reason": n.reason.value if n.reason else None,
            "notes": n.notes,
            "created_at": n.created_at.isoformat() if n.created_at else None,
        })

    # Gather active suppression entries
    suppressions = db.query(SuppressionEntry).filter(SuppressionEntry.is_active == True).all()
    suppression_data = []
    for s in suppressions:
        contact = db.query(Contact).filter(Contact.id == s.contact_id).first()
        added_by = db.query(Employee).filter(Employee.id == s.added_by_id).first()
        suppression_data.append({
            "id": s.id,
            "contact_id": s.contact_id,
            "contact_full_name": contact.full_name if contact else None,
            "contact_email": contact.email if contact else None,
            "contact_company": contact.company_name if contact else None,
            "reason": s.reason,
            "added_by_id": s.added_by_id,
            "added_by_name": added_by.name if added_by else None,
            "is_active": s.is_active,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        })

    # Derive blocked_contacts from negations with blocking reasons
    from app.models.models import NegationReasonEnum
    blocking_reasons = {
        NegationReasonEnum.SENSITIVE_SITUATION,
        NegationReasonEnum.NOT_APPROPRIATE_TIMING,
        NegationReasonEnum.DO_NOT_CONTACT,
    }
    blocked_contacts_data = []
    seen_blocked_emails: set = set()
    for n in negation_data:
        reason = n.get("reason")
        email = n.get("contact_email")
        if reason in {r.value for r in blocking_reasons} and email and email not in seen_blocked_emails:
            seen_blocked_emails.add(email)
            blocked_contacts_data.append({
                "contact_email": email,
                "contact_full_name": n.get("contact_full_name"),
                "reason": reason,
                "negated_by": n.get("employee_name"),
                "negated_at": n.get("created_at"),
                "notes": n.get("notes"),
            })

    # Gather campaign data
    campaigns = (
        db.query(Campaign)
        .options(joinedload(Campaign.created_by))
        .all()
    )
    campaign_data = []
    for c in campaigns:
        campaign_data.append({
            "id": c.id,
            "name": c.name,
            "description": c.description,
            "email_subject": c.email_subject,
            "email_body": c.email_body,
            "email_language": c.email_language.value if c.email_language else None,
            "template_id": c.template_id,
            "bcc_mode": c.bcc_mode,
            "status": c.status.value if c.status else None,
            "created_by_id": c.created_by_id,
            "created_by_email": c.created_by.email if c.created_by else None,
            "scheduled_at": c.scheduled_at.isoformat() if c.scheduled_at else None,
            "sent_at": c.sent_at.isoformat() if c.sent_at else None,
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "updated_at": c.updated_at.isoformat() if c.updated_at else None,
        })

    # Gather campaign recipients with contact context
    campaign_recipients = (
        db.query(CampaignRecipient)
        .options(joinedload(CampaignRecipient.contact))
        .all()
    )
    campaign_recipient_data = []
    for cr in campaign_recipients:
        campaign_recipient_data.append({
            "id": cr.id,
            "campaign_id": cr.campaign_id,
            "contact_id": cr.contact_id,
            "contact_email": cr.contact.email if cr.contact else None,
            "contact_full_name": cr.contact.full_name if cr.contact else None,
            "contact_company": cr.contact.company_name if cr.contact else None,
            "status": cr.status.value if cr.status else None,
            "sent_at": cr.sent_at.isoformat() if cr.sent_at else None,
            "error_message": cr.error_message,
            "created_at": cr.created_at.isoformat() if cr.created_at else None,
        })

    # Gather campaign attachment metadata
    campaign_attachments = db.query(CampaignAttachment).filter(
        CampaignAttachment.is_active == True
    ).all()
    campaign_attachment_data = []
    for ca in campaign_attachments:
        campaign_attachment_data.append({
            "id": ca.id,
            "campaign_id": ca.campaign_id,
            "original_filename": ca.original_filename,
            "display_name": ca.display_name,
            "stored_filename": ca.stored_filename,
            "content_type": ca.content_type,
            "file_size_bytes": ca.file_size_bytes,
        })

    # Gather contact enrichments (expert_areas, is_decision_maker, name/email edits)
    # These fields are manually curated and NOT available in CRM exports,
    # so they must be preserved across resets.
    # Also include contacts with audit-logged name/email changes
    edited_contact_ids = [
        r[0] for r in db.query(AuditLog.entity_id).filter(
            AuditLog.entity_type == "contact",
            AuditLog.action.in_(["update_contact_name", "update_contact_email"]),
        ).distinct().all()
    ]
    enriched_contacts = db.query(Contact).filter(
        or_(
            Contact.expert_areas.isnot(None),
            Contact.is_decision_maker == True,
            Contact.original_job_title.isnot(None),
            Contact.id.in_(edited_contact_ids) if edited_contact_ids else False,
        )
    ).all()
    contact_enrichment_data = []
    for ec in enriched_contacts:
        contact_enrichment_data.append({
            "contact_email": ec.email,
            "contact_full_name": ec.full_name,
            "contact_company": ec.company_name,
            "first_name": ec.first_name,
            "last_name": ec.last_name,
            "expert_areas": ec.expert_areas,
            "is_decision_maker": ec.is_decision_maker,
            "job_title": ec.job_title,
            "original_job_title": ec.original_job_title,
        })

    backup = {
        "backup_version": "1.4",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user.email,
        "summary": {
            "outreach_records_count": len(outreach_data),
            "negations_count": len(negation_data),
            "suppression_entries_count": len(suppression_data),
            "blocked_contacts_count": len(blocked_contacts_data),
            "campaigns_count": len(campaign_data),
            "campaign_recipients_count": len(campaign_recipient_data),
            "campaign_attachments_count": len(campaign_attachment_data),
            "contact_enrichments_count": len(contact_enrichment_data),
        },
        "outreach_records": outreach_data,
        "negations": negation_data,
        "suppression_list": suppression_data,
        "blocked_contacts": blocked_contacts_data,
        "campaigns": campaign_data,
        "campaign_recipients": campaign_recipient_data,
        "campaign_attachments": campaign_attachment_data,
        "contact_enrichments": contact_enrichment_data,
    }

    json_bytes = json.dumps(backup, indent=2, ensure_ascii=False).encode("utf-8")
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

    return StreamingResponse(
        BytesIO(json_bytes),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="salessupport_backup_{timestamp}.json"'},
    )


@router.post("/reset-execute")
def reset_execute(
    data: ResetExecuteRequest,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN)),
):
    """Execute a full system reset — deletes all imported & interaction data."""
    if data.confirmation_text != "RESET":
        raise HTTPException(status_code=400, detail="Confirmation text must be exactly 'RESET'")
    if not data.backup_downloaded:
        raise HTTPException(status_code=400, detail="You must download the backup before resetting")

    try:
        # Delete in FK-safe order
        campaign_attachments_deleted = db.query(CampaignAttachment).delete()
        campaign_recipients_deleted = db.query(CampaignRecipient).delete()
        campaigns_deleted = db.query(Campaign).delete()
        negations_deleted = db.query(Negation).delete()
        suppression_deleted = db.query(SuppressionEntry).delete()
        outreach_deleted = db.query(OutreachRecord).delete()
        meetings_deleted = db.query(Meeting).delete()
        contacts_deleted = db.query(Contact).delete()
        jobtitle_deleted = db.query(JobTitleDomain).delete()
        classification_deleted = db.query(ClassificationLookup).delete()
        file_uploads_deleted = db.query(FileUpload).delete()

        # Delete imported consultants (employees with uploaded_batch_id + consultant role)
        # Preserves admin/manager accounts even if they have a batch_id
        imported_ids = [
            e.id for e in
            db.query(Employee.id).filter(
                Employee.uploaded_batch_id.isnot(None),
                Employee.role == RoleEnum.CONSULTANT,
            ).all()
        ]
        consultants_deleted = 0
        if imported_ids:
            # Nullify FK references in preserved tables that point to imported employees
            db.query(AuditLog).filter(
                AuditLog.employee_id.in_(imported_ids)
            ).update({AuditLog.employee_id: None}, synchronize_session="fetch")
            db.query(EmailTemplate).filter(
                EmailTemplate.created_by_id.in_(imported_ids)
            ).update({EmailTemplate.created_by_id: None}, synchronize_session="fetch")
            db.query(TemplateAttachment).filter(
                TemplateAttachment.uploaded_by_id.in_(imported_ids)
            ).update({TemplateAttachment.uploaded_by_id: None}, synchronize_session="fetch")
            db.query(HotTopic).filter(
                HotTopic.created_by_id.in_(imported_ids)
            ).update({HotTopic.created_by_id: None}, synchronize_session="fetch")
            db.query(SystemConfig).filter(
                SystemConfig.updated_by_id.in_(imported_ids)
            ).update({SystemConfig.updated_by_id: None}, synchronize_session="fetch")
            db.query(FileUpload).filter(
                FileUpload.uploaded_by_id.in_(imported_ids)
            ).update({FileUpload.uploaded_by_id: None}, synchronize_session="fetch")

            # Remove site_language associations, then the employees
            db.query(EmployeeSiteLanguage).filter(
                EmployeeSiteLanguage.employee_id.in_(imported_ids)
            ).delete(synchronize_session="fetch")
            consultants_deleted = db.query(Employee).filter(
                Employee.id.in_(imported_ids)
            ).delete(synchronize_session="fetch")

        # Clean physical files in uploads/consultants/
        upload_dir = Path(__file__).resolve().parent.parent.parent / "uploads" / "consultants"
        files_removed = 0
        if upload_dir.exists():
            for f in upload_dir.iterdir():
                if f.is_file():
                    try:
                        f.unlink()
                        files_removed += 1
                    except OSError:
                        pass

        # Clean campaign attachment files
        ca_dir = Path(__file__).resolve().parent.parent.parent / "uploads" / "campaign-attachments"
        if ca_dir.exists():
            for f in ca_dir.iterdir():
                if f.is_file():
                    try:
                        f.unlink()
                    except OSError:
                        pass

        # Audit log entry
        db.add(AuditLog(
            employee_id=current_user.id,
            action="system_reset",
            entity_type="system",
            entity_id=None,
            details=json.dumps({
                "contacts": contacts_deleted,
                "meetings": meetings_deleted,
                "outreach_records": outreach_deleted,
                "negations": negations_deleted,
                "campaigns": campaigns_deleted,
                "campaign_recipients": campaign_recipients_deleted,
                "campaign_attachments": campaign_attachments_deleted,
                "suppression_entries": suppression_deleted,
                "imported_consultants": consultants_deleted,
                "jobtitle_domains": jobtitle_deleted,
                "classification_lookups": classification_deleted,
                "file_uploads": file_uploads_deleted,
                "files_on_disk": files_removed,
            }),
        ))
        db.commit()

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Reset failed: {str(e)}")

    return {
        "status": "reset_complete",
        "deleted": {
            "contacts": contacts_deleted,
            "meetings": meetings_deleted,
            "outreach_records": outreach_deleted,
            "negations": negations_deleted,
            "campaigns": campaigns_deleted,
            "campaign_recipients": campaign_recipients_deleted,
            "campaign_attachments": campaign_attachments_deleted,
            "suppression_entries": suppression_deleted,
            "imported_consultants": consultants_deleted,
            "jobtitle_domains": jobtitle_deleted,
            "classification_lookups": classification_deleted,
            "file_uploads": file_uploads_deleted,
            "files_on_disk": files_removed,
        },
    }


@router.post("/reset-restore")
async def reset_restore(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN)),
):
    """Restore interaction knowledge from a previously downloaded backup."""
    if not file.filename or not file.filename.endswith(".json"):
        raise HTTPException(status_code=400, detail="Only .json backup files are accepted")

    content = await file.read()
    try:
        backup = json.loads(content.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON file: {str(e)}")

    if backup.get("backup_version") not in ("1.0", "1.1", "1.2", "1.3", "1.4"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported backup version: {backup.get('backup_version')}",
        )

    warnings: List[str] = []
    suppression_restored = 0
    contacts_flagged = 0

    # 1. Restore suppression entries — match by contact email
    for entry in backup.get("suppression_list", []):
        contact_email = entry.get("contact_email")
        if not contact_email:
            warnings.append(f"Suppression entry #{entry.get('id')} has no email, skipped")
            continue

        contact = db.query(Contact).filter(Contact.email == contact_email).first()
        if not contact:
            warnings.append(
                f"Contact '{entry.get('contact_full_name')}' ({contact_email}) not found, suppression skipped"
            )
            continue

        existing = db.query(SuppressionEntry).filter(
            SuppressionEntry.contact_id == contact.id,
            SuppressionEntry.is_active == True,
        ).first()
        if existing:
            warnings.append(f"Contact '{contact_email}' already suppressed, skipped")
            continue

        db.add(SuppressionEntry(
            contact_id=contact.id,
            reason=f"Restored from backup ({entry.get('reason', 'unknown')})",
            added_by_id=current_user.id,
        ))
        contact.status = ContactStatusEnum.SUPPRESSED
        suppression_restored += 1

    # 2. Flag contacts that were previously contacted (sent, replied, etc.)
    contacted_statuses = {
        "sent", "replied", "meeting_booked", "closed_met",
        "closed_no_response", "closed_not_relevant", "closed_bounced",
        "prepared",
    }
    contacted_emails: set = set()
    for record in backup.get("outreach_records", []):
        if record.get("status") in contacted_statuses and record.get("contact_email"):
            contacted_emails.add(record["contact_email"].lower())

    for email in contacted_emails:
        contact = db.query(Contact).filter(Contact.email.ilike(email)).first()
        if contact:
            contact.contacted_last_1y = True
            contacts_flagged += 1

    # 3. Restore blocked contacts (from negations with blocking reasons)
    blocked_contacts_restored = 0
    for entry in backup.get("blocked_contacts", []):
        contact_email = entry.get("contact_email")
        if not contact_email:
            continue

        contact = db.query(Contact).filter(Contact.email.ilike(contact_email)).first()
        if not contact:
            warnings.append(
                f"Blocked contact '{entry.get('contact_full_name')}' ({contact_email}) not found, skipped"
            )
            continue

        # Skip if already suppressed
        existing = db.query(SuppressionEntry).filter(
            SuppressionEntry.contact_id == contact.id,
            SuppressionEntry.is_active == True,
        ).first()
        if existing:
            continue

        reason = entry.get("reason", "unknown")
        db.add(SuppressionEntry(
            contact_id=contact.id,
            reason=f"Restored from backup: {reason} (negated by {entry.get('negated_by', 'unknown')})",
            added_by_id=current_user.id,
        ))
        contact.status = ContactStatusEnum.SUPPRESSED
        blocked_contacts_restored += 1

    # 4. Restore campaigns and campaign recipients (v1.1+)
    campaigns_restored = 0
    campaign_recipients_restored = 0
    for camp in backup.get("campaigns", []):
        # Match creator by email
        creator = None
        if camp.get("created_by_email"):
            creator = db.query(Employee).filter(
                Employee.email == camp["created_by_email"]
            ).first()

        new_campaign = Campaign(
            name=camp.get("name", "Restored Campaign"),
            description=camp.get("description"),
            email_subject=camp.get("email_subject", ""),
            email_body=camp.get("email_body", ""),
            email_language=camp.get("email_language", "en"),
            template_id=None,  # template IDs may not match after reset
            bcc_mode=camp.get("bcc_mode", True),
            status=camp.get("status", "draft"),
            created_by_id=creator.id if creator else current_user.id,
        )
        if camp.get("sent_at"):
            from datetime import datetime as dt
            try:
                new_campaign.sent_at = dt.fromisoformat(camp["sent_at"])
            except (ValueError, TypeError):
                pass
        db.add(new_campaign)
        db.flush()  # get the new campaign ID

        # Restore recipients for this campaign
        old_campaign_id = camp.get("id")
        for cr in backup.get("campaign_recipients", []):
            if cr.get("campaign_id") != old_campaign_id:
                continue
            # Match contact by email
            contact = None
            if cr.get("contact_email"):
                contact = db.query(Contact).filter(
                    Contact.email.ilike(cr["contact_email"])
                ).first()
            if not contact:
                warnings.append(
                    f"Campaign recipient '{cr.get('contact_full_name')}' "
                    f"({cr.get('contact_email')}) not found, skipped"
                )
                continue

            # Check for duplicates
            existing = db.query(CampaignRecipient).filter(
                CampaignRecipient.campaign_id == new_campaign.id,
                CampaignRecipient.contact_id == contact.id,
            ).first()
            if existing:
                continue

            new_cr = CampaignRecipient(
                campaign_id=new_campaign.id,
                contact_id=contact.id,
                status=cr.get("status", "pending"),
            )
            if cr.get("sent_at"):
                try:
                    new_cr.sent_at = dt.fromisoformat(cr["sent_at"])
                except (ValueError, TypeError):
                    pass
            new_cr.error_message = cr.get("error_message")
            db.add(new_cr)
            campaign_recipients_restored += 1

        campaigns_restored += 1

    # 5. Restore contact enrichments (expert_areas, is_decision_maker) — v1.2+
    contact_enrichments_restored = 0
    for entry in backup.get("contact_enrichments", []):
        contact_email = entry.get("contact_email")
        if not contact_email:
            continue

        contact = db.query(Contact).filter(Contact.email.ilike(contact_email)).first()
        if not contact:
            warnings.append(
                f"Enrichment for '{entry.get('contact_full_name')}' ({contact_email}) "
                f"not found in current contacts, skipped"
            )
            continue

        updated = False
        if entry.get("expert_areas") and not contact.expert_areas:
            contact.expert_areas = entry["expert_areas"]
            updated = True
        if entry.get("is_decision_maker") and not contact.is_decision_maker:
            contact.is_decision_maker = True
            updated = True
        # Restore edited job titles
        if entry.get("original_job_title"):
            contact.original_job_title = entry["original_job_title"]
            if entry.get("job_title") and entry["job_title"] != entry["original_job_title"]:
                contact.job_title = entry["job_title"]
            updated = True

        # Restore name edits (v1.4+)
        if entry.get("first_name") and entry["first_name"] != contact.first_name:
            contact.first_name = entry["first_name"]
            updated = True
        if entry.get("last_name") and entry["last_name"] != contact.last_name:
            contact.last_name = entry["last_name"]
            updated = True
        # Recompute full_name if name parts were restored
        if entry.get("first_name") or entry.get("last_name"):
            parts = [contact.first_name or "", contact.last_name or ""]
            computed = " ".join(p for p in parts if p).strip()
            if computed:
                contact.full_name = computed

        if updated:
            contact_enrichments_restored += 1

    # Audit log
    db.add(AuditLog(
        employee_id=current_user.id,
        action="restore_backup",
        entity_type="system",
        entity_id=None,
        details=json.dumps({
            "backup_created_at": backup.get("created_at"),
            "backup_created_by": backup.get("created_by"),
            "suppression_restored": suppression_restored,
            "contacts_flagged": contacts_flagged,
            "blocked_contacts_restored": blocked_contacts_restored,
            "campaigns_restored": campaigns_restored,
            "campaign_recipients_restored": campaign_recipients_restored,
            "contact_enrichments_restored": contact_enrichments_restored,
            "warnings_count": len(warnings),
        }),
    ))
    db.commit()

    return {
        "status": "restore_complete",
        "suppression_restored": suppression_restored,
        "contacts_flagged": contacts_flagged,
        "blocked_contacts_restored": blocked_contacts_restored,
        "campaigns_restored": campaigns_restored,
        "campaign_recipients_restored": campaign_recipients_restored,
        "contact_enrichments_restored": contact_enrichments_restored,
        "warnings": warnings,
    }
