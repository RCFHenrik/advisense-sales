from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_user, require_role
from app.models.models import EmailTemplate, Employee, RoleEnum, LanguageEnum
from app.schemas.schemas import EmailTemplateOut, EmailTemplateCreate, EmailTemplateUpdate

router = APIRouter()

# Roles that may create / edit / delete templates
_CREATOR_ROLES = (RoleEnum.ADMIN, RoleEnum.BA_MANAGER, RoleEnum.TEAM_MANAGER)


@router.get("/", response_model=List[EmailTemplateOut])
def list_templates(
    language: Optional[LanguageEnum] = None,
    responsibility_domain: Optional[str] = None,
    active_only: bool = True,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    query = db.query(EmailTemplate)
    if active_only:
        query = query.filter(EmailTemplate.is_active == True)
    if language:
        query = query.filter(EmailTemplate.language == language)
    if responsibility_domain:
        query = query.filter(EmailTemplate.responsibility_domain == responsibility_domain)

    # BA scoping: non-admins see their own BA's templates + general (NULL) templates
    if current_user.role != RoleEnum.ADMIN:
        query = query.filter(
            or_(
                EmailTemplate.business_area_id == current_user.business_area_id,
                EmailTemplate.business_area_id == None,
            )
        )

    return [EmailTemplateOut.model_validate(t) for t in query.order_by(EmailTemplate.name).all()]


@router.get("/{template_id}", response_model=EmailTemplateOut)
def get_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    t = db.query(EmailTemplate).filter(EmailTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    return EmailTemplateOut.model_validate(t)


@router.post("/", response_model=EmailTemplateOut)
def create_template(
    data: EmailTemplateCreate,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(*_CREATOR_ROLES)),
):
    # Determine BA: use explicitly provided value; otherwise inherit from creator (admin defaults to None = general)
    if data.business_area_id is not None:
        ba_id = data.business_area_id
    elif current_user.role == RoleEnum.ADMIN:
        ba_id = None
    else:
        ba_id = current_user.business_area_id

    t = EmailTemplate(
        name=data.name,
        business_area_id=ba_id,
        responsibility_domain=data.responsibility_domain,
        language=data.language,
        subject_template=data.subject_template,
        body_template=data.body_template,
        created_by_id=current_user.id,
        version="1.0",
        is_active=False,  # all new templates start as drafts
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return EmailTemplateOut.model_validate(t)


@router.put("/{template_id}", response_model=EmailTemplateOut)
def update_template(
    template_id: int,
    data: EmailTemplateUpdate,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(*_CREATOR_ROLES)),
):
    t = db.query(EmailTemplate).filter(EmailTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")

    # Non-admins cannot edit templates belonging to another BA
    if current_user.role != RoleEnum.ADMIN:
        if t.business_area_id is not None and t.business_area_id != current_user.business_area_id:
            raise HTTPException(status_code=403, detail="Cannot edit a template from another business area")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(t, key, value)

    # Record publish timestamp whenever is_active is explicitly set to True
    if update_data.get("is_active") is True:
        t.published_at = datetime.now(timezone.utc)

    # Bump version on every save (zero-pad minor to 2 digits: 1.0 → 1.01 → 1.02 … 1.09 → 1.10)
    parts = t.version.split(".")
    t.version = f"{parts[0]}.{int(parts[-1]) + 1:02d}"

    db.commit()
    db.refresh(t)
    return EmailTemplateOut.model_validate(t)


@router.delete("/{template_id}", status_code=204)
def delete_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(*_CREATOR_ROLES)),
):
    t = db.query(EmailTemplate).filter(EmailTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")

    # Non-admins cannot delete templates belonging to another BA
    if current_user.role != RoleEnum.ADMIN:
        if t.business_area_id is not None and t.business_area_id != current_user.business_area_id:
            raise HTTPException(status_code=403, detail="Cannot delete a template from another business area")

    db.delete(t)
    db.commit()
