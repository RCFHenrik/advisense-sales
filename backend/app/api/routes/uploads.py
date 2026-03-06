import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_user, require_role
from app.models.models import Employee, RoleEnum, FileUpload
from app.services.excel_import import ExcelImportService
from app.schemas.schemas import FileUploadOut, UploadDiffSummary

router = APIRouter()

ALLOWED_DATA_EXTENSIONS = (".xlsx", ".xls", ".csv")


@router.post("/contacts", response_model=UploadDiffSummary)
async def upload_contacts(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN, RoleEnum.BA_MANAGER)),
):
    if not file.filename.endswith(ALLOWED_DATA_EXTENSIONS):
        raise HTTPException(status_code=400, detail="Only .xlsx, .xls, or .csv files are accepted")

    content = await file.read()
    service = ExcelImportService(db)
    batch_id = str(uuid.uuid4())[:8]

    try:
        summary = service.import_contacts(content, batch_id, current_user.id, filename=file.filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    db.add(FileUpload(
        file_type="contacts",
        filename=file.filename,
        row_count=summary.total_rows,
        added_count=summary.added,
        updated_count=summary.updated,
        removed_count=summary.removed,
        uploaded_by_id=current_user.id,
        batch_id=batch_id,
    ))
    db.commit()

    return summary


@router.post("/meetings", response_model=UploadDiffSummary)
async def upload_meetings(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN, RoleEnum.BA_MANAGER)),
):
    if not file.filename.endswith(ALLOWED_DATA_EXTENSIONS):
        raise HTTPException(status_code=400, detail="Only .xlsx, .xls, or .csv files are accepted")

    content = await file.read()
    service = ExcelImportService(db)
    batch_id = str(uuid.uuid4())[:8]

    try:
        summary = service.import_meetings(content, batch_id, current_user.id, filename=file.filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    db.add(FileUpload(
        file_type="meetings",
        filename=file.filename,
        row_count=summary.total_rows,
        added_count=summary.added,
        updated_count=summary.updated,
        removed_count=summary.removed,
        uploaded_by_id=current_user.id,
        batch_id=batch_id,
    ))
    db.commit()

    return summary


@router.post("/jobtitle-domain", response_model=UploadDiffSummary)
async def upload_jobtitle_domain(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN, RoleEnum.BA_MANAGER)),
):
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Only .xlsx or .xls files are accepted for JobTitle Domain")

    content = await file.read()
    service = ExcelImportService(db)
    batch_id = str(uuid.uuid4())[:8]

    try:
        summary = service.import_jobtitle_domain(content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    db.add(FileUpload(
        file_type="jobtitle_domain",
        filename=file.filename,
        row_count=summary.total_rows,
        added_count=summary.added,
        updated_count=summary.updated,
        removed_count=summary.removed,
        uploaded_by_id=current_user.id,
        batch_id=batch_id,
    ))
    db.commit()

    return summary


@router.post("/classification", response_model=UploadDiffSummary)
async def upload_classification(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN, RoleEnum.BA_MANAGER)),
):
    if not file.filename.endswith(ALLOWED_DATA_EXTENSIONS):
        raise HTTPException(status_code=400, detail="Only .xlsx, .xls, or .csv files are accepted")

    content = await file.read()
    service = ExcelImportService(db)
    batch_id = str(uuid.uuid4())[:8]

    try:
        summary = service.import_classification(content, filename=file.filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    db.add(FileUpload(
        file_type="classification",
        filename=file.filename,
        row_count=summary.total_rows,
        added_count=summary.added,
        updated_count=summary.updated,
        removed_count=summary.removed,
        uploaded_by_id=current_user.id,
        batch_id=batch_id,
    ))
    db.commit()

    return summary


@router.get("/history")
def upload_history(
    file_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN, RoleEnum.BA_MANAGER)),
):
    query = db.query(FileUpload)
    if file_type:
        query = query.filter(FileUpload.file_type == file_type)

    uploads = query.order_by(FileUpload.uploaded_at.desc()).limit(50).all()
    return [FileUploadOut.model_validate(u) for u in uploads]
