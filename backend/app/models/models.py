import enum
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, Column, DateTime, Enum, Float, ForeignKey, Index, Integer,
    String, Text, UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.core.database import Base


def utcnow():
    return datetime.now(timezone.utc)


# ── Enums ──────────────────────────────────────────────────────────────

class RoleEnum(str, enum.Enum):
    CONSULTANT = "consultant"
    TEAM_MANAGER = "team_manager"
    BA_MANAGER = "ba_manager"
    ADMIN = "admin"


class OutreachStatusEnum(str, enum.Enum):
    CANDIDATE = "candidate"
    PROPOSED = "proposed"
    ACCEPTED = "accepted"
    DRAFT = "draft"
    PREPARED = "prepared"
    SENT = "sent"
    REPLIED = "replied"
    MEETING_BOOKED = "meeting_booked"
    CLOSED_MET = "closed_met"
    CLOSED_NO_RESPONSE = "closed_no_response"
    CLOSED_NOT_RELEVANT = "closed_not_relevant"
    CLOSED_BOUNCED = "closed_bounced"
    NEGATED = "negated"


class NegationReasonEnum(str, enum.Enum):
    WRONG_PERSON = "wrong_person"
    WRONG_DOMAIN = "wrong_domain"
    SENSITIVE_SITUATION = "sensitive_situation"
    NOT_APPROPRIATE_TIMING = "not_appropriate_timing"
    ANOTHER_CONSULTANT_BETTER = "another_consultant_better"
    DUPLICATE_ONGOING = "duplicate_ongoing"
    DO_NOT_CONTACT = "do_not_contact"


class ContactStatusEnum(str, enum.Enum):
    ACTIVE = "active"
    INACTIVE_MISSING = "inactive_missing"
    SUPPRESSED = "suppressed"


class LanguageEnum(str, enum.Enum):
    SWEDISH = "sv"
    NORWEGIAN = "no"
    DANISH = "da"
    ENGLISH = "en"
    GERMAN = "de"
    FINNISH = "fi"


# ── Organisational tables ──────────────────────────────────────────────

class BusinessArea(Base):
    __tablename__ = "business_areas"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False, unique=True)
    created_at = Column(DateTime, default=utcnow)

    teams = relationship("Team", back_populates="business_area")
    employees = relationship("Employee", back_populates="business_area")
    hot_topics = relationship("HotTopic", back_populates="business_area")


class Site(Base):
    __tablename__ = "sites"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False, unique=True)
    country_code = Column(String(10), nullable=False)
    created_at = Column(DateTime, default=utcnow)

    employees = relationship("Employee", back_populates="site")
    bank_holidays = relationship("BankHoliday", back_populates="site")


class Team(Base):
    __tablename__ = "teams"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False)
    business_area_id = Column(Integer, ForeignKey("business_areas.id"), nullable=False)
    outreach_target_per_week = Column(Integer, default=5)
    created_at = Column(DateTime, default=utcnow)

    business_area = relationship("BusinessArea", back_populates="teams")
    employees = relationship("Employee", back_populates="team")

    __table_args__ = (UniqueConstraint("name", "business_area_id"),)


# ── Employee (Consultant) ─────────────────────────────────────────────

class Employee(Base):
    __tablename__ = "employees"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False)
    email = Column(String(300), nullable=False, unique=True)
    team_id = Column(Integer, ForeignKey("teams.id"), nullable=True)
    business_area_id = Column(Integer, ForeignKey("business_areas.id"), nullable=True)
    site_id = Column(Integer, ForeignKey("sites.id"), nullable=True)
    role = Column(Enum(RoleEnum), nullable=False, default=RoleEnum.CONSULTANT)
    seniority = Column(String(50), nullable=True)
    primary_language = Column(Enum(LanguageEnum), default=LanguageEnum.ENGLISH)
    domain_expertise_tags = Column(Text, nullable=True)  # JSON array stored as text
    outreach_target_per_week = Column(Integer, default=3)
    outreach_target_per_month = Column(Integer, nullable=True, default=None)
    is_active = Column(Boolean, default=True)
    password_hash = Column(String(300), nullable=True)  # For mock auth
    profile_description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    team = relationship("Team", back_populates="employees")
    business_area = relationship("BusinessArea", back_populates="employees")
    site = relationship("Site", back_populates="employees")
    outreach_records = relationship("OutreachRecord", back_populates="employee", foreign_keys="OutreachRecord.employee_id")
    negations = relationship("Negation", back_populates="employee")


# ── Contact ────────────────────────────────────────────────────────────

class Contact(Base):
    __tablename__ = "contacts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    record_id = Column(String(100), nullable=True, index=True)
    first_name = Column(String(200), nullable=True)
    last_name = Column(String(200), nullable=True)
    full_name = Column(String(400), nullable=True)
    email = Column(String(300), nullable=True, index=True)
    job_title = Column(String(300), nullable=True)
    company_name = Column(String(400), nullable=True)
    associated_company_id = Column(String(100), nullable=True)
    sector = Column(String(200), nullable=True)
    client_tier = Column(String(50), nullable=True)
    responsibility_domain = Column(String(300), nullable=True)
    group_domicile = Column(String(100), nullable=True)
    owner_name = Column(String(200), nullable=True)
    owner_business_area = Column(String(200), nullable=True)
    owner_org_site = Column(String(200), nullable=True)
    owner_team = Column(String(200), nullable=True)
    owner_seniority = Column(String(50), nullable=True)
    last_activity_date = Column(DateTime, nullable=True)
    revenue = Column(Float, nullable=True)
    has_historical_revenue = Column(Boolean, default=False)
    days_since_interaction = Column(Integer, nullable=True)
    contacted_last_1y = Column(Boolean, default=False)
    relevant_search = Column(Boolean, nullable=True, default=None)
    status = Column(Enum(ContactStatusEnum), default=ContactStatusEnum.ACTIVE)
    priority_score = Column(Float, nullable=True)
    is_pinned = Column(Boolean, default=False)
    pinned_by_id = Column(Integer, ForeignKey("employees.id"), nullable=True)
    hubspot_import_batch = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    outreach_records = relationship("OutreachRecord", back_populates="contact")
    meetings = relationship("Meeting", back_populates="contact")

    __table_args__ = (
        Index("ix_contacts_dedup", "email", "associated_company_id", "full_name"),
    )


# ── Meeting ────────────────────────────────────────────────────────────

class Meeting(Base):
    __tablename__ = "meetings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    record_id = Column(String(100), nullable=True, index=True)
    contact_id = Column(Integer, ForeignKey("contacts.id"), nullable=True)
    employee_name = Column(String(200), nullable=True)
    employee_name_corrected = Column(String(200), nullable=True)
    activity_date = Column(DateTime, nullable=True)
    details = Column(Text, nullable=True)
    outcome = Column(String(100), nullable=True)
    associated_company = Column(String(400), nullable=True)
    associated_contacts = Column(Text, nullable=True)
    company_corrected = Column(String(400), nullable=True)
    client_tier = Column(String(50), nullable=True)
    group_domicile = Column(String(100), nullable=True)
    seniority = Column(String(50), nullable=True)
    hubspot_import_batch = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=utcnow)

    contact = relationship("Contact", back_populates="meetings")


# ── Outreach Record ───────────────────────────────────────────────────

class OutreachRecord(Base):
    __tablename__ = "outreach_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    contact_id = Column(Integer, ForeignKey("contacts.id"), nullable=False)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    status = Column(Enum(OutreachStatusEnum), nullable=False, default=OutreachStatusEnum.PROPOSED)

    # Email details
    email_subject = Column(String(500), nullable=True)
    email_body = Column(Text, nullable=True)
    email_language = Column(Enum(LanguageEnum), nullable=True)
    template_id = Column(Integer, ForeignKey("email_templates.id"), nullable=True)
    template_version = Column(String(50), nullable=True)

    # Meeting slots
    proposed_slot_1_start = Column(DateTime, nullable=True)
    proposed_slot_1_end = Column(DateTime, nullable=True)
    proposed_slot_2_start = Column(DateTime, nullable=True)
    proposed_slot_2_end = Column(DateTime, nullable=True)

    # Tracking
    message_id = Column(String(500), nullable=True)  # Outlook message ID
    sent_at = Column(DateTime, nullable=True)
    outcome = Column(String(200), nullable=True)
    outcome_notes = Column(Text, nullable=True)

    # Override tracking
    cooldown_override = Column(Boolean, default=False)
    cooldown_override_reason = Column(Text, nullable=True)

    # Recommendation metadata
    recommendation_score = Column(Float, nullable=True)
    recommendation_reason = Column(Text, nullable=True)

    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    contact = relationship("Contact", back_populates="outreach_records")
    employee = relationship("Employee", back_populates="outreach_records", foreign_keys=[employee_id])
    template = relationship("EmailTemplate")
    negation = relationship("Negation", back_populates="outreach_record", uselist=False)

    __table_args__ = (
        Index("ix_outreach_status", "status"),
        Index("ix_outreach_contact_employee", "contact_id", "employee_id"),
    )


# ── Negation ──────────────────────────────────────────────────────────

class Negation(Base):
    __tablename__ = "negations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    outreach_record_id = Column(Integer, ForeignKey("outreach_records.id"), nullable=False)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    reason = Column(Enum(NegationReasonEnum), nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)

    outreach_record = relationship("OutreachRecord", back_populates="negation")
    employee = relationship("Employee", back_populates="negations")


# ── Suppression List ──────────────────────────────────────────────────

class SuppressionEntry(Base):
    __tablename__ = "suppression_list"

    id = Column(Integer, primary_key=True, autoincrement=True)
    contact_id = Column(Integer, ForeignKey("contacts.id"), nullable=False, unique=True)
    reason = Column(Text, nullable=False)
    added_by_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    removed_by_id = Column(Integer, ForeignKey("employees.id"), nullable=True)
    is_active = Column(Boolean, default=True)
    hubspot_update_required = Column(Boolean, default=True)
    created_at = Column(DateTime, default=utcnow)
    removed_at = Column(DateTime, nullable=True)


# ── Email Template ────────────────────────────────────────────────────

class EmailTemplate(Base):
    __tablename__ = "email_templates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False)
    business_area_id = Column(Integer, ForeignKey("business_areas.id"), nullable=True)
    responsibility_domain = Column(String(300), nullable=True)
    language = Column(Enum(LanguageEnum), nullable=False)
    subject_template = Column(String(500), nullable=False)
    body_template = Column(Text, nullable=False)
    version = Column(String(50), default="1.0")
    is_active = Column(Boolean, default=True)
    published_at = Column(DateTime, nullable=True)
    created_by_id = Column(Integer, ForeignKey("employees.id"), nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


# ── Hot Topic ─────────────────────────────────────────────────────────

class HotTopic(Base):
    __tablename__ = "hot_topics"

    id = Column(Integer, primary_key=True, autoincrement=True)
    business_area_id = Column(Integer, ForeignKey("business_areas.id"), nullable=False)
    responsibility_domain = Column(String(300), nullable=False)
    topic_text = Column(Text, nullable=False)
    language = Column(Enum(LanguageEnum), nullable=False, default=LanguageEnum.ENGLISH)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=utcnow)

    business_area = relationship("BusinessArea", back_populates="hot_topics")


# ── Column Mapping ────────────────────────────────────────────────────

class ColumnMapping(Base):
    __tablename__ = "column_mappings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    file_type = Column(String(50), nullable=False)  # "contacts" or "meetings"
    logical_field = Column(String(200), nullable=False)
    physical_column = Column(String(300), nullable=False)
    is_required = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (UniqueConstraint("file_type", "logical_field"),)


# ── Bank Holiday ──────────────────────────────────────────────────────

class BankHoliday(Base):
    __tablename__ = "bank_holidays"

    id = Column(Integer, primary_key=True, autoincrement=True)
    site_id = Column(Integer, ForeignKey("sites.id"), nullable=True)
    country_code = Column(String(10), nullable=True)
    date = Column(DateTime, nullable=False)
    name = Column(String(200), nullable=False)

    site = relationship("Site", back_populates="bank_holidays")


# ── System Configuration ──────────────────────────────────────────────

class SystemConfig(Base):
    __tablename__ = "system_config"

    id = Column(Integer, primary_key=True, autoincrement=True)
    key = Column(String(200), nullable=False, unique=True)
    value = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)
    updated_by_id = Column(Integer, ForeignKey("employees.id"), nullable=True)


# ── Audit Log ─────────────────────────────────────────────────────────

class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True)
    action = Column(String(100), nullable=False)
    entity_type = Column(String(100), nullable=False)
    entity_id = Column(Integer, nullable=True)
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    details = Column(Text, nullable=True)
    timestamp = Column(DateTime, default=utcnow)

    __table_args__ = (
        Index("ix_audit_entity", "entity_type", "entity_id"),
        Index("ix_audit_timestamp", "timestamp"),
    )


# ── File Upload History ───────────────────────────────────────────────

class FileUpload(Base):
    __tablename__ = "file_uploads"

    id = Column(Integer, primary_key=True, autoincrement=True)
    file_type = Column(String(50), nullable=False)  # "contacts" or "meetings"
    filename = Column(String(500), nullable=False)
    row_count = Column(Integer, nullable=True)
    added_count = Column(Integer, default=0)
    updated_count = Column(Integer, default=0)
    removed_count = Column(Integer, default=0)
    uploaded_by_id = Column(Integer, ForeignKey("employees.id"), nullable=True)
    uploaded_at = Column(DateTime, default=utcnow)
    batch_id = Column(String(100), nullable=False)
    is_rolled_back = Column(Boolean, default=False)
