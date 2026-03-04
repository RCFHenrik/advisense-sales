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
