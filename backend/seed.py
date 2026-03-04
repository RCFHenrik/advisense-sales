"""Seed the database with sample data for development/demo."""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from datetime import datetime, timedelta, timezone
import bcrypt as _bcrypt

from app.core.database import Base, engine, SessionLocal
from app.models.models import (
    BusinessArea, Site, Team, Employee, RoleEnum, LanguageEnum,
    EmailTemplate, HotTopic, SystemConfig, BankHoliday,
)


def _hash_password(password: str) -> str:
    return _bcrypt.hashpw(password.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")


def seed():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    # Check if already seeded
    if db.query(Employee).count() > 0:
        print("Database already seeded. Skipping.")
        db.close()
        return

    # ── Business Areas ──
    ba_risk = BusinessArea(name="Risk & Compliance")
    ba_finance = BusinessArea(name="Finance & Treasury")
    ba_tech = BusinessArea(name="Technology & Data")
    ba_advisory = BusinessArea(name="Advisory")
    db.add_all([ba_risk, ba_finance, ba_tech, ba_advisory])
    db.flush()

    # ── Sites ──
    site_sthlm = Site(name="Stockholm", country_code="SE")
    site_oslo = Site(name="Oslo", country_code="NO")
    site_cph = Site(name="Copenhagen", country_code="DK")
    site_hki = Site(name="Helsinki", country_code="FI")
    site_ffm = Site(name="Frankfurt", country_code="DE")
    site_lon = Site(name="London", country_code="GB")
    db.add_all([site_sthlm, site_oslo, site_cph, site_hki, site_ffm, site_lon])
    db.flush()

    # ── Teams ──
    team_risk_se = Team(name="Risk Modelling SE", business_area_id=ba_risk.id, outreach_target_per_week=5)
    team_risk_no = Team(name="Risk Advisory NO", business_area_id=ba_risk.id, outreach_target_per_week=4)
    team_finance = Team(name="Finance Transformation", business_area_id=ba_finance.id, outreach_target_per_week=5)
    team_tech = Team(name="Data & Analytics", business_area_id=ba_tech.id, outreach_target_per_week=4)
    team_advisory = Team(name="Strategic Advisory", business_area_id=ba_advisory.id, outreach_target_per_week=3)
    db.add_all([team_risk_se, team_risk_no, team_finance, team_tech, team_advisory])
    db.flush()

    # ── Employees ──
    pw = _hash_password("Adv!Demo26")

    employees = [
        Employee(
            name="Anna Lindqvist", email="anna.lindqvist@advisense.com",
            team_id=team_risk_se.id, business_area_id=ba_risk.id, site_id=site_sthlm.id,
            role=RoleEnum.ADMIN, seniority="partner", primary_language=LanguageEnum.SWEDISH,
            domain_expertise_tags='["Risk Modelling", "Credit Risk", "IFRS 9"]',
            outreach_target_per_week=2, password_hash=pw,
        ),
        Employee(
            name="Erik Johansson", email="erik.johansson@advisense.com",
            team_id=team_risk_se.id, business_area_id=ba_risk.id, site_id=site_sthlm.id,
            role=RoleEnum.TEAM_MANAGER, seniority="senior", primary_language=LanguageEnum.SWEDISH,
            domain_expertise_tags='["Market Risk", "Operational Risk", "Basel IV"]',
            outreach_target_per_week=4, password_hash=pw,
        ),
        Employee(
            name="Maria Svensson", email="maria.svensson@advisense.com",
            team_id=team_risk_se.id, business_area_id=ba_risk.id, site_id=site_sthlm.id,
            role=RoleEnum.CONSULTANT, seniority="mid", primary_language=LanguageEnum.SWEDISH,
            domain_expertise_tags='["Risk Modelling", "Stress Testing"]',
            outreach_target_per_week=5, password_hash=pw,
        ),
        Employee(
            name="Lars Hansen", email="lars.hansen@advisense.com",
            team_id=team_risk_no.id, business_area_id=ba_risk.id, site_id=site_oslo.id,
            role=RoleEnum.CONSULTANT, seniority="senior", primary_language=LanguageEnum.NORWEGIAN,
            domain_expertise_tags='["AML/KYC", "Regulatory Compliance", "Risk Assessment"]',
            outreach_target_per_week=4, password_hash=pw,
        ),
        Employee(
            name="Katrine Nielsen", email="katrine.nielsen@advisense.com",
            team_id=team_finance.id, business_area_id=ba_finance.id, site_id=site_cph.id,
            role=RoleEnum.BA_MANAGER, seniority="principal", primary_language=LanguageEnum.DANISH,
            domain_expertise_tags='["Finance Transformation", "Treasury", "ALM"]',
            outreach_target_per_week=3, password_hash=pw,
        ),
        Employee(
            name="Markus Weber", email="markus.weber@advisense.com",
            team_id=team_tech.id, business_area_id=ba_tech.id, site_id=site_ffm.id,
            role=RoleEnum.CONSULTANT, seniority="senior", primary_language=LanguageEnum.GERMAN,
            domain_expertise_tags='["Data Analytics", "Machine Learning", "RegTech"]',
            outreach_target_per_week=4, password_hash=pw,
        ),
        Employee(
            name="Mika Virtanen", email="mika.virtanen@advisense.com",
            team_id=team_advisory.id, business_area_id=ba_advisory.id, site_id=site_hki.id,
            role=RoleEnum.CONSULTANT, seniority="mid", primary_language=LanguageEnum.FINNISH,
            domain_expertise_tags='["Strategy", "Digital Transformation", "Payments"]',
            outreach_target_per_week=5, password_hash=pw,
        ),
    ]
    db.add_all(employees)
    db.flush()

    # ── Email Templates ──
    templates = [
        EmailTemplate(
            name="General Outreach - English",
            language=LanguageEnum.ENGLISH,
            subject_template="Meeting opportunity – {{ employee_ba }}",
            body_template=(
                "Dear {{ contact_first_name }},\n\n"
                "My name is {{ employee_name }} and I work as {{ employee_title }} at {{ company_name }}. "
                "We are actively engaged in {{ contact_domain }} and I would welcome the opportunity to "
                "schedule a brief meeting to discuss how we might support your work.\n\n"
                "{% if hot_topics %}Current topics we see in the market include: {{ hot_topics_text }}.{% endif %}\n\n"
                "{{ meeting_phrasing }}\n\n"
                "{% if slot_1 or slot_2 %}I would like to suggest the following times:\n"
                "{% if slot_1 %}  - {{ slot_1 }}\n{% endif %}"
                "{% if slot_2 %}  - {{ slot_2 }}\n{% endif %}\n{% endif %}"
                "Kind regards,\n{{ employee_name }}\n{{ company_name }}"
            ),
            created_by_id=employees[0].id,
        ),
        EmailTemplate(
            name="General Outreach - Swedish",
            language=LanguageEnum.SWEDISH,
            subject_template="Möjlighet till samtal – {{ employee_ba }}",
            body_template=(
                "Hej {{ contact_first_name }},\n\n"
                "Mitt namn är {{ employee_name }} och jag arbetar som {{ employee_title }} på {{ company_name }}. "
                "Vi arbetar aktivt inom {{ contact_domain }} och jag skulle gärna vilja boka in ett kort möte "
                "för att diskutera hur vi kan stötta er.\n\n"
                "{% if hot_topics %}Aktuella ämnen vi ser i marknaden inkluderar: {{ hot_topics_text }}.{% endif %}\n\n"
                "{{ meeting_phrasing }}\n\n"
                "{% if slot_1 or slot_2 %}Jag föreslår följande tider:\n"
                "{% if slot_1 %}  - {{ slot_1 }}\n{% endif %}"
                "{% if slot_2 %}  - {{ slot_2 }}\n{% endif %}\n{% endif %}"
                "Med vänliga hälsningar,\n{{ employee_name }}\n{{ company_name }}"
            ),
            created_by_id=employees[0].id,
        ),
        EmailTemplate(
            name="General Outreach - German",
            language=LanguageEnum.GERMAN,
            subject_template="Gesprächsmöglichkeit – {{ employee_ba }}",
            body_template=(
                "Sehr geehrte/r {{ contact_first_name }} {{ contact_last_name }},\n\n"
                "mein Name ist {{ employee_name }} und ich arbeite als {{ employee_title }} bei {{ company_name }}. "
                "Wir sind aktiv im Bereich {{ contact_domain }} tätig und ich würde mich freuen, "
                "ein kurzes Gespräch zu vereinbaren.\n\n"
                "{% if hot_topics %}Aktuelle Themen: {{ hot_topics_text }}.{% endif %}\n\n"
                "{{ meeting_phrasing }}\n\n"
                "{% if slot_1 or slot_2 %}Ich schlage folgende Termine vor:\n"
                "{% if slot_1 %}  - {{ slot_1 }}\n{% endif %}"
                "{% if slot_2 %}  - {{ slot_2 }}\n{% endif %}\n{% endif %}"
                "Mit freundlichen Grüßen,\n{{ employee_name }}\n{{ company_name }}"
            ),
            created_by_id=employees[0].id,
        ),
    ]
    db.add_all(templates)

    # ── Hot Topics ──
    hot_topics = [
        HotTopic(business_area_id=ba_risk.id, responsibility_domain="Risk & Models", topic_text="Basel IV implementation timelines", language=LanguageEnum.ENGLISH),
        HotTopic(business_area_id=ba_risk.id, responsibility_domain="Risk & Models", topic_text="IFRS 9 model validation updates", language=LanguageEnum.ENGLISH),
        HotTopic(business_area_id=ba_risk.id, responsibility_domain="Compliance", topic_text="AML/CFT regulatory changes in the Nordics", language=LanguageEnum.ENGLISH),
        HotTopic(business_area_id=ba_finance.id, responsibility_domain="Finance & Treasury", topic_text="Interest rate risk in the banking book (IRRBB)", language=LanguageEnum.ENGLISH),
        HotTopic(business_area_id=ba_tech.id, responsibility_domain="Technology", topic_text="AI/ML adoption in regulatory reporting", language=LanguageEnum.ENGLISH),
        HotTopic(business_area_id=ba_risk.id, responsibility_domain="Risk & Models", topic_text="Basel IV implementeringsplan", language=LanguageEnum.SWEDISH),
        HotTopic(business_area_id=ba_risk.id, responsibility_domain="Compliance", topic_text="AML/CFT regulatoriska förändringar i Norden", language=LanguageEnum.SWEDISH),
    ]
    db.add_all(hot_topics)

    # ── System Config ──
    configs = [
        SystemConfig(key="cooldown_days_outreach", value="90", description="Block outreach if last sent within this many days"),
        SystemConfig(key="cooldown_days_last_activity", value="180", description="Block outreach if last activity date is within this many days"),
        SystemConfig(key="min_lead_days", value="7", description="Earliest proposed meeting date (days from now)"),
        SystemConfig(key="meeting_duration_minutes", value="45", description="Default meeting duration"),
        SystemConfig(key="work_start_hour", value="9", description="Working hours start"),
        SystemConfig(key="work_end_hour", value="16", description="Working hours end"),
        SystemConfig(key="score_weight_tier", value="0.30", description="Scoring weight for client tier"),
        SystemConfig(key="score_weight_revenue", value="0.15", description="Scoring weight for historical revenue"),
        SystemConfig(key="score_weight_days_since_interaction", value="0.25", description="Scoring weight for days since interaction"),
        SystemConfig(key="score_weight_domain_match", value="0.20", description="Scoring weight for domain match"),
        SystemConfig(key="score_weight_seniority", value="0.10", description="Scoring weight for seniority alignment"),
    ]
    db.add_all(configs)

    # ── Bank Holidays (2025-2026 Swedish) ──
    se_holidays = [
        ("2025-01-01", "Nyårsdagen"), ("2025-01-06", "Trettondedag jul"),
        ("2025-04-18", "Långfredagen"), ("2025-04-21", "Annandag påsk"),
        ("2025-05-01", "Första maj"), ("2025-05-29", "Kristi himmelsfärdsdag"),
        ("2025-06-06", "Sveriges nationaldag"), ("2025-06-20", "Midsommarafton"),
        ("2025-12-24", "Julafton"), ("2025-12-25", "Juldagen"),
        ("2025-12-26", "Annandag jul"), ("2025-12-31", "Nyårsafton"),
        ("2026-01-01", "Nyårsdagen"), ("2026-01-06", "Trettondedag jul"),
        ("2026-04-03", "Långfredagen"), ("2026-04-06", "Annandag påsk"),
        ("2026-05-01", "Första maj"), ("2026-05-14", "Kristi himmelsfärdsdag"),
        ("2026-06-06", "Sveriges nationaldag"), ("2026-06-19", "Midsommarafton"),
        ("2026-12-24", "Julafton"), ("2026-12-25", "Juldagen"),
        ("2026-12-26", "Annandag jul"), ("2026-12-31", "Nyårsafton"),
    ]
    for date_str, name in se_holidays:
        db.add(BankHoliday(
            site_id=site_sthlm.id,
            country_code="SE",
            date=datetime.strptime(date_str, "%Y-%m-%d"),
            name=name,
        ))

    db.commit()
    db.close()
    print("Database seeded successfully!")


if __name__ == "__main__":
    seed()
