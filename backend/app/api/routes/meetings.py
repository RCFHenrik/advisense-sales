from typing import Optional, List

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_user
from app.models.models import Meeting, Employee

router = APIRouter()


@router.get("/")
def list_meetings(
    contact_id: Optional[int] = None,
    employee_name: Optional[str] = None,
    company: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    query = db.query(Meeting)

    if contact_id:
        query = query.filter(Meeting.contact_id == contact_id)
    if employee_name:
        like = f"%{employee_name}%"
        query = query.filter(
            (Meeting.employee_name_corrected.ilike(like)) | (Meeting.employee_name.ilike(like))
        )
    if company:
        like = f"%{company}%"
        query = query.filter(
            (Meeting.company_corrected.ilike(like)) | (Meeting.associated_company.ilike(like))
        )

    total = query.count()
    meetings = (
        query.order_by(Meeting.activity_date.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return {
        "meetings": [
            {
                "id": m.id,
                "record_id": m.record_id,
                "contact_id": m.contact_id,
                "employee_name": m.employee_name_corrected or m.employee_name,
                "activity_date": m.activity_date,
                "details": m.details,
                "outcome": m.outcome,
                "associated_company": m.company_corrected or m.associated_company,
                "client_tier": m.client_tier,
                "group_domicile": m.group_domicile,
                "seniority": m.seniority,
            }
            for m in meetings
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }
