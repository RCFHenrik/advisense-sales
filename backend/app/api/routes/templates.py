import os
import uuid
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_user, require_role
from app.models.models import EmailTemplate, TemplateAttachment, Employee, RoleEnum, LanguageEnum
from app.schemas.schemas import (
    EmailTemplateOut, EmailTemplateCreate, EmailTemplateUpdate,
    TemplateAttachmentOut, TemplateAttachmentRename,
)

router = APIRouter()

# Roles that may create / edit / delete official templates
_CREATOR_ROLES = (RoleEnum.ADMIN, RoleEnum.BA_MANAGER, RoleEnum.TEAM_MANAGER)

ALLOWED_ATTACHMENT_TYPES = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/vnd.ms-powerpoint": ".ppt",
}
MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024  # 25 MB

UPLOAD_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "uploads", "attachments")
)


def _ensure_upload_dir():
    os.makedirs(UPLOAD_DIR, exist_ok=True)


# ── Template CRUD ────────────────────────────────────────────────────


@router.get("/", response_model=List[EmailTemplateOut])
def list_templates(
    language: Optional[LanguageEnum] = None,
    responsibility_domain: Optional[str] = None,
    active_only: bool = True,
    include_personal: bool = True,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    # Official templates
    official_q = db.query(EmailTemplate).filter(EmailTemplate.is_personal == False)
    if active_only:
        official_q = official_q.filter(EmailTemplate.is_active == True)
    if language:
        official_q = official_q.filter(EmailTemplate.language == language)
    if responsibility_domain:
        official_q = official_q.filter(EmailTemplate.responsibility_domain == responsibility_domain)

    if current_user.role != RoleEnum.ADMIN:
        official_q = official_q.filter(
            or_(
                EmailTemplate.business_area_id == current_user.business_area_id,
                EmailTemplate.business_area_id == None,
            )
        )

    results = list(official_q.order_by(EmailTemplate.name).all())

    # Personal templates for the current user
    if include_personal:
        personal_q = db.query(EmailTemplate).filter(
            EmailTemplate.is_personal == True,
            EmailTemplate.created_by_id == current_user.id,
        )
        if language:
            personal_q = personal_q.filter(EmailTemplate.language == language)
        if responsibility_domain:
            personal_q = personal_q.filter(EmailTemplate.responsibility_domain == responsibility_domain)
        results.extend(personal_q.order_by(EmailTemplate.name).all())

    return [EmailTemplateOut.model_validate(t) for t in results]


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
    current_user: Employee = Depends(get_current_user),
):
    if data.is_personal:
        # Any user can create personal templates
        t = EmailTemplate(
            name=data.name,
            business_area_id=None,
            responsibility_domain=data.responsibility_domain,
            language=data.language,
            subject_template=data.subject_template,
            body_template=data.body_template,
            created_by_id=current_user.id,
            version="1.0",
            is_active=True,
            is_personal=True,
        )
    else:
        # Official templates require creator roles
        if current_user.role not in _CREATOR_ROLES:
            raise HTTPException(status_code=403, detail="Insufficient permissions for official templates")

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
            is_active=False,
            is_personal=False,
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
    current_user: Employee = Depends(get_current_user),
):
    t = db.query(EmailTemplate).filter(EmailTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")

    # Authorization
    if t.is_personal:
        if t.created_by_id != current_user.id:
            raise HTTPException(status_code=403, detail="Cannot edit another user's personal template")
    else:
        if current_user.role not in _CREATOR_ROLES:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        if current_user.role != RoleEnum.ADMIN:
            if t.business_area_id is not None and t.business_area_id != current_user.business_area_id:
                raise HTTPException(status_code=403, detail="Cannot edit a template from another business area")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(t, key, value)

    if update_data.get("is_active") is True:
        t.published_at = datetime.now(timezone.utc)

    # Bump version on every save
    parts = t.version.split(".")
    t.version = f"{parts[0]}.{int(parts[-1]) + 1:02d}"

    db.commit()
    db.refresh(t)
    return EmailTemplateOut.model_validate(t)


@router.delete("/{template_id}", status_code=204)
def delete_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    t = db.query(EmailTemplate).filter(EmailTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")

    if t.is_personal:
        if t.created_by_id != current_user.id:
            raise HTTPException(status_code=403, detail="Cannot delete another user's personal template")
    else:
        if current_user.role not in _CREATOR_ROLES:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        if current_user.role != RoleEnum.ADMIN:
            if t.business_area_id is not None and t.business_area_id != current_user.business_area_id:
                raise HTTPException(status_code=403, detail="Cannot delete a template from another business area")

    db.delete(t)
    db.commit()


# ── Attachment CRUD ──────────────────────────────────────────────────


@router.post("/{template_id}/attachments", response_model=TemplateAttachmentOut)
async def upload_attachment(
    template_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    t = db.query(EmailTemplate).filter(EmailTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")

    # Authorization: personal template owner or official template creator role
    if t.is_personal:
        if t.created_by_id != current_user.id:
            raise HTTPException(status_code=403, detail="Not your template")
    elif current_user.role not in _CREATOR_ROLES:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    if file.content_type not in ALLOWED_ATTACHMENT_TYPES:
        raise HTTPException(status_code=400, detail="Only PDF and PowerPoint files are allowed")

    content = await file.read()
    if len(content) > MAX_ATTACHMENT_SIZE:
        raise HTTPException(status_code=400, detail="File exceeds 25 MB limit")

    _ensure_upload_dir()
    ext = ALLOWED_ATTACHMENT_TYPES[file.content_type]
    stored_name = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(UPLOAD_DIR, stored_name)
    with open(file_path, "wb") as f:
        f.write(content)

    attachment = TemplateAttachment(
        template_id=template_id,
        original_filename=file.filename,
        display_name=os.path.splitext(file.filename)[0],
        stored_filename=stored_name,
        content_type=file.content_type,
        file_size_bytes=len(content),
        uploaded_by_id=current_user.id,
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    return TemplateAttachmentOut.model_validate(attachment)


@router.get("/{template_id}/attachments", response_model=List[TemplateAttachmentOut])
def list_attachments(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    t = db.query(EmailTemplate).filter(EmailTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    attachments = (
        db.query(TemplateAttachment)
        .filter(TemplateAttachment.template_id == template_id, TemplateAttachment.is_active == True)
        .all()
    )
    return [TemplateAttachmentOut.model_validate(a) for a in attachments]


@router.get("/{template_id}/attachments/{attachment_id}/download")
def download_attachment(
    template_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    a = (
        db.query(TemplateAttachment)
        .filter(TemplateAttachment.id == attachment_id, TemplateAttachment.template_id == template_id)
        .first()
    )
    if not a:
        raise HTTPException(status_code=404, detail="Attachment not found")
    file_path = os.path.join(UPLOAD_DIR, a.stored_filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found on disk")
    ext = os.path.splitext(a.stored_filename)[1]
    return FileResponse(file_path, filename=f"{a.display_name}{ext}", media_type=a.content_type)


@router.put("/{template_id}/attachments/{attachment_id}", response_model=TemplateAttachmentOut)
def rename_attachment(
    template_id: int,
    attachment_id: int,
    data: TemplateAttachmentRename,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    a = (
        db.query(TemplateAttachment)
        .filter(TemplateAttachment.id == attachment_id, TemplateAttachment.template_id == template_id)
        .first()
    )
    if not a:
        raise HTTPException(status_code=404, detail="Attachment not found")
    a.display_name = data.display_name
    db.commit()
    db.refresh(a)
    return TemplateAttachmentOut.model_validate(a)


@router.delete("/{template_id}/attachments/{attachment_id}", status_code=204)
def remove_attachment(
    template_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    a = (
        db.query(TemplateAttachment)
        .filter(TemplateAttachment.id == attachment_id, TemplateAttachment.template_id == template_id)
        .first()
    )
    if not a:
        raise HTTPException(status_code=404, detail="Attachment not found")
    a.is_active = False
    db.commit()
