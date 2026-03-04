import bcrypt as _bcrypt

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import create_access_token, get_current_user
from app.models.models import Employee
from app.schemas.schemas import LoginRequest, TokenResponse, EmployeeOut

router = APIRouter()


def _hash_password(password: str) -> str:
    return _bcrypt.hashpw(password.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")


def _verify_password(plain: str, hashed: str) -> bool:
    return _bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def _employee_to_out(emp: Employee) -> EmployeeOut:
    return EmployeeOut(
        id=emp.id,
        name=emp.name,
        email=emp.email,
        role=emp.role,
        seniority=emp.seniority,
        primary_language=emp.primary_language,
        domain_expertise_tags=emp.domain_expertise_tags,
        outreach_target_per_week=emp.outreach_target_per_week,
        is_active=emp.is_active,
        team_id=emp.team_id,
        business_area_id=emp.business_area_id,
        site_id=emp.site_id,
        team_name=emp.team.name if emp.team else None,
        business_area_name=emp.business_area.name if emp.business_area else None,
        site_name=emp.site.name if emp.site else None,
        created_at=emp.created_at,
    )


@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    employee = db.query(Employee).filter(Employee.email == req.email).first()
    if not employee:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    # For prototype: accept "password" as default, or check hash if set
    if employee.password_hash:
        if not _verify_password(req.password, employee.password_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    elif req.password != "password":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    token = create_access_token(data={"sub": str(employee.id)})
    return TokenResponse(access_token=token, employee=_employee_to_out(employee))


@router.get("/me", response_model=EmployeeOut)
def get_me(current_user: Employee = Depends(get_current_user)):
    return _employee_to_out(current_user)
