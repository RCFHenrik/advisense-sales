from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, EmailStr

from app.models.models import (
    RoleEnum, OutreachStatusEnum, NegationReasonEnum,
    ContactStatusEnum, LanguageEnum,
)


# ── Auth ──────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    employee: "EmployeeOut"


# ── Employee ──────────────────────────────────────────────────────────

class EmployeeBase(BaseModel):
    name: str
    email: str
    role: RoleEnum = RoleEnum.CONSULTANT
    seniority: Optional[str] = None
    primary_language: LanguageEnum = LanguageEnum.ENGLISH
    domain_expertise_tags: Optional[str] = None
    outreach_target_per_week: int = 3
    outreach_target_per_month: Optional[int] = None
    is_active: bool = True
    profile_description: Optional[str] = None


class EmployeeCreate(EmployeeBase):
    password: Optional[str] = None
    team_id: Optional[int] = None
    business_area_id: Optional[int] = None
    site_id: Optional[int] = None


class EmployeeUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[RoleEnum] = None
    team_id: Optional[int] = None
    business_area_id: Optional[int] = None
    site_id: Optional[int] = None
    seniority: Optional[str] = None
    primary_language: Optional[LanguageEnum] = None
    domain_expertise_tags: Optional[str] = None
    outreach_target_per_week: Optional[int] = None
    is_active: Optional[bool] = None
    profile_description: Optional[str] = None


class EmployeeSelfUpdate(BaseModel):
    """Fields any employee may update on their own profile."""
    profile_description: Optional[str] = None
    domain_expertise_tags: Optional[str] = None


class EmployeeTargetUpdate(BaseModel):
    """Used by managers to set an individual outreach target for an employee."""
    outreach_target_per_week: Optional[int] = None
    outreach_target_per_month: Optional[int] = None


class EmployeeOut(EmployeeBase):
    id: int
    team_id: Optional[int] = None
    business_area_id: Optional[int] = None
    site_id: Optional[int] = None
    team_name: Optional[str] = None
    business_area_name: Optional[str] = None
    site_name: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ── Business Area / Team / Site ───────────────────────────────────────

class BusinessAreaOut(BaseModel):
    id: int
    name: str

    class Config:
        from_attributes = True


class BusinessAreaCreate(BaseModel):
    name: str


class TeamOut(BaseModel):
    id: int
    name: str
    business_area_id: int
    business_area_name: Optional[str] = None
    outreach_target_per_week: int

    class Config:
        from_attributes = True


class TeamCreate(BaseModel):
    name: str
    business_area_id: int
    outreach_target_per_week: int = 5


class SiteOut(BaseModel):
    id: int
    name: str
    country_code: str

    class Config:
        from_attributes = True


class SiteCreate(BaseModel):
    name: str
    country_code: str


# ── Contact ───────────────────────────────────────────────────────────

class ContactOut(BaseModel):
    id: int
    record_id: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    full_name: Optional[str] = None
    email: Optional[str] = None
    job_title: Optional[str] = None
    company_name: Optional[str] = None
    sector: Optional[str] = None
    client_tier: Optional[str] = None
    responsibility_domain: Optional[str] = None
    group_domicile: Optional[str] = None
    owner_name: Optional[str] = None
    owner_business_area: Optional[str] = None
    owner_team: Optional[str] = None
    last_activity_date: Optional[datetime] = None
    has_historical_revenue: bool = False
    revenue: Optional[float] = None
    days_since_interaction: Optional[int] = None
    relevant_search: Optional[bool] = None
    status: ContactStatusEnum
    priority_score: Optional[float] = None
    is_pinned: bool = False
    created_at: datetime

    class Config:
        from_attributes = True


class ContactListResponse(BaseModel):
    contacts: List[ContactOut]
    total: int
    page: int
    page_size: int


# ── Outreach Record ──────────────────────────────────────────────────

class OutreachRecordOut(BaseModel):
    id: int
    contact_id: int
    employee_id: int
    status: OutreachStatusEnum
    email_subject: Optional[str] = None
    email_body: Optional[str] = None
    email_language: Optional[LanguageEnum] = None
    proposed_slot_1_start: Optional[datetime] = None
    proposed_slot_1_end: Optional[datetime] = None
    proposed_slot_2_start: Optional[datetime] = None
    proposed_slot_2_end: Optional[datetime] = None
    message_id: Optional[str] = None
    sent_at: Optional[datetime] = None
    outcome: Optional[str] = None
    outcome_notes: Optional[str] = None
    cooldown_override: bool = False
    recommendation_score: Optional[float] = None
    recommendation_reason: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    # Joined fields
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_company: Optional[str] = None
    contact_job_title: Optional[str] = None
    employee_name: Optional[str] = None
    team_name: Optional[str] = None
    business_area_name: Optional[str] = None

    class Config:
        from_attributes = True


class OutreachAcceptRequest(BaseModel):
    pass


class OutreachDraftRequest(BaseModel):
    email_subject: Optional[str] = None
    email_body: Optional[str] = None
    email_language: Optional[LanguageEnum] = None
    proposed_slot_1_start: Optional[datetime] = None
    proposed_slot_1_end: Optional[datetime] = None
    proposed_slot_2_start: Optional[datetime] = None
    proposed_slot_2_end: Optional[datetime] = None


class OutreachSendRequest(BaseModel):
    email_subject: str
    email_body: str
    email_language: LanguageEnum


class OutreachOutcomeRequest(BaseModel):
    outcome: str
    outcome_notes: Optional[str] = None


class OutreachOverrideRequest(BaseModel):
    reason: str


# ── Negation ──────────────────────────────────────────────────────────

class NegationCreate(BaseModel):
    reason: NegationReasonEnum
    notes: Optional[str] = None


class NegationOut(BaseModel):
    id: int
    outreach_record_id: int
    employee_id: int
    reason: NegationReasonEnum
    notes: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ── Email Template ────────────────────────────────────────────────────

class EmailTemplateOut(BaseModel):
    id: int
    name: str
    business_area_id: Optional[int] = None
    responsibility_domain: Optional[str] = None
    language: LanguageEnum
    subject_template: str
    body_template: str
    version: str
    is_active: bool
    published_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class EmailTemplateCreate(BaseModel):
    name: str
    business_area_id: Optional[int] = None
    responsibility_domain: Optional[str] = None
    language: LanguageEnum
    subject_template: str = ""
    body_template: str = ""


class EmailTemplateUpdate(BaseModel):
    name: Optional[str] = None
    business_area_id: Optional[int] = None
    responsibility_domain: Optional[str] = None
    language: Optional[LanguageEnum] = None
    subject_template: Optional[str] = None
    body_template: Optional[str] = None
    is_active: Optional[bool] = None


# ── Hot Topic ─────────────────────────────────────────────────────────

class HotTopicOut(BaseModel):
    id: int
    business_area_id: int
    responsibility_domain: str
    topic_text: str
    language: LanguageEnum
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class HotTopicCreate(BaseModel):
    business_area_id: int
    responsibility_domain: str
    topic_text: str
    language: LanguageEnum = LanguageEnum.ENGLISH


# ── Column Mapping ────────────────────────────────────────────────────

class ColumnMappingOut(BaseModel):
    id: int
    file_type: str
    logical_field: str
    physical_column: str
    is_required: bool

    class Config:
        from_attributes = True


class ColumnMappingCreate(BaseModel):
    file_type: str
    logical_field: str
    physical_column: str
    is_required: bool = False


class ColumnMappingUpdate(BaseModel):
    physical_column: str


# ── File Upload ───────────────────────────────────────────────────────

class FileUploadOut(BaseModel):
    id: int
    file_type: str
    filename: str
    row_count: Optional[int] = None
    added_count: int
    updated_count: int
    removed_count: int
    uploaded_at: datetime
    batch_id: str

    class Config:
        from_attributes = True


class UploadDiffSummary(BaseModel):
    added: int
    updated: int
    removed: int
    unchanged: int
    total_rows: int
    errors: List[str]


# ── Dashboard ─────────────────────────────────────────────────────────

class DashboardStats(BaseModel):
    total_contacts: int
    active_contacts: int
    total_outreach_this_week: int
    total_outreach_this_month: int
    pending_proposals: int
    sent_this_week: int
    meetings_booked: int
    negation_count: int


class OutreachByStatusCount(BaseModel):
    status: str
    count: int


class OutreachByBACount(BaseModel):
    business_area: str
    count: int


class OutreachBySiteCount(BaseModel):
    site: str
    count: int


# ── System Config ─────────────────────────────────────────────────────

class SystemConfigOut(BaseModel):
    id: int
    key: str
    value: str
    description: Optional[str] = None
    updated_at: datetime

    class Config:
        from_attributes = True


class SystemConfigUpdate(BaseModel):
    value: str


# ── Audit Log ─────────────────────────────────────────────────────────

class AuditLogOut(BaseModel):
    id: int
    employee_id: Optional[int] = None
    action: str
    entity_type: str
    entity_id: Optional[int] = None
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    details: Optional[str] = None
    timestamp: datetime

    class Config:
        from_attributes = True


# Resolve forward references
TokenResponse.model_rebuild()
