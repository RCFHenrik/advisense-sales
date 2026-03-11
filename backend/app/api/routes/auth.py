import bcrypt as _bcrypt

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import create_access_token, get_current_user
from app.core.rate_limit import login_limiter
from app.models.models import Employee
from app.schemas.schemas import LoginRequest, TokenResponse, EmployeeOut, ChangePasswordRequest

router = APIRouter()


def _hash_password(password: str) -> str:
    return _bcrypt.hashpw(password.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")


def _verify_password(plain: str, hashed: str) -> bool:
    return _bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


# Use shared helper from employees module
from app.api.routes.employees import _to_out as _employee_to_out


@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest, request: Request, db: Session = Depends(get_db)):
    # Rate limiting by IP address
    client_ip = request.client.host if request.client else "unknown"
    if login_limiter.is_blocked(client_ip):
        remaining = login_limiter.remaining_seconds(client_ip)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many login attempts. Try again in {remaining} seconds.",
        )

    employee = db.query(Employee).filter(Employee.email == req.email).first()
    if not employee:
        login_limiter.record_failure(client_ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    # For prototype: accept "password" as default, or check hash if set
    if employee.password_hash:
        if not _verify_password(req.password, employee.password_hash):
            login_limiter.record_failure(client_ip)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    elif req.password != "password":
        login_limiter.record_failure(client_ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    # Successful login — clear rate limit counter
    login_limiter.reset(client_ip)
    token = create_access_token(data={"sub": str(employee.id)})
    return TokenResponse(access_token=token, employee=_employee_to_out(employee))


@router.get("/me", response_model=EmployeeOut)
def get_me(current_user: Employee = Depends(get_current_user)):
    return _employee_to_out(current_user)


@router.post("/change-password")
def change_password(
    req: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    """Change the current user's password."""
    if req.new_password != req.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")
    if len(req.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    # Verify current password
    if current_user.password_hash:
        if not _verify_password(req.current_password, current_user.password_hash):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
    elif req.current_password != "password":
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    current_user.password_hash = _hash_password(req.new_password)
    current_user.must_change_password = False
    db.commit()
    return {"message": "Password changed successfully"}
