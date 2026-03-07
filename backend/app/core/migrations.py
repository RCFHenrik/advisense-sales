from sqlalchemy import text
from app.core.database import engine


def run_migrations():
    """Apply any pending schema migrations. Safe to call on every startup."""
    with engine.connect() as conn:
        result = conn.execute(text("PRAGMA table_info(employees)"))
        existing = {row[1] for row in result.fetchall()}
        if "profile_description" not in existing:
            conn.execute(text("ALTER TABLE employees ADD COLUMN profile_description TEXT"))
            conn.commit()

        # ── Global Risk BA: create if missing, reassign test employees ──────
        conn.execute(text(
            "INSERT INTO business_areas (name) "
            "SELECT 'Global Risk' "
            "WHERE NOT EXISTS (SELECT 1 FROM business_areas WHERE name = 'Global Risk')"
        ))
        conn.commit()

        gr_row = conn.execute(text(
            "SELECT id FROM business_areas WHERE name = 'Global Risk'"
        )).fetchone()
        gr_id = gr_row[0]

        # Move "Risk Modelling SE" team into Global Risk BA
        conn.execute(text(
            f"UPDATE teams SET business_area_id = {gr_id} WHERE name = 'Risk Modelling SE'"
        ))

        # Update all 4 test employee BAs to Global Risk
        conn.execute(text(
            f"UPDATE employees SET business_area_id = {gr_id} WHERE email IN ("
            f"'anna.lindqvist@advisense.com',"
            f"'erik.johansson@advisense.com',"
            f"'maria.svensson@advisense.com',"
            f"'katrine.nielsen@advisense.com')"
        ))

        # Move katrine into Risk Modelling SE team so team_manager scope covers her
        rse_row = conn.execute(text(
            "SELECT id FROM teams WHERE name = 'Risk Modelling SE'"
        )).fetchone()
        if rse_row:
            conn.execute(text(
                f"UPDATE employees SET team_id = {rse_row[0]} "
                f"WHERE email = 'katrine.nielsen@advisense.com'"
            ))

        conn.commit()

        # ── EmailTemplate: add business_area_id column if missing ───────────
        et_cols = [r[1] for r in conn.execute(text("PRAGMA table_info(email_templates)")).fetchall()]
        if "business_area_id" not in et_cols:
            conn.execute(text(
                "ALTER TABLE email_templates ADD COLUMN business_area_id INTEGER REFERENCES business_areas(id)"
            ))
            conn.commit()

        # ── EmailTemplate: add published_at column if missing ───────────────
        et_cols2 = [r[1] for r in conn.execute(text("PRAGMA table_info(email_templates)")).fetchall()]
        if "published_at" not in et_cols2:
            conn.execute(text(
                "ALTER TABLE email_templates ADD COLUMN published_at DATETIME"
            ))
            conn.commit()

        # ── Contact: add relevant_search column if missing ───────────────────
        c_cols = [r[1] for r in conn.execute(text("PRAGMA table_info(contacts)")).fetchall()]
        if "relevant_search" not in c_cols:
            conn.execute(text(
                "ALTER TABLE contacts ADD COLUMN relevant_search BOOLEAN"
            ))
            conn.commit()

        # ── Employee: add outreach_target_per_month column if missing ─────────
        emp_cols2 = [r[1] for r in conn.execute(text("PRAGMA table_info(employees)")).fetchall()]
        if "outreach_target_per_month" not in emp_cols2:
            conn.execute(text(
                "ALTER TABLE employees ADD COLUMN outreach_target_per_month INTEGER"
            ))
            conn.commit()

        # ── Contact: add client_name column if missing ────────────────────────
        c_cols2 = [r[1] for r in conn.execute(text("PRAGMA table_info(contacts)")).fetchall()]
        if "client_name" not in c_cols2:
            conn.execute(text("ALTER TABLE contacts ADD COLUMN client_name TEXT"))
            conn.commit()

        # ── Meeting: add new columns if missing ──────────────────────────────
        m_cols = [r[1] for r in conn.execute(text("PRAGMA table_info(meetings)")).fetchall()]
        for col in ("business_area", "team", "site", "client_name", "sector"):
            if col not in m_cols:
                conn.execute(text(f"ALTER TABLE meetings ADD COLUMN {col} TEXT"))
        conn.commit()

        # ── JobTitleDomain table ─────────────────────────────────────────────
        tables = [r[0] for r in conn.execute(text(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )).fetchall()]

        if "jobtitle_domains" not in tables:
            conn.execute(text("""
                CREATE TABLE jobtitle_domains (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_title VARCHAR(500) NOT NULL,
                    domain VARCHAR(300),
                    created_at DATETIME,
                    updated_at DATETIME
                )
            """))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_jobtitle_domains_job_title ON jobtitle_domains(job_title)"
            ))
            conn.commit()

        # ── ClassificationLookup table ───────────────────────────────────────
        if "classification_lookups" not in tables:
            conn.execute(text("""
                CREATE TABLE classification_lookups (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_title VARCHAR(500),
                    client_group_domicile VARCHAR(100),
                    client_tier VARCHAR(50),
                    client_industry VARCHAR(200),
                    num_contacts INTEGER,
                    meetings_total INTEGER,
                    top_ba_1 VARCHAR(200),
                    top_ba_1_count INTEGER,
                    top_ba_1_share REAL,
                    top_ba_2 VARCHAR(200),
                    top_ba_2_count INTEGER,
                    top_ba_2_share REAL,
                    top_team_1 VARCHAR(200),
                    top_team_1_count INTEGER,
                    top_team_1_share REAL,
                    top_team_2 VARCHAR(200),
                    top_team_2_count INTEGER,
                    top_team_2_share REAL,
                    top_registrator_1 VARCHAR(200),
                    top_registrator_1_count INTEGER,
                    top_registrator_1_share REAL,
                    top_registrator_2 VARCHAR(200),
                    top_registrator_2_count INTEGER,
                    top_registrator_2_share REAL,
                    meetings_jra_sa INTEGER,
                    meetings_manager INTEGER,
                    meetings_senior_manager INTEGER,
                    meetings_director INTEGER,
                    meetings_managing_director INTEGER,
                    meetings_other INTEGER,
                    created_at DATETIME
                )
            """))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_classification_lookup "
                "ON classification_lookups(job_title, client_group_domicile, client_tier, client_industry)"
            ))
            conn.commit()

        # ── HotTopic: add published_at, updated_at, created_by_id columns ──
        ht_cols = [r[1] for r in conn.execute(text("PRAGMA table_info(hot_topics)")).fetchall()]
        if "published_at" not in ht_cols:
            conn.execute(text("ALTER TABLE hot_topics ADD COLUMN published_at DATETIME"))
            conn.commit()
        if "updated_at" not in ht_cols:
            conn.execute(text("ALTER TABLE hot_topics ADD COLUMN updated_at DATETIME"))
            conn.commit()
        if "created_by_id" not in ht_cols:
            conn.execute(text(
                "ALTER TABLE hot_topics ADD COLUMN created_by_id INTEGER REFERENCES employees(id)"
            ))
            conn.commit()

        # ── EmailTemplate: add is_personal column ────────────────────────────
        et_cols3 = [r[1] for r in conn.execute(text("PRAGMA table_info(email_templates)")).fetchall()]
        if "is_personal" not in et_cols3:
            conn.execute(text(
                "ALTER TABLE email_templates ADD COLUMN is_personal BOOLEAN DEFAULT 0"
            ))
            conn.commit()

        # ── TemplateAttachment table ─────────────────────────────────────────
        tables2 = [r[0] for r in conn.execute(text(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )).fetchall()]

        if "template_attachments" not in tables2:
            conn.execute(text("""
                CREATE TABLE template_attachments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    template_id INTEGER NOT NULL REFERENCES email_templates(id),
                    original_filename VARCHAR(500) NOT NULL,
                    display_name VARCHAR(500) NOT NULL,
                    stored_filename VARCHAR(200) NOT NULL,
                    content_type VARCHAR(100) NOT NULL,
                    file_size_bytes INTEGER NOT NULL,
                    uploaded_by_id INTEGER REFERENCES employees(id),
                    is_active BOOLEAN DEFAULT 1,
                    created_at DATETIME,
                    updated_at DATETIME
                )
            """))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_template_attachments_template "
                "ON template_attachments(template_id)"
            ))
            conn.commit()

        # ── OutreachRecord: add selected_attachment_ids column ───────────────
        or_cols = [r[1] for r in conn.execute(text("PRAGMA table_info(outreach_records)")).fetchall()]
        if "selected_attachment_ids" not in or_cols:
            conn.execute(text(
                "ALTER TABLE outreach_records ADD COLUMN selected_attachment_ids TEXT"
            ))
            conn.commit()

        # ── Employee: add approval_status and uploaded_batch_id columns ───
        emp_cols3 = [r[1] for r in conn.execute(text("PRAGMA table_info(employees)")).fetchall()]
        if "approval_status" not in emp_cols3:
            conn.execute(text(
                "ALTER TABLE employees ADD COLUMN approval_status VARCHAR(20) DEFAULT 'approved' NOT NULL"
            ))
            conn.commit()
        if "uploaded_batch_id" not in emp_cols3:
            conn.execute(text(
                "ALTER TABLE employees ADD COLUMN uploaded_batch_id VARCHAR(100)"
            ))
            conn.commit()

        # ── SiteLanguage + EmployeeSiteLanguage tables ───────────────────────
        tables3 = [r[0] for r in conn.execute(text(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )).fetchall()]

        if "site_languages" not in tables3:
            conn.execute(text("""
                CREATE TABLE site_languages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name VARCHAR(100) NOT NULL UNIQUE,
                    code VARCHAR(10),
                    is_active BOOLEAN DEFAULT 1,
                    created_at DATETIME
                )
            """))
            conn.commit()

        if "employee_site_languages" not in tables3:
            conn.execute(text("""
                CREATE TABLE employee_site_languages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    employee_id INTEGER NOT NULL REFERENCES employees(id),
                    site_language_id INTEGER NOT NULL REFERENCES site_languages(id),
                    created_at DATETIME,
                    UNIQUE(employee_id, site_language_id)
                )
            """))
            conn.commit()

        # ── FileUpload: add stored_path column if missing ──────────────────
        fu_cols = [r[1] for r in conn.execute(text("PRAGMA table_info(file_uploads)")).fetchall()]
        if "stored_path" not in fu_cols:
            conn.execute(text(
                "ALTER TABLE file_uploads ADD COLUMN stored_path VARCHAR(500)"
            ))
            conn.commit()

        # ── Contact: add stop_flag_cleared_at column if missing ──────────
        c_cols3 = [r[1] for r in conn.execute(text("PRAGMA table_info(contacts)")).fetchall()]
        if "stop_flag_cleared_at" not in c_cols3:
            conn.execute(text(
                "ALTER TABLE contacts ADD COLUMN stop_flag_cleared_at DATETIME"
            ))
            conn.commit()
