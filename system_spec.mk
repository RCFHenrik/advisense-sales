# Advisense Sales Coordination Platform — System Specification

## What is this?
An internal sales coordination tool for Advisense (a Nordic consulting firm). The goal is to help
consultants and managers coordinate outreach to potential clients — matching the right consultant
to the right contact, managing email campaigns, tracking engagement, and identifying coverage gaps
in our client portfolio.

Think of it as a lightweight CRM layer specifically designed for consultancy sales coordination,
not a full CRM replacement.

---

## Tech Stack

- **Backend:** Python / FastAPI, SQLAlchemy ORM, SQLite for dev (PostgreSQL for production)
- **Frontend:** React 18 + TypeScript, Vite bundler
- **Auth:** JWT tokens, bcrypt password hashing
- **Hosting:** Railway (production), local dev on Windows
- **No external CRM integrations yet** — data comes in via CSV/Excel imports

---

## Users & Roles

Four roles with hierarchical access:

| Role | Can See | Can Do |
|------|---------|--------|
| **Consultant** | Own outreach, all contacts, dashboard | Accept/reject proposals, draft & send emails, update own profile |
| **Team Manager** | Team's outreach + own | Above + manage team consultants, create templates |
| **BA Manager** | Business area's outreach + teams | Above + upload data, manage employees, generate proposals |
| **Admin** | Everything | Above + system settings, manage BAs/teams/sites, reset system |

All users share password format `Adv!Demo26` in demo. Force password change on first login supported.

---

## Organizational Structure

The company is organized as:

```
Business Area (e.g. Risk & Compliance, Finance & Treasury)
  └── Team (e.g. Risk Modelling SE, Finance Transformation)
       └── Employee/Consultant
            └── Site (Stockholm, Oslo, Copenhagen, Helsinki, Frankfurt, London)
```

Each site has configurable languages (sv, no, da, en, de, fi).
Each team can have a weekly outreach target. Each consultant has individual targets too.

---

## Core Features

### 1. Contact Management

Contacts are potential clients imported from CSV/Excel. Each contact has:
- Name, email, job title, company, sector, client tier (Tier1/2/3)
- Responsibility domain (what area they work in)
- Owner info (which consultant "owns" the relationship)
- Revenue data, days since last interaction
- Decision maker flag, opt-out flags (one-on-one, marketing)
- Expert areas and relevance tags (JSON arrays)
- Status: Active, Inactive/Missing, Suppressed

**Contact list page** should have:
- Full-text search across name, email, company, title
- Multi-select filters for: sector, tier, domain, BA, team, country, status, decision maker
- Sortable columns, server-side pagination
- Pin contacts to a consultant for focus
- Quick-create contacts from the UI
- Click into detail view showing full history (outreach, meetings, campaigns, gaps)
- Export for bulk editing

### 2. Outreach — The Main Workflow

This is the heart of the system. The outreach lifecycle:

```
[System generates proposal] → PROPOSED → ACCEPTED → DRAFT → PREPARED → SENT → REPLIED → MEETING_BOOKED → CLOSED
                                  ↓
                              NEGATED (rejected — wrong person, timing, duplicate, etc.)
                                  ↓ (optionally)
                              REDIRECTED → new outreach record for another consultant
```

**Generate Proposals (admin/BA manager action):**
- The system runs a recommendation engine that matches consultants to contacts
- Considers: domain expertise overlap, seniority alignment, meeting history, relevance tags,
  hot topics, coverage gaps, classification data
- Respects cooldown periods (default 90 days since last outreach to same contact)
- Per-consultant cap to avoid overloading anyone
- Creates PROPOSED outreach records

**Consultant workflow:**
- See proposed outreach in their list
- Accept → enters draft mode
- Draft an email (can auto-generate from template + hot topics + contact context)
- Set proposed meeting time slots (2 slots)
- Send (or mark as sent externally)
- Track outcome: replied, meeting booked, no response, bounced, not relevant
- Can negate (reject) with reason — system can redirect to better-fit consultant

**Outreach list page** should have:
- Multi-select filters: status, consultant, company, BA, team, outcome
- Search across contact name, title, company, consultant name
- Sortable columns (score, status, sent date, updated)
- Pagination (50/100/200 per page)
- Active filter chips showing what's selected

### 3. Recommendation Engine

The matching algorithm should:
1. Pre-load all employees, contacts, meetings, classifications in bulk (avoid N+1 queries)
2. Build inverted indices for fast lookup (employee → candidate contacts)
3. Score each consultant-contact pair on weighted factors:
   - **Domain match** (~20%) — contact's domain vs consultant's BA hot topics
   - **Domain expertise** (~18%) — consultant's expertise tags vs contact's expert areas
   - **Seniority alignment** (~16%) — consultant level vs contact job title level
   - **Relevance tags** (~15%) — tag overlap between consultant and contact
   - **Meeting history** (~12%) — has consultant met this contact/company before?
   - **Classification** (~9%) — pre-computed job title × company → BA/team distributions
   - **Coverage gaps** (~10%) — boost contacts that fill identified portfolio gaps
4. Return best consultant per contact with score + reasoning text
5. All weights should be configurable via admin settings

### 4. Contact Priority Scoring

Separate from recommendation — this scores contacts themselves (0-1) for prioritization:
- Tier weight (30%): Tier1=1.0, Tier2=0.7, Tier3=0.3
- Revenue (15%): has historical revenue = 1.0
- Days since interaction (25%): sweet spot 90-180 days, penalize too recent or too stale
- Domain match (20%): domain in current hot topics
- Seniority (10%): C-level highest
- Gap fill (10%): fills critical gap = 1.0, potential = 0.5

### 5. Campaign Management

For mass outreach (marketing emails, event invitations):

**Campaign builder:**
- Create campaign with subject, body, language
- Add recipients via filter groups (AND/OR logic across sectors, tiers, domains, etc.)
  or individually by searching contacts
- Preview recipient list before adding
- Optionally assign consultants to specific recipients for personalized follow-up
- Upload attachments
- BCC mode (anonymized bulk) vs personalized
- Send campaign → marks all recipients as SENT

**Consultant assignments within campaigns:**
- Consultant gets notification of assignment
- Can accept and customize their email per recipient
- "My Assignments" page shows all pending assignments with unread badge in sidebar

**Coverage Gap Analysis (per campaign):**
- Analyze recipient list against CoverageGap data
- Show company-level gaps: which companies are missing critical roles
- Aggregated insights: most common missing domains/titles across recipients
- Bar charts with hover showing affected company names
- Export gap analysis as CSV

### 6. Email Templates

- Templates scoped by BA and responsibility domain
- Multi-language support (sv, no, da, en, de, fi)
- Personal templates per consultant
- File attachments per template
- Versioning
- Used when generating draft emails for outreach

### 7. Hot Topics

- Important business themes configured per BA + responsibility domain
- Used by the recommendation engine (domain match scoring)
- Used by email generation (inject relevant talking points)
- Admin/BA manager can create, edit, publish

### 8. Data Import

The system gets its data from CSV/Excel imports, not direct CRM sync.

**Import types:**
- **Contacts** — new contacts or update existing (match by email + company)
- **Meetings** — historical interaction records (match to contacts by employee name)
- **Consultants** — bulk employee updates

**Import features:**
- Flexible column mapping (admin configures which CSV column maps to which field)
- Auto-detect delimiter (pipe or semicolon)
- UTF-8 and Windows-1252 encoding support
- Domain enrichment: job title → responsibility domain (via lookup table)
- Classification enrichment: company + title → BA/team distributions
- Preview diff before committing (added, updated, unchanged counts)
- Batch tracking with rollback capability
- Import history page

### 9. Dashboard

**Analytics tab:**
- KPI cards: total contacts, interacted contacts, outreach total, sent count, meetings booked,
  campaigns sent, coverage gaps
- Time period selector (week, 2 weeks, month, quarter, year, all time)
- Filters: domain, country, tier, sector, BA, team, consultant, decision maker flag
- Charts (Recharts): outreach by status, by BA, by team, by time

**Team Performance tab:**
- Consultant leaderboard (outreach sent, meetings booked, reply rate)
- Per-consultant summary cards

**Detail tab:**
- Drill-down data tables

### 10. Employee Management (Consultants Page)

- List all employees with filters: seniority, BA, team, site
- Multi-level sorting (click multiple columns, priority numbered)
- Consultant search with autocomplete dropdown
- Inline editing of individual consultant fields
- Bulk operations: deactivate, batch update from CSV
- Set outreach targets (per week/month) via modal
- Role management (admin only)
- Approval workflow: pending → approved / rejected
- Reset password
- Active filter bar showing current selections

### 11. Profile Page

Each user can edit their own profile:
- Name, email, seniority
- Primary language
- Domain expertise tags (from curated list)
- Relevance tags
- Profile description

### 12. Admin / Settings

- Manage business areas, teams, sites
- Configure site languages
- System configuration (scoring weights, cooldown days, work hours, etc.)
- Column mapping for imports
- FX rates (for multi-currency revenue display)
- Audit log viewer
- System reset with backup

### 13. Notifications

- In-app notifications for consultants (campaign assignments, outreach proposals, etc.)
- Unread badge in sidebar ("My Assignments 5")
- Mark as read
- Link to relevant page

---

## Data Model Highlights

Key relationships:
- Employee belongs to Team, Team belongs to BusinessArea
- Employee has a Site, Site has SiteLanguages
- OutreachRecord links Employee ↔ Contact (many outreach per contact over time)
- OutreachRecord can be negated → Negation record, optionally redirected to new OutreachRecord
- Campaign has many CampaignRecipients, each links to a Contact and optionally an Employee
- CoverageGap tracks company-level portfolio gaps (missing domains/titles)
- Meeting links Contact ↔ Employee with historical interaction data
- SuppressionEntry marks contacts as do-not-contact
- AuditLog tracks all changes with entity type, old/new values

Key stored-as-JSON fields:
- domain_expertise_tags, relevance_tags, expert_areas (on Employee/Contact)
- missing_domains, missing_titles (on CoverageGap — critical vs potential)
- selected_attachment_ids (on OutreachRecord)

---

## UI / Design

- Clean, professional look — not flashy
- Brand colors: dark charcoal (#2e2e2e) sidebar, teal accent (#69D4AE) for buttons/active states
- Warm stone background (#f4f3f1), white cards
- Fixed sidebar navigation (220px) with Lucide icons
- Tables are the primary data display — sortable, paginated, with inline actions
- Multi-select filter dropdowns rendered via portal (position: fixed) to avoid scroll jumps
- Active filter chips bar below toolbar
- Recharts for dashboard charts
- Responsive but primarily desktop-focused (consultants use laptops)

---

## Deployment Notes

- Backend port 8001 locally (8000 taken by printer software)
- Frontend port 5173 via Vite with proxy to backend
- Node.js is portable (not system-installed) at AppData\Local\node-portable
- Python 3.13 — note: passlib[bcrypt] is incompatible, use bcrypt directly
- SQLite for dev, PostgreSQL for Railway production
- No admin rights on dev machine — use portable/zip packages
- JWT sub claim must be string, decode with int()
- CORS configured for localhost + Railway domain

---

## Seed Data

Demo setup should create:
- 4-5 business areas (Risk, Finance, Technology, Advisory, etc.)
- 6 sites (Stockholm, Oslo, Copenhagen, Helsinki, Frankfurt, London)
- 5-6 teams across BAs
- 4-6 named employees across roles (admin, team manager, BA manager, consultants)
- Email templates per language
- Hot topics per BA
- System config defaults (scoring weights, cooldown period)
- All demo users share same password

The real data (15K+ contacts, 400+ consultants, meetings history) comes from CSV imports.

---

## Things That Are Important But Easy to Miss

1. **Cooldown logic** — Don't propose a contact if they were outreached within X days (default 90)
2. **Negate + Redirect** — When a consultant rejects, the system can auto-create a new outreach
   record assigned to a different consultant, carrying the reason/notes
3. **Role-based visibility** — Consultants only see their own outreach, team managers see their
   team, BA managers see their BA, admins see all
4. **Suppression list** — Contacts can be marked do-not-contact at any time
5. **Batch rollback** — Every import gets a batch ID; you can undo an entire import
6. **Campaign filter groups** — Recipients can be selected using AND/OR filter logic
   (e.g., "Tier 1 AND Risk domain" OR "Tier 2 AND Finance domain")
7. **Coverage gap analysis** — Uses imported "Most Peers Have" data to identify which roles
   are missing at companies, split into critical (most peers have) and potential (some peers have)
8. **Classification lookups** — Pre-computed from import data: given a job title at a company in
   a tier/industry, which BA and team typically handles it? Used for recommendation scoring.
9. **FX rates** — Revenue stored in original currency, admin sets conversion rates for display
10. **Must-change-password** — New employees forced to change on first login
11. **Column mapping** — Admin configures which CSV column header maps to which logical field,
    so imports work even when the source system changes column names
12. **Outreach email generation** — Can auto-generate email from template + hot topics + contact
    context (language-aware)
