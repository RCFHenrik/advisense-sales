import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_user, require_role
from app.models.models import Employee, RoleEnum, FileUpload, Notification, Contact, CoverageGap
from app.services.excel_import import ExcelImportService
from app.schemas.schemas import FileUploadOut, UploadDiffSummary, ConsultantUploadSummary

import logging
logger = logging.getLogger(__name__)

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
    except Exception as e:
        logger.error(f"Contacts import failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}")

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
    except Exception as e:
        logger.error(f"Meetings import failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}")

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
    except Exception as e:
        logger.error(f"JobTitle Domain import failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}")

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


@router.post("/expertise-tags", response_model=UploadDiffSummary)
async def upload_expertise_tags(
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
        summary = service.import_expertise_tags(content, file.filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Expertise tags import failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}")

    db.add(FileUpload(
        file_type="expertise_tags",
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
    except Exception as e:
        logger.error(f"Classification import failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}")

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
    except Exception as e:
        logger.error(f"Consultants import failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}")

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




@router.post("/coverage-gaps")
async def upload_coverage_gaps(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN, RoleEnum.BA_MANAGER)),
):
    """Upload coverage gap analysis CSV (pipe-delimited)."""
    if not file.filename or not file.filename.lower().endswith(ALLOWED_DATA_EXTENSIONS):
        raise HTTPException(status_code=400, detail="Only .xlsx, .xls, or .csv files are accepted")

    content = await file.read()
    service = ExcelImportService(db)
    batch_id = str(uuid.uuid4())[:8]

    try:
        summary = service.import_coverage_gaps(content, batch_id, filename=file.filename or "")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Coverage gaps import failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}")

    db.add(FileUpload(
        file_type="coverage_gaps",
        filename=file.filename or "unknown",
        row_count=summary.get("total_rows", 0),
        added_count=summary.get("added", 0),
        updated_count=0,
        removed_count=0,
        uploaded_by_id=current_user.id,
        batch_id=batch_id,
    ))
    db.commit()

    # Generate notifications for team owners of companies with critical gaps
    try:
        critical_gaps = db.query(CoverageGap).filter(CoverageGap.critical_gap_count > 0).all()
        # Find owner employees for these companies
        owner_notifications: dict[int, list] = {}  # employee_id -> [company_names]
        for gap in critical_gaps:
            # Find contacts at this company to determine the owner
            contacts = db.query(Contact).filter(
                Contact.company_name.ilike(gap.company_name),
                Contact.status == "active",
            ).limit(1).all()
            for c in contacts:
                if c.owner_name:
                    # Find the employee by name
                    emp = db.query(Employee).filter(
                        Employee.name.ilike(c.owner_name)
                    ).first()
                    if emp:
                        if emp.id not in owner_notifications:
                            owner_notifications[emp.id] = []
                        owner_notifications[emp.id].append(gap.company_name)

        for emp_id, companies in owner_notifications.items():
            top3 = companies[:3]
            more = f" and {len(companies) - 3} more" if len(companies) > 3 else ""
            db.add(Notification(
                employee_id=emp_id,
                notification_type="coverage_gap",
                title=f"Coverage gaps detected in {len(companies)} of your companies",
                message=f"Critical gaps found at: {', '.join(top3)}{more}. Consider filling missing roles.",
                link="/contacts?sort=coverage_gap_critical&order=desc",
            ))
        if owner_notifications:
            db.commit()
            logger.info(f"Created gap notifications for {len(owner_notifications)} employees")
    except Exception as e:
        logger.warning(f"Failed to create gap notifications: {e}")

    return summary

@router.get("/history")
def upload_history(
    file_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN, RoleEnum.BA_MANAGER)),
):
    from sqlalchemy.orm import aliased
    Uploader = aliased(Employee)
    rows = (
        db.query(FileUpload, Uploader.name.label("uploader_name"))
        .outerjoin(Uploader, FileUpload.uploaded_by_id == Uploader.id)
    )
    if file_type:
        rows = rows.filter(FileUpload.file_type == file_type)

    rows = rows.order_by(FileUpload.uploaded_at.desc()).limit(50).all()
    result = []
    for upload, uploader_name in rows:
        out = FileUploadOut.model_validate(upload)
        out.uploaded_by_name = uploader_name
        result.append(out)
    return result


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
