from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, EmailStr

from app.models.models import (
    RoleEnum, OutreachStatusEnum, NegationReasonEnum,
    ContactStatusEnum, LanguageEnum, ApprovalStatusEnum,
    CampaignStatusEnum, CampaignRecipientStatusEnum,
)


# ── Auth ──────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    confirm_password: str


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
    relevance_tags: Optional[str] = None
    outreach_target_per_week: int = 3
    outreach_target_per_month: Optional[int] = None
    is_active: bool = True
    approval_status: ApprovalStatusEnum = ApprovalStatusEnum.APPROVED
    profile_description: Optional[str] = None
    can_campaign: bool = False


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
    relevance_tags: Optional[str] = None
    outreach_target_per_week: Optional[int] = None
    is_active: Optional[bool] = None
    profile_description: Optional[str] = None


class EmployeeSelfUpdate(BaseModel):
    """Fields any employee may update on their own profile."""
    name: Optional[str] = None
    email: Optional[str] = None
    profile_description: Optional[str] = None
    domain_expertise_tags: Optional[str] = None
    relevance_tags: Optional[str] = None
    seniority: Optional[str] = None


class EmployeeTargetUpdate(BaseModel):
    """Used by managers to set an individual outreach target for an employee."""
    outreach_target_per_week: Optional[int] = None
    outreach_target_per_month: Optional[int] = None


class EmployeeApprovalRequest(BaseModel):
    approval_status: ApprovalStatusEnum


class EmployeeRoleUpdate(BaseModel):
    role: RoleEnum


class ConsultantUploadSummary(BaseModel):
    added: int
    updated: int = 0
    skipped_duplicate: int = 0
    warnings: List[str]
    total_rows: int


class BulkDeactivateRequest(BaseModel):
    employee_ids: List[int]


class BulkUpdateRequest(BaseModel):
    employee_ids: List[int]
    name: Optional[str] = None
    email: Optional[str] = None
    seniority: Optional[str] = None
    business_area: Optional[str] = None
    team: Optional[str] = None
    site: Optional[str] = None
    primary_language: Optional[str] = None
    profile_description: Optional[str] = None
    domain_expertise_tags: Optional[str] = None
    relevance_tags: Optional[str] = None


class BulkOperationResult(BaseModel):
    success_count: int
    skipped_count: int
    skipped_details: List[str]


# ── System Reset ─────────────────────────────────────────────────────

class ResetExecuteRequest(BaseModel):
    confirmation_text: str       # Must be exactly "RESET"
    backup_downloaded: bool      # Client asserts backup was downloaded


class ResetRestoreResponse(BaseModel):
    suppression_restored: int
    contacts_flagged: int
    warnings: List[str]


class EmployeeOut(EmployeeBase):
    id: int
    team_id: Optional[int] = None
    business_area_id: Optional[int] = None
    site_id: Optional[int] = None
    team_name: Optional[str] = None
    business_area_name: Optional[str] = None
    site_name: Optional[str] = None
    site_country_code: Optional[str] = None
    uploaded_batch_id: Optional[str] = None
    site_languages: List["EmployeeSiteLanguageOut"] = []
    must_change_password: bool = False
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


# ── Site Language ─────────────────────────────────────────────────────

class SiteLanguageOut(BaseModel):
    id: int
    name: str
    code: Optional[str] = None
    is_active: bool

    class Config:
        from_attributes = True


class SiteLanguageCreate(BaseModel):
    name: str
    code: Optional[str] = None


class SiteLanguageUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None


class EmployeeSiteLanguageOut(BaseModel):
    id: int
    site_language_id: int
    name: str
    code: Optional[str] = None


# ── Contact ───────────────────────────────────────────────────────────

class ContactOut(BaseModel):
    id: int
    record_id: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    full_name: Optional[str] = None
    email: Optional[str] = None
    job_title: Optional[str] = None
    original_job_title: Optional[str] = None
    company_name: Optional[str] = None
    client_name: Optional[str] = None
    sector: Optional[str] = None
    client_tier: Optional[str] = None
    responsibility_domain: Optional[str] = None
    group_domicile: Optional[str] = None
    owner_name: Optional[str] = None
    owner_business_area: Optional[str] = None
    owner_team: Optional[str] = None
    owner_seniority: Optional[str] = None
    owner_org_site: Optional[str] = None
    owner_email: Optional[str] = None
    last_activity_date: Optional[datetime] = None
    has_historical_revenue: bool = False
    revenue: Optional[float] = None
    days_since_interaction: Optional[int] = None
    relevant_search: Optional[bool] = None
    status: ContactStatusEnum
    priority_score: Optional[float] = None
    is_pinned: bool = False
    bounced_at: Optional[datetime] = None
    expert_areas: Optional[str] = None
    relevance_tags: Optional[str] = None
    is_decision_maker: bool = False
    opt_out_one_on_one: bool = False
    opt_out_marketing_info: bool = False
    contact_flags: List[str] = []
    coverage_gap_critical: int = 0
    coverage_gap_potential: int = 0
    created_at: datetime

    class Config:
        from_attributes = True


class ContactUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    job_title: Optional[str] = None
    expert_areas: Optional[str] = None
    relevance_tags: Optional[str] = None
    is_decision_maker: Optional[bool] = None
    opt_out_one_on_one: Optional[bool] = None
    opt_out_marketing_info: Optional[bool] = None


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
    replied_at: Optional[datetime] = None
    outcome: Optional[str] = None
    outcome_notes: Optional[str] = None
    cooldown_override: bool = False
    recommendation_score: Optional[float] = None
    recommendation_reason: Optional[str] = None
    selected_attachment_ids: Optional[str] = None
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

    # Redirect provenance
    redirected_from_id: Optional[int] = None
    redirected_by_id: Optional[int] = None
    redirected_by_name: Optional[str] = None
    redirected_at: Optional[datetime] = None
    redirect_notes: Optional[str] = None

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
    selected_attachment_ids: Optional[str] = None


class OutreachSendRequest(BaseModel):
    email_subject: str
    email_body: str
    email_language: LanguageEnum
    selected_attachment_ids: Optional[str] = None


class OutreachOutcomeRequest(BaseModel):
    outcome: str
    outcome_notes: Optional[str] = None


class OutreachOverrideRequest(BaseModel):
    reason: str


# ── Negation ──────────────────────────────────────────────────────────

class NegationCreate(BaseModel):
    reason: NegationReasonEnum
    notes: Optional[str] = None
    redirect_to_employee_id: Optional[int] = None


class NegationOut(BaseModel):
    id: int
    outreach_record_id: int
    employee_id: int
    reason: NegationReasonEnum
    notes: Optional[str] = None
    created_at: datetime
    redirected_outreach_id: Optional[int] = None

    class Config:
        from_attributes = True


# ── Email Template ────────────────────────────────────────────────────

class TemplateAttachmentOut(BaseModel):
    id: int
    template_id: int
    original_filename: str
    display_name: str
    content_type: str
    file_size_bytes: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class TemplateAttachmentRename(BaseModel):
    display_name: str


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
    is_personal: bool = False
    published_at: Optional[datetime] = None
    created_by_id: Optional[int] = None
    created_at: datetime
    attachments: List["TemplateAttachmentOut"] = []

    class Config:
        from_attributes = True


class EmailTemplateCreate(BaseModel):
    name: str
    business_area_id: Optional[int] = None
    responsibility_domain: Optional[str] = None
    language: LanguageEnum
    subject_template: str = ""
    body_template: str = ""
    is_personal: bool = False


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
    published_at: Optional[datetime] = None
    created_by_id: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class HotTopicCreate(BaseModel):
    business_area_id: int
    responsibility_domain: str
    topic_text: str
    language: LanguageEnum = LanguageEnum.ENGLISH


class HotTopicUpdate(BaseModel):
    business_area_id: Optional[int] = None
    responsibility_domain: Optional[str] = None
    topic_text: Optional[str] = None
    language: Optional[LanguageEnum] = None
    is_active: Optional[bool] = None


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
    uploaded_by_name: Optional[str] = None

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
    updated_at: Optional[datetime] = None

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


# ── Campaign Outreach ────────────────────────────────────────────────

class CampaignCreate(BaseModel):
    name: str
    description: Optional[str] = None
    email_subject: str = ""
    email_body: str = ""
    email_language: LanguageEnum = LanguageEnum.ENGLISH
    template_id: Optional[int] = None
    bcc_mode: bool = True


class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    email_subject: Optional[str] = None
    email_body: Optional[str] = None
    email_language: Optional[LanguageEnum] = None
    template_id: Optional[int] = None
    bcc_mode: Optional[bool] = None


class CampaignRecipientOut(BaseModel):
    id: int
    campaign_id: int
    contact_id: int
    status: str
    sent_at: Optional[datetime] = None
    error_message: Optional[str] = None
    created_at: Optional[datetime] = None
    # Joined fields from Contact
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_company: Optional[str] = None
    contact_job_title: Optional[str] = None
    contact_domain: Optional[str] = None
    contact_domicile: Optional[str] = None
    contact_tier: Optional[str] = None
    contact_expert_areas: Optional[str] = None
    contact_relevance_tags: Optional[str] = None
    contact_is_decision_maker: bool = False
    contact_relevant_search: Optional[bool] = None
    # How the contact was added to the campaign
    added_via: Optional[str] = None
    # Consultant assignment fields
    assigned_consultant_id: Optional[int] = None
    assigned_consultant_name: Optional[str] = None
    consultant_status: Optional[str] = None
    custom_email_subject: Optional[str] = None
    custom_email_body: Optional[str] = None
    consultant_accepted_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CampaignAttachmentOut(BaseModel):
    id: int
    campaign_id: int
    original_filename: str
    display_name: str
    content_type: str
    file_size_bytes: int
    is_active: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CampaignOut(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    email_subject: str
    email_body: str
    email_language: LanguageEnum
    template_id: Optional[int] = None
    bcc_mode: bool
    status: str
    created_by_id: int
    created_by_name: Optional[str] = None
    recipient_count: int = 0
    sent_count: int = 0
    attachment_count: int = 0
    scheduled_at: Optional[datetime] = None
    sent_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CampaignDetailOut(CampaignOut):
    recipients: List[CampaignRecipientOut] = []
    attachments: List[CampaignAttachmentOut] = []


class FilterGroupSchema(BaseModel):
    """A single filter group — all fields within a group are combined with AND."""
    filter_client_tier: Optional[str] = None
    filter_sector: Optional[str] = None
    filter_responsibility_domain: Optional[str] = None
    filter_group_domicile: Optional[str] = None
    filter_owner_business_area: Optional[str] = None
    filter_owner_team: Optional[str] = None
    filter_search: Optional[str] = None
    filter_expert_area: Optional[str] = None
    filter_relevance_tag: Optional[str] = None
    filter_is_decision_maker: Optional[bool] = None


class FilterGroupsPreviewRequest(BaseModel):
    """Request with multiple filter groups combined by an operator."""
    groups: List[FilterGroupSchema]
    combine: str = "or"  # "or" or "and"


class FilterGroupsAddRequest(BaseModel):
    """Add recipients using grouped filters and/or individual contact IDs."""
    groups: Optional[List[FilterGroupSchema]] = None
    combine: str = "or"
    contact_ids: Optional[List[int]] = None


class CampaignAddRecipientsRequest(BaseModel):
    contact_ids: Optional[List[int]] = None
    # Filter-based bulk add (flat — single group, backward compatible)
    filter_client_tier: Optional[str] = None
    filter_sector: Optional[str] = None
    filter_responsibility_domain: Optional[str] = None
    filter_group_domicile: Optional[str] = None
    filter_owner_business_area: Optional[str] = None
    filter_owner_team: Optional[str] = None
    filter_search: Optional[str] = None
    filter_expert_area: Optional[str] = None
    filter_relevance_tag: Optional[str] = None
    filter_is_decision_maker: Optional[bool] = None
    # Grouped filters (new)
    groups: Optional[List[FilterGroupSchema]] = None
    combine: Optional[str] = None  # "or" or "and"


class CampaignRemoveRecipientsRequest(BaseModel):
    contact_ids: List[int]


class AssignConsultantRequest(BaseModel):
    consultant_id: int


class CustomizeAssignmentRequest(BaseModel):
    email_subject: Optional[str] = None
    email_body: Optional[str] = None


# ── Notifications ────────────────────────────────────────────────────

class NotificationOut(BaseModel):
    id: int
    employee_id: int
    notification_type: str
    title: str
    message: Optional[str] = None
    link: Optional[str] = None
    reference_type: Optional[str] = None
    reference_id: Optional[int] = None
    is_read: bool = False
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class UnreadCountOut(BaseModel):
    count: int


# ── Campaign Assignments (consultant view) ───────────────────────────

class CampaignAssignmentOut(BaseModel):
    """A single campaign recipient assigned to the current consultant."""
    recipient_id: int
    campaign_id: int
    campaign_name: str
    campaign_description: Optional[str] = None
    contact_id: int
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_company: Optional[str] = None
    contact_job_title: Optional[str] = None
    # Default email from campaign
    default_email_subject: str
    default_email_body: str
    # Custom email (if consultant edited)
    custom_email_subject: Optional[str] = None
    custom_email_body: Optional[str] = None
    consultant_status: Optional[str] = None
    consultant_accepted_at: Optional[datetime] = None
    campaign_status: str
    # Campaign-level context for consultant summary
    campaign_language: Optional[str] = None
    campaign_created_by: Optional[str] = None
    campaign_total_recipients: Optional[int] = None
    campaign_attachment_names: Optional[list] = None
    campaign_created_at: Optional[datetime] = None



class CampaignAnalysisOut(BaseModel):
    id: int
    campaign_id: int
    attachment_id: Optional[int] = None
    extracted_themes: Optional[str] = None
    suggested_tags: Optional[str] = None
    status: str
    error_message: Optional[str] = None
    created_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ExpertiseTagOut(BaseModel):
    id: int
    name: str

    class Config:
        from_attributes = True


# Resolve forward references
TokenResponse.model_rebuild()



# ── Coverage Gaps ─────────────────────────────────────────────────────

# ── Quick-Create Contact ─────────────────────────────────────────────

class QuickCreateContactRequest(BaseModel):
    name: str
    email: str
    company_name: Optional[str] = None
    job_title: Optional[str] = None
    responsibility_domain: Optional[str] = None


class QuickCreateContactResponse(BaseModel):
    id: int
    full_name: str
    email: str
    company_name: Optional[str] = None
    data_source: str

    class Config:
        from_attributes = True


class CoverageGapOut(BaseModel):
    id: int
    company_name: str
    industry: Optional[str] = None
    tier: Optional[str] = None
    contacts_in_crm: Optional[int] = None
    critical_gap_count: int = 0
    potential_gap_count: int = 0
    total_gap_count: int = 0
    missing_domains_critical: Optional[str] = None
    missing_titles_critical: Optional[str] = None
    missing_domains_potential: Optional[str] = None
    missing_titles_potential: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

