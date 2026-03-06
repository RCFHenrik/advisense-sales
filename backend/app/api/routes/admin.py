from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import require_role
from app.models.models import (
    Employee, RoleEnum, BusinessArea, Team, Site, SystemConfig,
    ColumnMapping, AuditLog, SuppressionEntry, Contact, ContactStatusEnum,
    BankHoliday, SiteLanguage,
)
from app.schemas.schemas import (
    BusinessAreaOut, BusinessAreaCreate, TeamOut, TeamCreate,
    SiteOut, SiteCreate, SystemConfigOut, SystemConfigUpdate,
    ColumnMappingOut, ColumnMappingCreate, ColumnMappingUpdate,
    AuditLogOut, SiteLanguageOut, SiteLanguageCreate,
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
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN)),
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
