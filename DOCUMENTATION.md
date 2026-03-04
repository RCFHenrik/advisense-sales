# Advisense Sales Coordination Platform — Technical Handover Documentation

> **Generated:** 2026-03-03
> **Status:** Active prototype — internal use only
> **Maintainer:** [insert new developer name]

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Installation Instructions](#4-installation-instructions)
5. [Environment Variables](#5-environment-variables)
6. [Build & Production Setup](#6-build--production-setup)
7. [External Integrations](#7-external-integrations)
8. [Architecture & Key Concepts](#8-architecture--key-concepts)
9. [Database Schema](#9-database-schema)
10. [API Reference](#10-api-reference)
11. [Role-Based Access Control](#11-role-based-access-control)
12. [Known Limitations / Technical Debt](#12-known-limitations--technical-debt)
13. [Recommended Improvements](#13-recommended-improvements)

---

## 1. Project Overview

### What the App Does

The **Advisense Sales Coordination Platform** is an internal B2B sales tool designed to help
Advisense consultants and their managers coordinate outreach to existing and prospective
clients. It acts as a lightweight CRM layer on top of HubSpot-exported contact data, with
built-in workflows for:

- **Contact discovery**: Browsing and filtering a large contact database (~15,000 records),
  scoring contacts by priority, and pinning key targets.
- **Outreach management**: A multi-step lifecycle (proposal → acceptance → email drafting →
  sending → follow-up / outcome tracking). Includes AI-assisted email generation using
  Jinja2 templates and hot-topic market context.
- **Manager oversight**: Role-scoped dashboards showing each consultant's activity metrics,
  rolling weekly/monthly objectives, and conversion funnel.
- **Data hygiene**: Bulk import of contacts and meetings from Excel (HubSpot exports), with
  configurable column mappings and a suppression list.
- **Administration**: System configuration (cooldown periods, scoring weights), audit log,
  email templates with versioning, and hot topic management.

### Main Features

| Feature | Description |
|---|---|
| Contact Database | Filter by tier, sector, domain, BA, team, domicile, revenue; priority scoring; pin contacts |
| Outreach Lifecycle | Proposal → Accept → Draft Email → Send → Outcome (13 statuses); negation workflow |
| Email Generation | Jinja2 template rendering with language selection, hot topic injection, meeting slots |
| Dashboard | Rolling 7/30-day objective tracking per consultant; filterable overview + detail tabs |
| Consultant Management | Target/Week and Target/Month per consultant; role-scoped visibility |
| Data Import | Excel (.xlsx) bulk import for contacts and meetings; upload history |
| Email Templates | Versioned templates per language and responsibility domain; draft/publish workflow |
| Hot Topics | Market insights injected into email context, scoped by BA + domain + language |
| Admin Panel | System config, column mappings, suppression list, audit log |
| Authentication | JWT-based login; 4 role levels (admin, ba_manager, team_manager, consultant) |

### Target Users

- **Consultants** — View their own contacts/outreach, draft and send emails, set outcomes
- **Team Managers** — Oversee their team's consultants; set outreach targets
- **BA Managers** — Oversee all consultants and team managers in their Business Area
- **Admins** — Full system access; manage system config, templates, and uploads

---

## 2. Tech Stack

### Backend

| Component | Technology | Version |
|---|---|---|
| Framework | FastAPI | 0.115.6 |
| ASGI Server | Uvicorn | 0.34.0 |
| ORM | SQLAlchemy | 2.0.36 |
| Database | SQLite (file-based) | — |
| Migrations | Custom (raw SQL + PRAGMA) | — |
| Data Validation | Pydantic v2 | 2.10.3 |
| Authentication | JWT via python-jose | 3.3.0 |
| Password Hashing | bcrypt (direct, not passlib) | 5.0.0 |
| Email Templating | Jinja2 | 3.1.4 |
| Excel Import | openpyxl | 3.1.5 |
| HTTP Client | httpx | 0.28.1 |
| Settings | pydantic-settings | 2.7.0 |
| Runtime | Python 3.13 | 3.13.x |

### Frontend

| Component | Technology | Version |
|---|---|---|
| Framework | React | 18.3.1 |
| Language | TypeScript | 5.7.2 |
| Build Tool | Vite | 6.0.3 |
| Routing | React Router v6 | 6.28.0 |
| HTTP Client | Axios | 1.7.9 |
| Charts | Recharts | 2.15.0 |
| Icons | Lucide React | 0.468.0 |
| Styling | Plain CSS (custom properties) | — |
| Node.js | Portable v22.14.0 | 22.14.0 |

### Runtime Environment Notes

> ⚠️ **IMPORTANT for new developers on this machine:**
>
> - **Python 3.13** is in use. `passlib[bcrypt]` is **incompatible** with Python 3.13.
>   The codebase uses `bcrypt` directly (not via passlib). Do **not** add passlib as a dependency.
> - **Node.js is not installed system-wide.** A portable installation lives at:
>   `C:\Users\Henrik.Nilsson\AppData\Local\node-portable\`
>   You must add this directory to PATH or invoke `npm.cmd` explicitly from that path.
> - **Port 8000** is occupied by NT-ware printer software. The backend runs on **port 8001**.
> - **No admin rights** are available on this machine for software installation — use portable
>   or zip packages.

---

## 3. Project Structure

```
Claude01_SalesSupport/
├── backend/
│   ├── app/
│   │   ├── main.py                    ← FastAPI app entry point; registers routers, runs migrations
│   │   ├── core/
│   │   │   ├── auth.py                ← JWT creation, get_current_user(), require_role() dependency
│   │   │   ├── config.py              ← Settings (pydantic-settings, reads .env)
│   │   │   ├── database.py            ← SQLAlchemy engine, SessionLocal, Base, get_db()
│   │   │   └── migrations.py          ← Idempotent schema migrations (runs on every startup)
│   │   ├── models/
│   │   │   └── models.py              ← All SQLAlchemy ORM models (15 tables + enums)
│   │   ├── schemas/
│   │   │   └── schemas.py             ← All Pydantic request/response schemas
│   │   ├── api/
│   │   │   └── routes/
│   │   │       ├── auth.py            ← POST /auth/login, GET /auth/me
│   │   │       ├── contacts.py        ← Contact list/detail/pin/filter endpoints
│   │   │       ├── employees.py       ← Employee CRUD, profile update, target setting
│   │   │       ├── outreach.py        ← Full outreach lifecycle (13 state transitions)
│   │   │       ├── negations.py       ← Negation listing
│   │   │       ├── templates.py       ← Email template CRUD + versioning
│   │   │       ├── hot_topics.py      ← Hot topic CRUD
│   │   │       ├── dashboard.py       ← Analytics: stats, leaderboard, consultant-summary
│   │   │       ├── uploads.py         ← Excel import for contacts and meetings
│   │   │       ├── admin.py           ← Business areas, teams, sites, config, suppression, audit
│   │   │       └── meetings.py        ← Meeting history listing
│   │   └── services/
│   │       ├── email_generator.py     ← Jinja2 email rendering with template variables
│   │       ├── excel_import.py        ← Contact + meeting bulk import logic; column mapping
│   │       ├── recommendation.py      ← Proposal generation; consultant-contact matching & scoring
│   │       ├── scoring.py             ← Contact priority score algorithm (weighted factors)
│   │       └── scheduling.py          ← Meeting slot calculation (excludes weekends/bank holidays)
│   ├── database/
│   │   └── sales_support.db           ← SQLite database file (WAL mode enabled)
│   ├── requirements.txt
│   └── seed.py                        ← Populates DB with demo employees, templates, hot topics
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   │   └── client.ts              ← Axios instance; JWT injection; 401 auto-logout
│   │   ├── components/
│   │   │   └── Layout.tsx             ← Sidebar + main content shell; role-filtered nav
│   │   ├── context/
│   │   │   └── AuthContext.tsx        ← Auth state, login/logout, localStorage persistence
│   │   ├── pages/
│   │   │   ├── LoginPage.tsx          ← Email/password login form
│   │   │   ├── DashboardPage.tsx      ← Overview + Detail tabs; rolling objective columns
│   │   │   ├── ContactsPage.tsx       ← Contact browser with filters, sorting, pin
│   │   │   ├── OutreachPage.tsx       ← Outreach list; generate proposals button
│   │   │   ├── OutreachDetailPage.tsx ← Full record editor; email compose; outcome tracking
│   │   │   ├── TemplatesPage.tsx      ← Email templates + hot topics management
│   │   │   ├── UploadPage.tsx         ← Excel file upload (contacts/meetings); history
│   │   │   ├── EmployeesPage.tsx      ← Consultant roster; set weekly/monthly targets
│   │   │   ├── ProfilePage.tsx        ← Self-service: description + domain expertise tags
│   │   │   └── AdminPage.tsx          ← Config, column mappings, suppression, audit log
│   │   ├── types/
│   │   │   └── index.ts               ← TypeScript interfaces for all entities
│   │   ├── App.tsx                    ← Route definitions; ProtectedRoute guard
│   │   ├── index.css                  ← All styles (600+ lines, no CSS framework)
│   │   └── main.tsx                   ← React root; BrowserRouter + AuthProvider
│   ├── package.json
│   └── vite.config.ts                 ← Vite config; /api proxy to localhost:8001
├── DOCUMENTATION.md                   ← This file
└── memory/
    └── MEMORY.md                      ← AI session memory (not for human use)
```

### Key File Descriptions

| File | Purpose |
|---|---|
| `backend/app/main.py` | App factory: CORS middleware, router registration, migration + table-create on startup |
| `backend/app/core/migrations.py` | Runs on every startup; idempotent ALTER TABLE statements; no Alembic |
| `backend/app/models/models.py` | Single file for all 15 database tables; all enums defined here |
| `backend/app/services/recommendation.py` | Core business logic: selects eligible contacts, scores them, creates PROPOSED outreach records |
| `backend/app/services/excel_import.py` | Handles flexible column mapping (configurable via admin panel); resolves booleans, dates, decimals |
| `frontend/src/api/client.ts` | Central API client; auto-injects Bearer token; auto-redirects to /login on 401 |
| `frontend/src/index.css` | All UI styling — no Tailwind, no Bootstrap. CSS custom properties for theming |

---

## 4. Installation Instructions

### Prerequisites

- Python 3.13 (other versions untested; 3.13 confirmed working)
- Node.js v22.14.0 (portable — see notes above)
- Git (for cloning)

### Backend Setup

```bash
# 1. Navigate to the backend directory
cd "C:\Users\Henrik.Nilsson\OneDrive - Advisense AB\Desktop\Claude01_SalesSupport\backend"

# 2. Create a virtual environment
python -m venv venv

# 3. Activate it (Windows Command Prompt)
venv\Scripts\activate.bat

# 4. Install dependencies
pip install -r requirements.txt

# 5. Seed the database (first run only — creates demo employees, templates, etc.)
python seed.py

# 6. Start the backend server
python -m uvicorn app.main:app --host 127.0.0.1 --port 8001
```

The backend will be available at: `http://localhost:8001`
Interactive API docs: `http://localhost:8001/api/docs`

> **Note:** Migrations run automatically on startup. You do NOT need to run any migration
> command separately. If the database file doesn't exist, SQLAlchemy creates it on startup.

### Frontend Setup

Because Node.js is portable (not in PATH by default), use the following approach:

**Option A — Python launcher script (recommended):**
```python
import subprocess, os
frontend = r'C:\Users\Henrik.Nilsson\OneDrive - Advisense AB\Desktop\Claude01_SalesSupport\frontend'
node_bin = r'C:\Users\Henrik.Nilsson\AppData\Local\node-portable'
env = os.environ.copy()
env['PATH'] = node_bin + ';' + env.get('PATH', '')
proc = subprocess.Popen([node_bin + r'\npm.cmd', 'run', 'dev'], cwd=frontend, env=env)
```

**Option B — Add to PATH temporarily and use npm:**
```cmd
SET PATH=C:\Users\Henrik.Nilsson\AppData\Local\node-portable;%PATH%
cd "C:\Users\Henrik.Nilsson\OneDrive - Advisense AB\Desktop\Claude01_SalesSupport\frontend"
npm install
npm run dev
```

The frontend will be available at: `http://localhost:5173`

### Demo Login Credentials

All accounts use the same password: **`Adv!Demo26`**

| Email | Role | Scope |
|---|---|---|
| anna.lindqvist@advisense.com | Admin | Full access |
| katrine.nielsen@advisense.com | BA Manager | Global Risk BA |
| erik.johansson@advisense.com | Team Manager | Risk Modelling SE team |
| maria.svensson@advisense.com | Consultant | Own records only |

---

## 5. Environment Variables

All settings are managed via `backend/app/core/config.py` using `pydantic-settings`.
Variables can be overridden by creating a `.env` file in the `backend/` directory.

### `.env` Example (backend/)

```ini
# Application
APP_NAME=Advisense Sales Coordination
APP_VERSION=0.1.0
DEBUG=true

# Database — path relative to where uvicorn is run from
DATABASE_URL=sqlite:///./database/sales_support.db

# Auth — CHANGE THIS in production!
SECRET_KEY=dev-secret-key-change-in-production
ACCESS_TOKEN_EXPIRE_MINUTES=480
ALGORITHM=HS256

# Microsoft Graph API (Outlook integration — not yet active)
AZURE_TENANT_ID=
AZURE_CLIENT_ID=
AZURE_CLIENT_SECRET=
GRAPH_API_ENDPOINT=https://graph.microsoft.com/v1.0

# Outreach defaults (also configurable via Admin panel at runtime)
DEFAULT_COOLDOWN_DAYS_OUTREACH=90
DEFAULT_COOLDOWN_DAYS_LAST_ACTIVITY=180
DEFAULT_MIN_LEAD_DAYS=7
DEFAULT_MEETING_DURATION_MINUTES=45
DEFAULT_WORK_START_HOUR=9
DEFAULT_WORK_END_HOUR=16

# Contact scoring weights (must sum to 1.0)
SCORE_WEIGHT_TIER=0.30
SCORE_WEIGHT_REVENUE=0.15
SCORE_WEIGHT_DAYS_SINCE_INTERACTION=0.25
SCORE_WEIGHT_DOMAIN_MATCH=0.20
SCORE_WEIGHT_SENIORITY=0.10
```

### Required Variables

Only `SECRET_KEY` is security-critical. All others have working defaults.

> ⚠️ **Production:** Set `SECRET_KEY` to a strong random string (e.g., `openssl rand -hex 32`).
> Do NOT use `dev-secret-key-change-in-production` in any non-local environment.

### Frontend Environment Variables

The frontend does not currently use `.env` files. The API proxy target (`localhost:8001`) is
hardcoded in `vite.config.ts`. For production, change the `proxy.target` or update the Axios
`baseURL` in `src/api/client.ts`.

---

## 6. Build & Production Setup

### Backend — Production

The backend is a standard FastAPI application. For production deployment:

```bash
# Install production dependencies
pip install -r requirements.txt

# Run with Uvicorn (add --workers for multi-process)
python -m uvicorn app.main:app --host 0.0.0.0 --port 8001 --workers 4
```

For a more robust setup, use **Gunicorn** with Uvicorn workers:
```bash
pip install gunicorn
gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w 4 -b 0.0.0.0:8001
```

> **Database:** SQLite works for low-concurrency use. For higher load, migrate to PostgreSQL
> by changing `DATABASE_URL` in `.env` (remove the `connect_args` SQLite override from
> `database.py` and ensure the WAL-mode pragma listener is guarded by `"sqlite" in url`).

### Frontend — Production Build

```bash
# With portable Node.js
SET PATH=C:\Users\Henrik.Nilsson\AppData\Local\node-portable;%PATH%
cd frontend
npm run build
```

This runs `tsc && vite build` and outputs static files to `frontend/dist/`.

Serve the `dist/` folder with any static file server (Nginx, Apache, Caddy, or the Python
`http.server` module for testing). For the `/api` proxy, configure your web server to
forward `/api/*` requests to the backend.

**Nginx config example:**
```nginx
server {
    listen 80;
    root /path/to/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;   # SPA fallback
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## 7. External Integrations

### Currently Active

| Integration | Type | Status |
|---|---|---|
| HubSpot CRM | Data import only (Excel export → upload) | ✅ Active |
| Microsoft Graph / Outlook | Email send, calendar | 🔧 Configured but NOT implemented |

### HubSpot Integration

Data flows **one way**: HubSpot → Excel export → manual upload via the Upload page.

- Contacts are imported from a HubSpot contact export (`.xlsx`).
- Meetings are imported from a HubSpot meeting export (`.xlsx`).
- Column names in the Excel file are mapped to logical fields via the Admin → Column Mappings panel.
- The `relevant_search` boolean field on Contact is pre-classified externally (not by HubSpot);
  it indicates whether a contact's job title is relevant for the Global Risk BA.
- The `SuppressionEntry.hubspot_update_required` flag is set when a contact is suppressed, as a
  reminder to update HubSpot manually. No automatic sync exists.

### Microsoft Graph API (Planned)

Credentials are configured in `.env` but no code calls the Graph API yet. The intent is:
- Send outreach emails directly from Outlook (via consultant's mailbox)
- Read calendar availability when proposing meeting slots
- Mark sent emails with message ID for reply tracking

**Credentials needed:**
- `AZURE_TENANT_ID` — Azure AD tenant ID
- `AZURE_CLIENT_ID` — App registration client ID
- `AZURE_CLIENT_SECRET` — App registration secret

**Relevant file:** `backend/app/core/config.py` (settings already defined)

---

## 8. Architecture & Key Concepts

### Request Lifecycle

```
Browser → Vite Dev Server (localhost:5173)
       → /api/* proxy → FastAPI (localhost:8001)
       → Route handler → SQLAlchemy → SQLite
```

### Authentication & Token Flow

1. `POST /api/auth/login` → returns `{ access_token: string, employee: Employee }`
2. Token stored in `localStorage` by `AuthContext`
3. Every Axios request adds `Authorization: Bearer <token>` (via interceptor in `client.ts`)
4. Backend validates JWT in `get_current_user()`, returns 401 if invalid/expired
5. Axios 401 interceptor clears localStorage and redirects to `/login`
6. Token expiry: **480 minutes** (8 hours); configurable via `ACCESS_TOKEN_EXPIRE_MINUTES`

### Outreach Lifecycle (State Machine)

```
CANDIDATE
  └─→ PROPOSED      (recommendation engine creates record)
       ├─→ NEGATED  (rejected with reason; stored in Negation table)
       └─→ ACCEPTED
            └─→ DRAFT
                 └─→ PREPARED   (email generated/previewed)
                      └─→ SENT
                           ├─→ REPLIED
                           ├─→ MEETING_BOOKED
                           └─→ CLOSED_MET / CLOSED_NO_RESPONSE /
                               CLOSED_NOT_RELEVANT / CLOSED_BOUNCED
```

- `sent_at` is set when the record transitions to SENT/PREPARED; this drives rolling
  objective calculations (7-day and 30-day windows).
- `cooldown_override` flag allows bypassing the 90-day cooldown for special cases.

### Recommendation Engine (`services/recommendation.py`)

When "Generate Proposals" is triggered:
1. Fetches all active, non-suppressed contacts not in cooldown
2. Scores each contact per consultant using 5 weighted factors:
   - **Client tier** (30%) — Tier 1 highest
   - **Revenue** (15%) — Higher revenue = higher score
   - **Days since last interaction** (25%) — Longer gap = higher priority
   - **Domain match** (20%) — Contact's domain matches consultant's expertise
   - **Seniority** (10%) — Senior consultants get senior contacts
3. Creates PROPOSED outreach records for top-ranked matches
4. Avoids duplicates (existing PROPOSED/ACCEPTED/DRAFT records)

### Contact Scoring (`services/scoring.py`)

The `priority_score` shown in the contact list is computed via the same weighted algorithm,
stored as a float on the Contact record. It is recalculated on each contact import.

### Email Generation (`services/email_generator.py`)

Uses Jinja2 templating:
- Template selected by: consultant's primary language + contact's responsibility domain + BA
- Variables injected: contact name, company, consultant name/title, hot topics (2 random per
  language + domain), meeting slots (3 options from scheduling service)
- Template versioning: templates have `is_active` flag and `published_at` timestamp; only
  active templates are used in generation

### Migrations (`core/migrations.py`)

The project does **not** use Alembic. Instead, `migrations.py` runs on every startup:
- Checks `PRAGMA table_info(table_name)` for each expected column
- Adds missing columns via `ALTER TABLE` if absent
- Idempotent — safe to run repeatedly

When adding a new column:
1. Add it to the ORM model in `models.py`
2. Add an idempotent block in `migrations.py`
3. Restart the backend — migration runs automatically

---

## 9. Database Schema

### Tables Overview

| Table | Description |
|---|---|
| `business_areas` | Top-level organizational units (Risk, Finance, Tech, Advisory) |
| `sites` | Geographic locations (Stockholm, Oslo, Copenhagen, Helsinki, Frankfurt, London) |
| `teams` | Teams within a business area |
| `employees` | Consultants and managers; login credentials; role; team/BA assignment; outreach targets |
| `contacts` | CRM contacts imported from HubSpot; ~15,000 records; priority score; relevant_search flag |
| `outreach_records` | One record per consultant-contact outreach; tracks full lifecycle + email content |
| `negations` | Rejection records when a PROPOSED outreach is declined; stores reason |
| `meetings` | Historical meetings imported from HubSpot; used for context in email generation |
| `email_templates` | Jinja2 email templates; versioned; scoped by language + responsibility domain + BA |
| `hot_topics` | Market talking points; scoped by BA + responsibility domain + language |
| `suppression_entries` | Do-not-contact list; linked to contact; includes reason and HubSpot sync flag |
| `system_config` | Key-value configuration store; overrides `.env` defaults at runtime |
| `column_mappings` | Maps physical Excel column names to logical import fields (contacts/meetings) |
| `audit_log` | Immutable action log (employee, action, entity type, entity ID, timestamp) |
| `file_uploads` | Upload history; tracks filename, row counts, batch ID, timestamp |
| `bank_holidays` | Public holidays per site; used to exclude days in meeting slot calculation |

### Key Enums

```python
class RoleEnum(str, Enum):
    ADMIN = "admin"
    BA_MANAGER = "ba_manager"
    TEAM_MANAGER = "team_manager"
    CONSULTANT = "consultant"

class OutreachStatusEnum(str, Enum):
    CANDIDATE = "candidate"
    PROPOSED = "proposed"
    ACCEPTED = "accepted"
    DRAFT = "draft"
    PREPARED = "prepared"
    SENT = "sent"
    REPLIED = "replied"
    MEETING_BOOKED = "meeting_booked"
    NEGATED = "negated"
    CLOSED_MET = "closed_met"
    CLOSED_NO_RESPONSE = "closed_no_response"
    CLOSED_NOT_RELEVANT = "closed_not_relevant"
    CLOSED_BOUNCED = "closed_bounced"

class LanguageEnum(str, Enum):
    SWEDISH = "sv"
    NORWEGIAN = "no"
    DANISH = "da"
    ENGLISH = "en"
    GERMAN = "de"
    FINNISH = "fi"
```

### Important Columns

**`employees`**
- `outreach_target_per_week` — integer, default 3; drives Dashboard "Week Obj" column
- `outreach_target_per_month` — integer, nullable; drives Dashboard "Month Obj" column
- `password_hash` — bcrypt hash; set on creation; updated via admin panel

**`contacts`**
- `priority_score` — float; recalculated on import; drives default sort order
- `relevant_search` — boolean, nullable; pre-classified externally for Global Risk BA
- `owner_team` — string; stores internal HubSpot team codes (e.g., `SLG`, `FRM`), NOT app
  team names. Do not use this for app-side team filtering.

**`outreach_records`**
- `sent_at` — datetime; set on SENT/PREPARED transition; drives rolling 7/30-day objective counts
- `cooldown_override` — boolean; bypasses the 90-day repeat-contact check

---

## 10. API Reference

All endpoints are prefixed with `/api/`. Interactive docs at `/api/docs` (Swagger UI).

### Authentication

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/auth/login` | None | Login with `{ email, password }` |
| GET | `/auth/me` | Required | Get current user's Employee object |

### Contacts

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/contacts/` | Required | List contacts; supports: `search`, `tier`, `sector`, `domain`, `ba`, `team`, `domicile`, `relevant_search`, `sort_by`, `sort_dir`, `page`, `page_size` |
| GET | `/contacts/{id}` | Required | Get contact detail |
| GET | `/contacts/{id}/history` | Required | Outreach history for a contact |
| POST | `/contacts/{id}/pin` | Manager+ | Pin/unpin a contact |
| GET | `/contacts/filters` | Required | Get unique values for all filter dropdowns |

### Employees

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/employees/` | Required | List employees (role-scoped) |
| GET | `/employees/{id}` | Required | Get employee by ID |
| POST | `/employees/` | Admin | Create new employee |
| PUT | `/employees/{id}` | Admin | Update employee (all fields) |
| PATCH | `/employees/me` | Required | Self-update profile description + expertise tags |
| PATCH | `/employees/{id}/target` | Manager+ | Set outreach targets (week and/or month) |

### Outreach

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/outreach/` | Required | List outreach records (role-scoped); filter by status, employee, team, BA |
| GET | `/outreach/{id}` | Required | Get outreach record detail |
| POST | `/outreach/generate-proposals` | BA Manager+ | Run recommendation engine for a consultant |
| POST | `/outreach/{id}/generate-email` | Required | Generate email draft from template |
| PATCH | `/outreach/{id}/accept` | Required | Transition to ACCEPTED |
| PATCH | `/outreach/{id}/draft` | Required | Transition to DRAFT |
| PATCH | `/outreach/{id}/send` | Required | Mark as SENT (sets `sent_at`) |
| PATCH | `/outreach/{id}/mark-sent` | Required | Manually mark as sent with subject/body |
| PATCH | `/outreach/{id}/revert-to-draft` | Required | Revert PREPARED → DRAFT |
| POST | `/outreach/{id}/outcome` | Required | Set outcome (REPLIED, MEETING_BOOKED, CLOSED_*) |
| POST | `/outreach/{id}/negate` | Required | Negate proposal with reason |

### Dashboard

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/dashboard/stats` | Required | KPI summary (total contacts, sent this week, meetings, etc.) |
| GET | `/dashboard/consultant-summary` | Required | Per-consultant metrics: total, proposed, accepted, sent, negated, sent_7d, sent_30d, targets |
| GET | `/dashboard/outreach-by-status` | Required | Count per status |
| GET | `/dashboard/outreach-by-ba` | BA Manager+ | Count per business area |
| GET | `/dashboard/outreach-by-team` | Required | Count per team |
| GET | `/dashboard/consultant-leaderboard` | Required | Top consultants by activity |

### Other Endpoints

| Prefix | Description |
|---|---|
| `/templates/` | Email template CRUD (GET, POST, PUT, DELETE); filter by language/domain/BA |
| `/hot-topics/` | Hot topic CRUD (GET, POST, DELETE) |
| `/negations/` | List negations with filters |
| `/meetings/` | List historical meetings |
| `/uploads/contacts` | POST Excel file to import contacts |
| `/uploads/meetings` | POST Excel file to import meetings |
| `/uploads/history` | GET upload history |
| `/admin/business-areas` | CRUD for business areas |
| `/admin/teams` | CRUD for teams |
| `/admin/sites` | CRUD for sites |
| `/admin/column-mappings` | Manage import column mappings |
| `/admin/config` | Read/update system config key-value store |
| `/admin/suppression-list` | Manage do-not-contact list |
| `/admin/audit-log` | Read-only audit log |

---

## 11. Role-Based Access Control

### Hierarchy (strictly downward)

```
ADMIN
  └── BA_MANAGER  (sees: consultants + team_managers in their BA + self)
        └── TEAM_MANAGER  (sees: consultants in their team + self)
              └── CONSULTANT  (sees: only self)
```

### Scoping Implementation

Three places enforce scoping:

1. **`dashboard.py` → `_get_employee_scope()`** — returns list of visible employee IDs (or `None` for admin)
2. **`employees.py` → `list_employees()`** — applies bitwise SQLAlchemy filters
3. **`outreach.py` → `list_outreach()`** — applies subquery filter

The key pattern (SQLAlchemy, no `or_` import needed):
```python
query = query.filter(
    ((Employee.team_id == current_user.team_id) & (Employee.role == RoleEnum.CONSULTANT))
    | (Employee.id == current_user.id)
)
```

### Nav / UI Visibility

`Layout.tsx` hides nav items based on `user.role`:
- `/admin` — admin only
- `/upload` — admin + ba_manager
- `/employees` — admin + ba_manager + team_manager
- `/profile` — all roles (shown as a standalone link above the footer)

---

## 12. Known Limitations / Technical Debt

### Critical

1. **No real email sending** — Emails are composed and displayed in the UI but not actually
   sent. Microsoft Graph integration is configured but not implemented. All "sent" records
   are manually marked.

2. **JWT secret in code** — `SECRET_KEY` defaults to `dev-secret-key-change-in-production`
   in `config.py`. This must be set via environment variable before any production use.

3. **SQLite is single-file, single-writer** — Concurrent write operations will cause locking
   errors under moderate load. WAL mode mitigates this partially but SQLite is not suitable
   for production with multiple concurrent users.

4. **No password reset flow** — Passwords can only be changed by an admin via the admin panel.
   There is no self-service password reset or email-based reset.

### Technical Debt

5. **No Alembic migrations** — Schema changes are handled by a custom `migrations.py` with
   raw SQL. This is fragile for complex migrations (column rename, FK changes, data migrations).
   Consider migrating to Alembic for future schema management.

6. **Flat component structure** — All UI logic is in page files with minimal component
   extraction. Large pages like `ContactsPage.tsx` and `OutreachDetailPage.tsx` are 500+
   lines. Consider extracting reusable table, filter-bar, and modal components.

7. **HubSpot sync is manual** — There is no automated HubSpot sync. A developer must
   export CSVs from HubSpot and upload them. The `relevant_search` field is pre-classified
   externally by a separate script that is not part of this codebase.

8. **`owner_team` field stores CRM codes, not app team names** — The `Contact.owner_team`
   column contains internal HubSpot team codes (e.g., `SLG`, `FRM`). These are NOT the
   same as app team names ("Risk Modelling SE"). Do not use this field for app-side team
   scoping.

9. **Hard-coded test-employee migrations** — `migrations.py` contains data migrations that
   move specific test accounts (by email) into specific teams and BAs. These should be
   removed or made conditional (e.g., `DEBUG=True` only) before production use.

10. **No automated tests** — The project has no unit tests, integration tests, or frontend
    component tests. All testing has been manual.

11. **recharts and lucide-react are installed but barely used** — These dependencies are in
    `package.json` but most UI uses emoji and raw HTML/CSS. Consider either removing them
    or leveraging them more consistently.

12. **Meeting slots are calculated but not calendar-aware** — `scheduling.py` avoids weekends
    and bank holidays, but does not check actual calendar availability. The Microsoft Graph
    calendar integration would be needed for real free/busy checking.

---

## 13. Recommended Improvements

### Short-term (next sprint)

1. **Implement Microsoft Graph email sending**
   - Use `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` / `AZURE_TENANT_ID` already in config
   - Send emails via `/me/sendMail` Graph endpoint from the consultant's mailbox
   - Store the returned `message_id` on the outreach record
   - Implement a webhook or polling job to detect replies and auto-update status

2. **Add password reset flow**
   - Email-based reset via a one-time token
   - Requires an SMTP/Graph mail send capability (prerequisite: #1 above)

3. **Write backend tests**
   - Use `pytest` + `httpx.AsyncClient` for route integration tests
   - Seed an in-memory SQLite DB for each test session
   - Cover at minimum: auth, role scoping, outreach lifecycle state machine

4. **Automate HubSpot sync**
   - Use HubSpot's API (or webhook) to pull new/updated contacts on a schedule
   - Replace manual Excel upload with a background sync job (APScheduler or Celery)

5. **Externalize the `relevant_search` classifier**
   - The external script that classifies contact titles for Global Risk relevance should be
     part of this codebase or documented as a separate service
   - Consider running it as part of the upload pipeline (post-import scoring)

### Medium-term

6. **Migrate to PostgreSQL**
   - Change `DATABASE_URL` to a PostgreSQL connection string
   - Remove SQLite-specific `connect_args` and WAL pragma listener from `database.py`
   - Replace custom migrations with Alembic for reliable schema management

7. **Extract reusable frontend components**
   - `<DataTable>` — sortable table with configurable columns and empty state
   - `<FilterBar>` — generic multi-select filter panel
   - `<Modal>` — generic modal with header/body/footer slots
   - This would significantly reduce page file sizes and improve maintainability

8. **Add Alembic for database migrations**
   - Current approach (raw SQL in `migrations.py`) is brittle for complex changes
   - Initialize Alembic and convert existing migrations to versioned scripts

9. **Add rate limiting and request logging**
   - Use `slowapi` for per-endpoint rate limiting
   - Add structured request logging (request ID, user ID, duration) via middleware

10. **Role-based data export**
    - Allow managers to export their team's outreach summary to Excel
    - Useful for reporting to senior management without needing app access

### Long-term

11. **Multi-BA / multi-tenant support**
    - Currently the app is scoped to one Advisense instance
    - Consider generalizing organizational structures for other clients

12. **Outlook add-in**
    - A lightweight Outlook add-in could let consultants log outcomes directly from their inbox
    - Requires Microsoft Graph + Office.js integration

13. **Mobile-responsive refinement**
    - The app has a 768px breakpoint but is primarily desktop-targeted
    - For field use, a mobile-first view of the outreach list + outcome logging would be valuable
