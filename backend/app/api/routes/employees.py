from typing import Optional, List
import bcrypt as _bcrypt

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_user, require_role
from app.models.models import Employee, RoleEnum, ApprovalStatusEnum, EmployeeSiteLanguage, SiteLanguage, AuditLog
from app.schemas.schemas import (
    EmployeeOut, EmployeeCreate, EmployeeUpdate, EmployeeSelfUpdate,
    EmployeeTargetUpdate, EmployeeApprovalRequest, EmployeeSiteLanguageOut,
    EmployeeRoleUpdate,
)

router = APIRouter()


def _hash_password(password: str) -> str:
    return _bcrypt.hashpw(password.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")


def _to_out(emp: Employee) -> EmployeeOut:
    sl_list = []
    for esl in (emp.site_languages or []):
        if esl.site_language and esl.site_language.is_active:
            sl_list.append(EmployeeSiteLanguageOut(
                id=esl.id,
                site_language_id=esl.site_language_id,
                name=esl.site_language.name,
                code=esl.site_language.code,
            ))
    return EmployeeOut(
        id=emp.id,
        name=emp.name,
        email=emp.email,
        role=emp.role,
        seniority=emp.seniority,
        primary_language=emp.primary_language,
        domain_expertise_tags=emp.domain_expertise_tags,
        outreach_target_per_week=emp.outreach_target_per_week,
        outreach_target_per_month=emp.outreach_target_per_month,
        is_active=emp.is_active,
        approval_status=emp.approval_status,
        profile_description=emp.profile_description,
        team_id=emp.team_id,
        business_area_id=emp.business_area_id,
        site_id=emp.site_id,
        team_name=emp.team.name if emp.team else None,
        business_area_name=emp.business_area.name if emp.business_area else None,
        site_name=emp.site.name if emp.site else None,
        uploaded_batch_id=emp.uploaded_batch_id,
        site_languages=sl_list,
        created_at=emp.created_at,
    )


@router.get("/", response_model=List[EmployeeOut])
def list_employees(
    business_area_id: Optional[int] = None,
    team_id: Optional[int] = None,
    role: Optional[RoleEnum] = None,
    is_active: bool = True,
    approval_status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    query = db.query(Employee)

    # Approval status filter — pending/rejected employees have is_active=False,
    # so we skip the is_active filter when explicitly viewing those.
    if approval_status == "pending":
        query = query.filter(Employee.approval_status == ApprovalStatusEnum.PENDING)
    elif approval_status == "rejected":
        query = query.filter(Employee.approval_status == ApprovalStatusEnum.REJECTED)
    else:
        # Default: show approved, active employees
        query = query.filter(Employee.is_active == is_active)
        query = query.filter(Employee.approval_status == ApprovalStatusEnum.APPROVED)

    # Role-based hierarchy filter (strictly downward — managers never see peers/superiors)
    if current_user.role == RoleEnum.CONSULTANT:
        query = query.filter(Employee.id == current_user.id)
    elif current_user.role == RoleEnum.TEAM_MANAGER:
        if current_user.team_id:
            # Sees consultants in their team + themselves
            query = query.filter(
                ((Employee.team_id == current_user.team_id) & (Employee.role == RoleEnum.CONSULTANT))
                | (Employee.id == current_user.id)
            )
        else:
            query = query.filter(Employee.id == current_user.id)
    elif current_user.role == RoleEnum.BA_MANAGER:
        if current_user.business_area_id:
            # Sees consultants + team managers in their BA + themselves
            query = query.filter(
                (
                    (Employee.business_area_id == current_user.business_area_id)
                    & (Employee.role.in_([RoleEnum.CONSULTANT, RoleEnum.TEAM_MANAGER]))
                )
                | (Employee.id == current_user.id)
            )
        else:
            query = query.filter(Employee.id == current_user.id)
    # RoleEnum.ADMIN: no additional filter

    if business_area_id:
        query = query.filter(Employee.business_area_id == business_area_id)
    if team_id:
        query = query.filter(Employee.team_id == team_id)
    if role:
        query = query.filter(Employee.role == role)
    return [_to_out(e) for e in query.order_by(Employee.name).all()]


@router.patch("/me", response_model=EmployeeOut)
def update_my_profile(
    data: EmployeeSelfUpdate,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    """Allow any authenticated employee to update their own profile description and expertise tags."""
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(current_user, key, value)
    db.commit()
    db.refresh(current_user)
    return _to_out(current_user)


@router.get("/{employee_id}", response_model=EmployeeOut)
def get_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    emp = db.query(Employee).filter(Employee.id == employee_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    return _to_out(emp)


@router.post("/", response_model=EmployeeOut)
def create_employee(
    data: EmployeeCreate,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(
        require_role(RoleEnum.ADMIN, RoleEnum.BA_MANAGER, RoleEnum.TEAM_MANAGER)
    ),
):
    # Scope enforcement for non-admins
    if current_user.role == RoleEnum.TEAM_MANAGER:
        if data.team_id and data.team_id != current_user.team_id:
            raise HTTPException(status_code=403, detail="Can only add consultants to your own team")
        if not data.team_id:
            data.team_id = current_user.team_id
        if not data.business_area_id:
            data.business_area_id = current_user.business_area_id
    elif current_user.role == RoleEnum.BA_MANAGER:
        if data.business_area_id and data.business_area_id != current_user.business_area_id:
            raise HTTPException(status_code=403, detail="Can only add consultants to your own business area")
        if not data.business_area_id:
            data.business_area_id = current_user.business_area_id

    existing = db.query(Employee).filter(Employee.email == data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already exists")

    emp = Employee(
        name=data.name,
        email=data.email,
        role=data.role,
        team_id=data.team_id,
        business_area_id=data.business_area_id,
        site_id=data.site_id,
        seniority=data.seniority,
        primary_language=data.primary_language,
        domain_expertise_tags=data.domain_expertise_tags,
        outreach_target_per_week=data.outreach_target_per_week,
        password_hash=_hash_password(data.password) if data.password else None,
        approval_status=ApprovalStatusEnum.APPROVED,  # manual creation = auto-approved
    )
    db.add(emp)
    db.commit()
    db.refresh(emp)
    return _to_out(emp)


@router.patch("/{employee_id}/approve", response_model=EmployeeOut)
def approve_employee(
    employee_id: int,
    data: EmployeeApprovalRequest,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(
        require_role(RoleEnum.ADMIN, RoleEnum.BA_MANAGER, RoleEnum.TEAM_MANAGER)
    ),
):
    """Approve or reject a pending consultant."""
    emp = db.query(Employee).filter(Employee.id == employee_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    # Scope enforcement
    if current_user.role == RoleEnum.TEAM_MANAGER:
        if emp.team_id != current_user.team_id:
            raise HTTPException(status_code=403, detail="Can only approve consultants in your team")
    elif current_user.role == RoleEnum.BA_MANAGER:
        if emp.business_area_id != current_user.business_area_id:
            raise HTTPException(status_code=403, detail="Can only approve consultants in your business area")

    emp.approval_status = data.approval_status
    if data.approval_status == ApprovalStatusEnum.APPROVED:
        emp.is_active = True
    elif data.approval_status == ApprovalStatusEnum.REJECTED:
        emp.is_active = False

    db.commit()
    db.refresh(emp)
    return _to_out(emp)


@router.patch("/{employee_id}/role", response_model=EmployeeOut)
def change_employee_role(
    employee_id: int,
    data: EmployeeRoleUpdate,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN)),
):
    """Change an employee's role. Admin only. Prevents removing the last admin."""
    emp = db.query(Employee).filter(Employee.id == employee_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    # No-op if already the same role
    if emp.role == data.role:
        return _to_out(emp)

    # Last-admin guard: prevent removing the last administrator
    if emp.role == RoleEnum.ADMIN and data.role != RoleEnum.ADMIN:
        other_admins = db.query(Employee).filter(
            Employee.role == RoleEnum.ADMIN,
            Employee.id != emp.id,
            Employee.is_active == True,
        ).count()
        if other_admins == 0:
            raise HTTPException(
                status_code=400,
                detail="Cannot remove the last administrator",
            )

    old_role = emp.role
    emp.role = data.role

    db.add(AuditLog(
        employee_id=current_user.id,
        action="role_change",
        entity_type="employee",
        entity_id=emp.id,
        old_value=old_role.value if hasattr(old_role, 'value') else str(old_role),
        new_value=data.role.value,
        details=f"Role changed from {old_role.value if hasattr(old_role, 'value') else old_role} to {data.role.value} by {current_user.name}",
    ))

    db.commit()
    db.refresh(emp)
    return _to_out(emp)


@router.patch("/{employee_id}/target", response_model=EmployeeOut)
def set_employee_target(
    employee_id: int,
    data: EmployeeTargetUpdate,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    """Set the weekly outreach target for an employee within the caller's management scope."""
    if current_user.role == RoleEnum.CONSULTANT:
        raise HTTPException(status_code=403, detail="Not authorized")

    emp = db.query(Employee).filter(Employee.id == employee_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    if current_user.role == RoleEnum.TEAM_MANAGER:
        # Team managers can only set targets for consultants in their own team
        if emp.team_id != current_user.team_id or emp.role != RoleEnum.CONSULTANT:
            raise HTTPException(
                status_code=403,
                detail="Team managers can only set targets for consultants in their own team",
            )
    elif current_user.role == RoleEnum.BA_MANAGER:
        # BA managers can set targets for team managers and consultants in their BA
        if emp.business_area_id != current_user.business_area_id:
            raise HTTPException(
                status_code=403,
                detail="Cannot set target for an employee outside your business area",
            )
        if emp.role not in (RoleEnum.CONSULTANT, RoleEnum.TEAM_MANAGER):
            raise HTTPException(
                status_code=403,
                detail="BA managers can only set targets for team managers and consultants",
            )
    # ADMIN: no scope restrictions

    # Use model_fields_set to distinguish "not sent" (skip) from "sent as null" (apply)
    if data.outreach_target_per_week is not None:
        emp.outreach_target_per_week = data.outreach_target_per_week
    if "outreach_target_per_month" in data.model_fields_set:
        emp.outreach_target_per_month = data.outreach_target_per_month  # may be None (clears it)
    db.commit()
    db.refresh(emp)
    return _to_out(emp)


# ── Employee Site Languages ─────────────────────────────────────────

@router.get("/me/site-languages", response_model=List[EmployeeSiteLanguageOut])
def get_my_site_languages(
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    """Get the current user's site languages."""
    return [
        EmployeeSiteLanguageOut(
            id=esl.id,
            site_language_id=esl.site_language_id,
            name=esl.site_language.name,
            code=esl.site_language.code,
        )
        for esl in current_user.site_languages
        if esl.site_language and esl.site_language.is_active
    ]


@router.post("/me/site-languages/{site_language_id}", response_model=EmployeeSiteLanguageOut)
def add_my_site_language(
    site_language_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    """Add a site language to the current user's profile."""
    sl = db.query(SiteLanguage).filter(SiteLanguage.id == site_language_id, SiteLanguage.is_active == True).first()
    if not sl:
        raise HTTPException(status_code=404, detail="Language not found")

    existing = db.query(EmployeeSiteLanguage).filter(
        EmployeeSiteLanguage.employee_id == current_user.id,
        EmployeeSiteLanguage.site_language_id == site_language_id,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Language already added")

    esl = EmployeeSiteLanguage(employee_id=current_user.id, site_language_id=site_language_id)
    db.add(esl)
    db.commit()
    db.refresh(esl)
    return EmployeeSiteLanguageOut(
        id=esl.id,
        site_language_id=esl.site_language_id,
        name=sl.name,
        code=sl.code,
    )


@router.delete("/me/site-languages/{site_language_id}")
def remove_my_site_language(
    site_language_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    """Remove a site language from the current user's profile."""
    esl = db.query(EmployeeSiteLanguage).filter(
        EmployeeSiteLanguage.employee_id == current_user.id,
        EmployeeSiteLanguage.site_language_id == site_language_id,
    ).first()
    if not esl:
        raise HTTPException(status_code=404, detail="Language not found on profile")
    db.delete(esl)
    db.commit()
    return {"status": "removed"}


@router.put("/{employee_id}", response_model=EmployeeOut)
def update_employee(
    employee_id: int,
    data: EmployeeUpdate,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN)),
):
    emp = db.query(Employee).filter(Employee.id == employee_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(emp, key, value)

    db.commit()
    db.refresh(emp)
    return _to_out(emp)
