import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_user, require_role
from app.models.models import Employee, RoleEnum, FileUpload
from app.services.excel_import import ExcelImportService
from app.schemas.schemas import FileUploadOut, UploadDiffSummary, ConsultantUploadSummary

router = APIRouter()

ALLOWED_DATA_EXTENSIONS = (".xlsx", ".xls", ".csv")

# Directory to store uploaded consultant files for later batch-apply
UPLOAD_STORAGE_DIR = Path(__file__).resolve().parent.parent.parent / "uploads" / "consultants"
UPLOAD_STORAGE_DIR.mkdir(parents=True, exist_ok=True)


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


@router.post("/consultants", response_model=ConsultantUploadSummary)
async def upload_consultants(
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
        summary = service.import_consultants(content, batch_id, current_user.id, filename=file.filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Save file to disk so it can be re-processed via batch-apply
    ext = Path(file.filename).suffix
    stored_filename = f"{batch_id}_{file.filename}"
    stored_path = UPLOAD_STORAGE_DIR / stored_filename
    with open(stored_path, "wb") as f:
        f.write(content)

    db.add(FileUpload(
        file_type="consultants",
        filename=file.filename,
        row_count=summary.total_rows,
        added_count=summary.added,
        updated_count=0,
        removed_count=summary.skipped_duplicate,
        uploaded_by_id=current_user.id,
        batch_id=batch_id,
        stored_path=str(stored_path),
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


@router.delete("/history/{upload_id}", status_code=204)
def delete_upload_record(
    upload_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN)),
):
    record = db.query(FileUpload).filter(FileUpload.id == upload_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Upload record not found")
    db.delete(record)
    db.commit()
