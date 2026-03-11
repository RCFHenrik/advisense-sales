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
        conn.execute(
            text("UPDATE teams SET business_area_id = :ba_id WHERE name = 'Risk Modelling SE'"),
            {"ba_id": gr_id},
        )

        # Update all 4 test employee BAs to Global Risk
        conn.execute(
            text(
                "UPDATE employees SET business_area_id = :ba_id WHERE email IN ("
                "'anna.lindqvist@advisense.com',"
                "'erik.johansson@advisense.com',"
                "'maria.svensson@advisense.com',"
                "'katrine.nielsen@advisense.com')"
            ),
            {"ba_id": gr_id},
        )

        # Move katrine into Risk Modelling SE team so team_manager scope covers her
        rse_row = conn.execute(text(
            "SELECT id FROM teams WHERE name = 'Risk Modelling SE'"
        )).fetchone()
        if rse_row:
            conn.execute(
                text("UPDATE employees SET team_id = :team_id WHERE email = 'katrine.nielsen@advisense.com'"),
                {"team_id": rse_row[0]},
            )

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

        # ── System Config: seed FX rate entries if missing ────────────
        fx_defaults = [
            ("fx_rate_EUR", "0.087", "Exchange rate SEK → EUR"),
            ("fx_rate_NOK", "1.031", "Exchange rate SEK → NOK"),
            ("fx_rate_DKK", "0.649", "Exchange rate SEK → DKK"),
            ("fx_rate_GBP", "0.073", "Exchange rate SEK → GBP"),
        ]
        for key, val, desc in fx_defaults:
            exists = conn.execute(
                text("SELECT 1 FROM system_config WHERE key = :k"), {"k": key}
            ).fetchone()
            if not exists:
                conn.execute(
                    text("INSERT INTO system_config (key, value, description) VALUES (:k, :v, :d)"),
                    {"k": key, "v": val, "d": desc},
                )
        conn.commit()

        # ── Employee: add can_campaign column if missing ─────────────────
        emp_cols2 = [r[1] for r in conn.execute(text("PRAGMA table_info(employees)")).fetchall()]
        if "can_campaign" not in emp_cols2:
            conn.execute(text(
                "ALTER TABLE employees ADD COLUMN can_campaign BOOLEAN DEFAULT 0"
            ))
            conn.commit()

        # ── Campaign tables ─────────────────────────────────────────────
        tables_latest = [r[0] for r in conn.execute(text(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )).fetchall()]

        if "campaigns" not in tables_latest:
            conn.execute(text("""
                CREATE TABLE campaigns (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name VARCHAR(300) NOT NULL,
                    description TEXT,
                    email_subject VARCHAR(500) NOT NULL DEFAULT '',
                    email_body TEXT NOT NULL DEFAULT '',
                    email_language VARCHAR(10) NOT NULL DEFAULT 'en',
                    template_id INTEGER REFERENCES email_templates(id),
                    bcc_mode BOOLEAN DEFAULT 1,
                    status VARCHAR(20) NOT NULL DEFAULT 'draft',
                    created_by_id INTEGER NOT NULL REFERENCES employees(id),
                    scheduled_at DATETIME,
                    sent_at DATETIME,
                    created_at DATETIME,
                    updated_at DATETIME
                )
            """))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_campaigns_status ON campaigns(status)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_campaigns_created_by ON campaigns(created_by_id)"))
            conn.commit()

        if "campaign_recipients" not in tables_latest:
            conn.execute(text("""
                CREATE TABLE campaign_recipients (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
                    contact_id INTEGER NOT NULL REFERENCES contacts(id),
                    status VARCHAR(20) NOT NULL DEFAULT 'pending',
                    sent_at DATETIME,
                    error_message TEXT,
                    created_at DATETIME,
                    UNIQUE(campaign_id, contact_id)
                )
            """))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_campaign_recipients_campaign ON campaign_recipients(campaign_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_campaign_recipients_contact ON campaign_recipients(contact_id)"))
            conn.commit()

        # ── CampaignAttachment table ──────────────────────────────
        tables_ca = [r[0] for r in conn.execute(text(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )).fetchall()]

        if "campaign_attachments" not in tables_ca:
            conn.execute(text("""
                CREATE TABLE campaign_attachments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
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
                "CREATE INDEX IF NOT EXISTS ix_campaign_attachments_campaign "
                "ON campaign_attachments(campaign_id)"
            ))
            conn.commit()

        # ── Employee: must_change_password column ──────────────────────
        emp_cols_pw = [r[1] for r in conn.execute(text("PRAGMA table_info(employees)")).fetchall()]
        if "must_change_password" not in emp_cols_pw:
            conn.execute(text(
                "ALTER TABLE employees ADD COLUMN must_change_password BOOLEAN DEFAULT 0"
            ))
            conn.commit()

        # ── Contact: bounced_at column ─────────────────────────────────
        c_cols_bounce = [r[1] for r in conn.execute(text("PRAGMA table_info(contacts)")).fetchall()]
        if "bounced_at" not in c_cols_bounce:
            conn.execute(text(
                "ALTER TABLE contacts ADD COLUMN bounced_at DATETIME"
            ))
            conn.commit()

        # ── OutreachRecord: replied_at column ──────────────────────────
        or_cols_reply = [r[1] for r in conn.execute(text("PRAGMA table_info(outreach_records)")).fetchall()]
        if "replied_at" not in or_cols_reply:
            conn.execute(text(
                "ALTER TABLE outreach_records ADD COLUMN replied_at DATETIME"
            ))
            conn.commit()

        # ── CampaignRecipient: consultant assignment columns ─────────
        cr_cols = [r[1] for r in conn.execute(text("PRAGMA table_info(campaign_recipients)")).fetchall()]
        if "assigned_consultant_id" not in cr_cols:
            conn.execute(text(
                "ALTER TABLE campaign_recipients ADD COLUMN assigned_consultant_id INTEGER REFERENCES employees(id)"
            ))
            conn.commit()
        if "consultant_status" not in cr_cols:
            conn.execute(text(
                "ALTER TABLE campaign_recipients ADD COLUMN consultant_status VARCHAR(20)"
            ))
            conn.commit()
        if "custom_email_subject" not in cr_cols:
            conn.execute(text(
                "ALTER TABLE campaign_recipients ADD COLUMN custom_email_subject VARCHAR(500)"
            ))
            conn.commit()
        if "custom_email_body" not in cr_cols:
            conn.execute(text(
                "ALTER TABLE campaign_recipients ADD COLUMN custom_email_body TEXT"
            ))
            conn.commit()
        if "consultant_accepted_at" not in cr_cols:
            conn.execute(text(
                "ALTER TABLE campaign_recipients ADD COLUMN consultant_accepted_at DATETIME"
            ))
            conn.commit()

        # ── Notifications table ──────────────────────────────────────
        tables_notif = [r[0] for r in conn.execute(text(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )).fetchall()]

        if "notifications" not in tables_notif:
            conn.execute(text("""
                CREATE TABLE notifications (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    employee_id INTEGER NOT NULL REFERENCES employees(id),
                    notification_type VARCHAR(50) NOT NULL,
                    title VARCHAR(300) NOT NULL,
                    message TEXT,
                    link VARCHAR(500),
                    reference_type VARCHAR(50),
                    reference_id INTEGER,
                    is_read BOOLEAN DEFAULT 0,
                    created_at DATETIME
                )
            """))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_notifications_employee "
                "ON notifications(employee_id, is_read)"
            ))
            conn.commit()

        # -- Contact: add expert_areas column if missing --------------------
        c_cols_ea = [r[1] for r in conn.execute(text("PRAGMA table_info(contacts)")).fetchall()]
        if "expert_areas" not in c_cols_ea:
            conn.execute(text("ALTER TABLE contacts ADD COLUMN expert_areas TEXT"))
            conn.commit()

        # -- Contact: add is_decision_maker column if missing ---------------
        if "is_decision_maker" not in c_cols_ea:
            conn.execute(text(
                "ALTER TABLE contacts ADD COLUMN is_decision_maker BOOLEAN DEFAULT 0"
            ))
            conn.commit()

        # -- Contact: add opt_out_one_on_one column if missing ---------------
        if "opt_out_one_on_one" not in c_cols_ea:
            conn.execute(text(
                "ALTER TABLE contacts ADD COLUMN opt_out_one_on_one BOOLEAN DEFAULT 0"
            ))
            conn.commit()

        # -- Contact: add opt_out_marketing_info column if missing -----------
        if "opt_out_marketing_info" not in c_cols_ea:
            conn.execute(text(
                "ALTER TABLE contacts ADD COLUMN opt_out_marketing_info BOOLEAN DEFAULT 0"
            ))
            conn.commit()

        # -- OutreachRecord: add redirect tracking columns if missing ------
        or_cols_redir = [r[1] for r in conn.execute(text("PRAGMA table_info(outreach_records)")).fetchall()]
        if "redirected_from_id" not in or_cols_redir:
            conn.execute(text(
                "ALTER TABLE outreach_records ADD COLUMN redirected_from_id INTEGER REFERENCES outreach_records(id)"
            ))
            conn.commit()
        if "redirected_by_id" not in or_cols_redir:
            conn.execute(text(
                "ALTER TABLE outreach_records ADD COLUMN redirected_by_id INTEGER REFERENCES employees(id)"
            ))
            conn.commit()

        # -- Contact: add original_job_title column if missing -----------------
        c_cols_ojt = [r[1] for r in conn.execute(text("PRAGMA table_info(contacts)")).fetchall()]
        if "original_job_title" not in c_cols_ojt:
            conn.execute(text(
                "ALTER TABLE contacts ADD COLUMN original_job_title VARCHAR(300)"
            ))
            conn.commit()
            # Backfill: set original_job_title to current job_title for existing rows
            conn.execute(text(
                "UPDATE contacts SET original_job_title = job_title WHERE original_job_title IS NULL AND job_title IS NOT NULL"
            ))
            conn.commit()

        # -- ExpertiseTag table: create if missing ---------------------------------
        tables = [r[0] for r in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()]
        if "expertise_tags" not in tables:
            conn.execute(text("""
                CREATE TABLE expertise_tags (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name VARCHAR(200) NOT NULL UNIQUE,
                    is_active BOOLEAN DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """))
            conn.commit()

        # -- Contact: add relevance_tags column if missing ----------------------
        c_cols_rt = [r[1] for r in conn.execute(text("PRAGMA table_info(contacts)")).fetchall()]
        if "relevance_tags" not in c_cols_rt:
            conn.execute(text("ALTER TABLE contacts ADD COLUMN relevance_tags TEXT"))
            conn.commit()

        # -- Employee: add relevance_tags column if missing ---------------------
        emp_cols_rt = [r[1] for r in conn.execute(text("PRAGMA table_info(employees)")).fetchall()]
        if "relevance_tags" not in emp_cols_rt:
            conn.execute(text("ALTER TABLE employees ADD COLUMN relevance_tags TEXT"))
            conn.commit()

        # -- CampaignAnalysis table ---------------------------------------------
        tables_ca2 = [r[0] for r in conn.execute(text(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )).fetchall()]
        if "campaign_analyses" not in tables_ca2:
            conn.execute(text("""
                CREATE TABLE campaign_analyses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
                    attachment_id INTEGER REFERENCES campaign_attachments(id),
                    extracted_themes TEXT,
                    suggested_tags TEXT,
                    status VARCHAR(20) NOT NULL DEFAULT 'pending',
                    error_message TEXT,
                    created_at DATETIME,
                    completed_at DATETIME
                )
            """))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_campaign_analyses_campaign "
                "ON campaign_analyses(campaign_id)"
            ))
            conn.commit()

        # -- CoverageGap table --------------------------------------------------
        tables_cg = [r[0] for r in conn.execute(text(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )).fetchall()]
        if "coverage_gaps" not in tables_cg:
            conn.execute(text("""
                CREATE TABLE coverage_gaps (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_name VARCHAR(400) NOT NULL,
                    company_name_normalized VARCHAR(400) NOT NULL,
                    industry VARCHAR(200),
                    tier VARCHAR(50),
                    contacts_in_crm INTEGER,
                    critical_gap_count INTEGER DEFAULT 0,
                    potential_gap_count INTEGER DEFAULT 0,
                    total_gap_count INTEGER DEFAULT 0,
                    missing_domains_critical TEXT,
                    missing_titles_critical TEXT,
                    missing_domains_potential TEXT,
                    missing_titles_potential TEXT,
                    upload_batch_id VARCHAR(100),
                    created_at DATETIME
                )
            """))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_coverage_gaps_normalized "
                "ON coverage_gaps(company_name_normalized)"
            ))
            conn.commit()

        # -- CampaignRecipient: add added_via column if missing ------------------
        cr_cols2 = [r[1] for r in conn.execute(text("PRAGMA table_info(campaign_recipients)")).fetchall()]
        if "added_via" not in cr_cols2:
            conn.execute(text(
                "ALTER TABLE campaign_recipients ADD COLUMN added_via VARCHAR(20)"
            ))
            conn.commit()

        # -- Ensure relevance_tags column mapping exists for contacts -----------
        existing_rt_map = conn.execute(text(
            "SELECT 1 FROM column_mappings "
            "WHERE file_type = 'contacts' AND logical_field = 'relevance_tags'"
        )).fetchone()
        if not existing_rt_map:
            conn.execute(text(
                "INSERT INTO column_mappings (file_type, logical_field, physical_column, is_required) "
                "VALUES ('contacts', 'relevance_tags', 'RelevanceTags', 0)"
            ))
            conn.commit()

        # -- Contact: add data_source and contact_created_by_id columns --------
        c_cols_ds = [r[1] for r in conn.execute(text("PRAGMA table_info(contacts)")).fetchall()]
        if "data_source" not in c_cols_ds:
            conn.execute(text(
                "ALTER TABLE contacts ADD COLUMN data_source VARCHAR(50) DEFAULT 'import'"
            ))
            conn.commit()
        if "contact_created_by_id" not in c_cols_ds:
            conn.execute(text(
                "ALTER TABLE contacts ADD COLUMN contact_created_by_id INTEGER REFERENCES employees(id)"
            ))
            conn.commit()
