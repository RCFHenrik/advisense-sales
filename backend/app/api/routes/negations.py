from typing import Optional, List

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_user
from app.models.models import Negation, Employee, RoleEnum
from app.schemas.schemas import NegationOut

router = APIRouter()


@router.get("/", response_model=List[NegationOut])
def list_negations(
    employee_id: Optional[int] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    query = db.query(Negation)

    if employee_id:
        query = query.filter(Negation.employee_id == employee_id)
    elif current_user.role == RoleEnum.CONSULTANT:
        query = query.filter(Negation.employee_id == current_user.id)

    negations = (
        query.order_by(Negation.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return [NegationOut.model_validate(n) for n in negations]
