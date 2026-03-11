"""Campaign Outreach – bulk / newsletter sends that do NOT affect individual cooldown."""

import json
import os
import uuid
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from app.core.filter_utils import apply_multi_filter, apply_multi_ilike

from app.core.database import get_db
from app.core.auth import get_current_user
from app.models.models import (
    Campaign, CampaignRecipient, CampaignAttachment,
    CampaignStatusEnum, CampaignRecipientStatusEnum,
    Contact, Employee, RoleEnum, ContactStatusEnum, SuppressionEntry,
    AuditLog, LanguageEnum, Notification, CampaignAnalysis,
    CoverageGap,
)
from app.schemas.schemas import (
    CampaignCreate, CampaignUpdate, CampaignOut, CampaignDetailOut,
    CampaignRecipientOut, CampaignAddRecipientsRequest,
    CampaignRemoveRecipientsRequest, CampaignAttachmentOut,
    AssignConsultantRequest, CustomizeAssignmentRequest,
    CampaignAssignmentOut, FilterGroupSchema, FilterGroupsPreviewRequest,
    FilterGroupsAddRequest,
)

# ── Attachment config ─────────────────────────────────────────────────
ALLOWED_CAMPAIGN_ATTACHMENT_TYPES = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/vnd.ms-powerpoint": ".ppt",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.ms-excel": ".xls",
    "image/png": ".png",
    "image/jpeg": ".jpg",
}
MAX_CAMPAIGN_ATTACHMENT_SIZE = 25 * 1024 * 1024  # 25 MB

CAMPAIGN_UPLOAD_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "uploads", "campaign-attachments")
)

router = APIRouter()


# ── helpers ──────────────────────────────────────────────────────────

def _check_campaign_access(user: Employee):
    """Admin and BA-manager always have access; others need can_campaign flag."""
    if user.role in (RoleEnum.ADMIN, RoleEnum.BA_MANAGER):
        return
    if getattr(user, "can_campaign", False):
        return
    raise HTTPException(status_code=403, detail="Campaign access not granted")


def _campaign_to_out(c: Campaign) -> CampaignOut:
    return CampaignOut(
        id=c.id,
        name=c.name,
        description=c.description,
        email_subject=c.email_subject,
        email_body=c.email_body,
        email_language=c.email_language,
        template_id=c.template_id,
        bcc_mode=c.bcc_mode,
        status=c.status.value if hasattr(c.status, "value") else c.status,
        created_by_id=c.created_by_id,
        created_by_name=c.created_by.name if c.created_by else None,
        recipient_count=len(c.recipients) if c.recipients else 0,
        sent_count=sum(1 for r in (c.recipients or [])
                       if (r.status.value if hasattr(r.status, "value") else r.status) == "sent"),
        attachment_count=len([a for a in (c.attachments or []) if a.is_active]),
        scheduled_at=c.scheduled_at,
        sent_at=c.sent_at,
        created_at=c.created_at,
        updated_at=c.updated_at,
    )


def _recipient_to_out(r: CampaignRecipient) -> CampaignRecipientOut:
    contact = r.contact
    consultant = getattr(r, "assigned_consultant", None)
    return CampaignRecipientOut(
        id=r.id,
        campaign_id=r.campaign_id,
        contact_id=r.contact_id,
        status=r.status.value if hasattr(r.status, "value") else r.status,
        sent_at=r.sent_at,
        error_message=r.error_message,
        created_at=r.created_at,
        contact_name=contact.full_name if contact else None,
        contact_email=contact.email if contact else None,
        contact_company=contact.company_name if contact else None,
        contact_job_title=contact.job_title if contact else None,
        contact_domain=contact.responsibility_domain if contact else None,
        contact_domicile=contact.group_domicile if contact else None,
        contact_tier=contact.client_tier if contact else None,
        contact_expert_areas=contact.expert_areas if contact else None,
        contact_relevance_tags=contact.relevance_tags if contact else None,
        contact_is_decision_maker=contact.is_decision_maker if contact else False,
        contact_relevant_search=contact.relevant_search if contact else None,
        added_via=r.added_via,
        assigned_consultant_id=getattr(r, "assigned_consultant_id", None),
        assigned_consultant_name=consultant.name if consultant else None,
        consultant_status=getattr(r, "consultant_status", None),
        custom_email_subject=getattr(r, "custom_email_subject", None),
        custom_email_body=getattr(r, "custom_email_body", None),
        consultant_accepted_at=getattr(r, "consultant_accepted_at", None),
    )


def _build_filtered_contacts_query(db: Session, filters, campaign_id: int):
    """Build a query for contacts matching campaign filters.
    Accepts CampaignAddRecipientsRequest or FilterGroupSchema (same field names)."""
    query = db.query(Contact).filter(Contact.status == ContactStatusEnum.ACTIVE)

    if filters.filter_search:
        like = f"%{filters.filter_search}%"
        query = query.filter(or_(
            Contact.full_name.ilike(like),
            Contact.email.ilike(like),
            Contact.company_name.ilike(like),
        ))
    query = apply_multi_filter(query, Contact.client_tier, filters.filter_client_tier)
    query = apply_multi_filter(query, Contact.sector, filters.filter_sector)
    query = apply_multi_filter(query, Contact.responsibility_domain, filters.filter_responsibility_domain)
    query = apply_multi_filter(query, Contact.group_domicile, filters.filter_group_domicile)
    query = apply_multi_filter(query, Contact.owner_business_area, filters.filter_owner_business_area)
    query = apply_multi_filter(query, Contact.owner_team, filters.filter_owner_team)
    query = apply_multi_ilike(query, Contact.relevance_tags, filters.filter_relevance_tag)
    if filters.filter_is_decision_maker is not None:
        query = query.filter(Contact.is_decision_maker == filters.filter_is_decision_maker)

    # Exclude contacts already in this campaign
    existing_ids = db.query(CampaignRecipient.contact_id).filter(
        CampaignRecipient.campaign_id == campaign_id
    ).scalar_subquery()
    query = query.filter(~Contact.id.in_(existing_ids))

    # Exclude suppressed contacts
    suppressed_ids = db.query(SuppressionEntry.contact_id).filter(
        SuppressionEntry.is_active == True  # noqa: E712
    ).scalar_subquery()
    query = query.filter(~Contact.id.in_(suppressed_ids))

    # Exclude contacts who opted out of marketing info
    query = query.filter(or_(Contact.opt_out_marketing_info == False, Contact.opt_out_marketing_info.is_(None)))

    # Require email
    query = query.filter(Contact.email.isnot(None), Contact.email != "")

    return query


# ── endpoints ────────────────────────────────────────────────────────

@router.get("/", response_model=List[CampaignOut])
def list_campaigns(
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    _check_campaign_access(current_user)

    query = db.query(Campaign)
    if status:
        query = query.filter(Campaign.status == status)
    query = query.order_by(Campaign.updated_at.desc())
    campaigns = query.all()
    return [_campaign_to_out(c) for c in campaigns]


@router.post("/", response_model=CampaignOut)
def create_campaign(
    payload: CampaignCreate,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    _check_campaign_access(current_user)

    campaign = Campaign(
        name=payload.name,
        description=payload.description,
        email_subject=payload.email_subject,
        email_body=payload.email_body,
        email_language=payload.email_language,
        template_id=payload.template_id,
        bcc_mode=payload.bcc_mode,
        status=CampaignStatusEnum.DRAFT,
        created_by_id=current_user.id,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(campaign)
    db.commit()
    db.refresh(campaign)

    db.add(AuditLog(
        employee_id=current_user.id, action="create_campaign",
        entity_type="campaign", entity_id=campaign.id,
        new_value=campaign.name, timestamp=datetime.now(timezone.utc),
    ))
    db.commit()

    return _campaign_to_out(campaign)


# ── Consultant Actions (must come before /{campaign_id} routes) ───────

@router.get("/my-assignments", response_model=List[CampaignAssignmentOut])
def get_my_assignments(
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    """List all campaign recipients assigned to the current user.

    Only returns assignments from campaigns that have been finalized (READY)
    or already sent (SENT). Draft and cancelled campaigns are excluded so
    consultants don't see work-in-progress assignments.
    """
    recipients = (
        db.query(CampaignRecipient)
        .join(Campaign, CampaignRecipient.campaign_id == Campaign.id)
        .filter(
            CampaignRecipient.assigned_consultant_id == current_user.id,
            Campaign.status.in_([CampaignStatusEnum.READY, CampaignStatusEnum.SENT]),
        )
        .all()
    )

    results = []
    for r in recipients:
        campaign = r.campaign
        contact = r.contact
        if not campaign:
            continue
        # Campaign-level context for consultant summary
        lang = campaign.email_language
        lang_val = lang.value if hasattr(lang, "value") else lang if lang else None
        creator = campaign.created_by
        attachment_names = [
            a.display_name or a.original_filename
            for a in (campaign.attachments or [])
            if a.is_active
        ]

        results.append(CampaignAssignmentOut(
            recipient_id=r.id,
            campaign_id=campaign.id,
            campaign_name=campaign.name,
            campaign_description=campaign.description,
            contact_id=r.contact_id,
            contact_name=contact.full_name if contact else None,
            contact_email=contact.email if contact else None,
            contact_company=contact.company_name if contact else None,
            contact_job_title=contact.job_title if contact else None,
            default_email_subject=campaign.email_subject,
            default_email_body=campaign.email_body,
            custom_email_subject=r.custom_email_subject,
            custom_email_body=r.custom_email_body,
            consultant_status=r.consultant_status,
            consultant_accepted_at=r.consultant_accepted_at,
            campaign_status=campaign.status.value if hasattr(campaign.status, "value") else campaign.status,
            campaign_language=lang_val,
            campaign_created_by=creator.name if creator else None,
            campaign_total_recipients=len(campaign.recipients) if campaign.recipients else 0,
            campaign_attachment_names=attachment_names if attachment_names else None,
            campaign_created_at=campaign.created_at,
        ))
    return results


@router.post("/assignments/{recipient_id}/accept")
def accept_assignment(
    recipient_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    recipient = db.query(CampaignRecipient).filter(
        CampaignRecipient.id == recipient_id,
    ).first()
    if not recipient:
        raise HTTPException(404, "Assignment not found")
    if recipient.assigned_consultant_id != current_user.id:
        raise HTTPException(403, "Not your assignment")

    now = datetime.now(timezone.utc)
    recipient.consultant_status = "accepted"
    recipient.consultant_accepted_at = now

    # Mark related notification as read
    db.query(Notification).filter(
        Notification.reference_type == "campaign_recipient",
        Notification.reference_id == recipient.id,
        Notification.employee_id == current_user.id,
    ).update({"is_read": True})

    db.add(AuditLog(
        employee_id=current_user.id, action="accept_campaign_assignment",
        entity_type="campaign_recipient", entity_id=recipient.id,
        new_value="Consultant accepted campaign assignment",
        timestamp=now,
    ))

    db.commit()
    db.refresh(recipient)

    # Build mailto data for convenience
    contact = recipient.contact
    campaign = recipient.campaign
    subject = recipient.custom_email_subject or (campaign.email_subject if campaign else "")
    body = recipient.custom_email_body or (campaign.email_body if campaign else "")

    return {
        "status": "accepted",
        "consultant_accepted_at": now.isoformat(),
        "mailto_to": contact.email if contact else "",
        "mailto_subject": subject,
        "mailto_body": body,
    }


@router.put("/assignments/{recipient_id}/customize")
def customize_assignment(
    recipient_id: int,
    payload: CustomizeAssignmentRequest,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    recipient = db.query(CampaignRecipient).filter(
        CampaignRecipient.id == recipient_id,
    ).first()
    if not recipient:
        raise HTTPException(404, "Assignment not found")
    if recipient.assigned_consultant_id != current_user.id:
        raise HTTPException(403, "Not your assignment")

    if payload.email_subject is not None:
        recipient.custom_email_subject = payload.email_subject
    if payload.email_body is not None:
        recipient.custom_email_body = payload.email_body

    db.commit()
    db.refresh(recipient)

    campaign = recipient.campaign
    contact = recipient.contact
    return CampaignAssignmentOut(
        recipient_id=recipient.id,
        campaign_id=campaign.id if campaign else 0,
        campaign_name=campaign.name if campaign else "",
        campaign_description=campaign.description if campaign else None,
        contact_id=recipient.contact_id,
        contact_name=contact.full_name if contact else None,
        contact_email=contact.email if contact else None,
        contact_company=contact.company_name if contact else None,
        contact_job_title=contact.job_title if contact else None,
        default_email_subject=campaign.email_subject if campaign else "",
        default_email_body=campaign.email_body if campaign else "",
        custom_email_subject=recipient.custom_email_subject,
        custom_email_body=recipient.custom_email_body,
        consultant_status=recipient.consultant_status,
        consultant_accepted_at=recipient.consultant_accepted_at,
        campaign_status=campaign.status.value if campaign and hasattr(campaign.status, "value") else (campaign.status if campaign else ""),
    )


# ── Campaign detail & management ─────────────────────────────────────

@router.get("/{campaign_id}", response_model=CampaignDetailOut)
def get_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    _check_campaign_access(current_user)

    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    out = _campaign_to_out(campaign)
    return CampaignDetailOut(
        **out.model_dump(),
        recipients=[_recipient_to_out(r) for r in campaign.recipients],
        attachments=[
            CampaignAttachmentOut.model_validate(a)
            for a in (campaign.attachments or []) if a.is_active
        ],
    )




@router.get("/{campaign_id}/gap-hints")
def get_campaign_gap_hints(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    """Return coverage gap hints for the campaign's recipient companies.

    Cross-references recipient companies against CoverageGap data to
    identify missing contacts that could improve the campaign's reach.
    """
    _check_campaign_access(current_user)

    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    # Collect unique company names from recipients
    recipient_companies: dict[str, list] = {}  # normalized -> [recipient info]
    for r in campaign.recipients:
        if r.contact and r.contact.company_name:
            norm = r.contact.company_name.lower().strip()
            if norm not in recipient_companies:
                recipient_companies[norm] = []
            recipient_companies[norm].append({
                "contact_name": r.contact.full_name or "",
                "domain": r.contact.responsibility_domain or "",
            })

    if not recipient_companies:
        return {"hints": [], "summary": {"companies_checked": 0, "companies_with_gaps": 0, "total_critical": 0, "total_potential": 0}}

    # Look up gaps for these companies
    gaps = db.query(CoverageGap).filter(
        CoverageGap.company_name_normalized.in_(list(recipient_companies.keys()))
    ).all()

    hints = []
    total_critical = 0
    total_potential = 0

    for gap in gaps:
        import json as _json
        norm = gap.company_name_normalized

        # Parse missing data
        try:
            crit_domains = _json.loads(gap.missing_domains_critical) if gap.missing_domains_critical else []
        except (ValueError, TypeError):
            crit_domains = []
        try:
            crit_titles = _json.loads(gap.missing_titles_critical) if gap.missing_titles_critical else []
        except (ValueError, TypeError):
            crit_titles = []
        try:
            pot_domains = _json.loads(gap.missing_domains_potential) if gap.missing_domains_potential else []
        except (ValueError, TypeError):
            pot_domains = []
        try:
            pot_titles = _json.loads(gap.missing_titles_potential) if gap.missing_titles_potential else []
        except (ValueError, TypeError):
            pot_titles = []

        # Check which domains are already covered by recipients
        covered_domains = {r["domain"].lower() for r in recipient_companies.get(norm, []) if r["domain"]}

        # Filter out already-covered domains
        uncovered_crit = [d for d in crit_domains if not any(d.lower() in cd or cd in d.lower() for cd in covered_domains)]
        uncovered_pot = [d for d in pot_domains if not any(d.lower() in cd or cd in d.lower() for cd in covered_domains)]

        if gap.critical_gap_count > 0 or gap.potential_gap_count > 0:
            total_critical += gap.critical_gap_count
            total_potential += gap.potential_gap_count
            hints.append({
                "company_name": gap.company_name,
                "critical_gap_count": gap.critical_gap_count,
                "potential_gap_count": gap.potential_gap_count,
                "missing_domains_critical": uncovered_crit,
                "missing_titles_critical": crit_titles,
                "missing_domains_potential": uncovered_pot,
                "missing_titles_potential": pot_titles,
                "contacts_in_campaign": len(recipient_companies.get(norm, [])),
            })

    # Sort by critical count descending
    hints.sort(key=lambda h: h["critical_gap_count"], reverse=True)

    # Build aggregated insights across all hints, tracking company names per item
    from collections import defaultdict
    agg_crit_domains: dict[str, list[str]] = defaultdict(list)
    agg_crit_titles: dict[str, list[str]] = defaultdict(list)
    agg_pot_domains: dict[str, list[str]] = defaultdict(list)
    agg_pot_titles: dict[str, list[str]] = defaultdict(list)
    agg_industries: dict[str, list[str]] = defaultdict(list)
    for h in hints:
        for d in h["missing_domains_critical"]:
            agg_crit_domains[d].append(h["company_name"])
        for t in h["missing_titles_critical"]:
            agg_crit_titles[t].append(h["company_name"])
        for d in h["missing_domains_potential"]:
            agg_pot_domains[d].append(h["company_name"])
        for t in h["missing_titles_potential"]:
            agg_pot_titles[t].append(h["company_name"])
    # Industry breakdown from gaps (not just hints)
    for gap in gaps:
        if gap.industry:
            agg_industries[gap.industry].append(gap.company_name)

    def _top_items(d: dict[str, list[str]], n: int = 8):
        sorted_items = sorted(d.items(), key=lambda x: len(x[1]), reverse=True)[:n]
        return [{"name": k, "count": len(v), "companies": v} for k, v in sorted_items]

    return {
        "hints": hints[:20],  # Top 20
        "summary": {
            "companies_checked": len(recipient_companies),
            "companies_with_gaps": len(hints),
            "total_critical": total_critical,
            "total_potential": total_potential,
        },
        "aggregated": {
            "top_critical_domains": _top_items(agg_crit_domains),
            "top_critical_titles": _top_items(agg_crit_titles),
            "top_potential_domains": _top_items(agg_pot_domains),
            "top_potential_titles": _top_items(agg_pot_titles),
            "industries": _top_items(agg_industries, 10),
        },
    }


@router.get("/{campaign_id}/gap-hints/export")
def export_campaign_gap_hints(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    """Export coverage gap analysis for a campaign as CSV."""
    import csv
    import io
    import json as _json

    _check_campaign_access(current_user)

    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    # Collect recipient companies
    recipient_companies: dict[str, list] = {}
    for r in campaign.recipients:
        if r.contact and r.contact.company_name:
            norm = r.contact.company_name.lower().strip()
            if norm not in recipient_companies:
                recipient_companies[norm] = []
            recipient_companies[norm].append({
                "contact_name": r.contact.full_name or "",
                "domain": r.contact.responsibility_domain or "",
            })

    # Look up gaps
    gaps = db.query(CoverageGap).filter(
        CoverageGap.company_name_normalized.in_(list(recipient_companies.keys()))
    ).all()

    def _parse_json(val):
        if not val:
            return []
        try:
            return _json.loads(val)
        except (ValueError, TypeError):
            return []

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Company", "Industry", "Tier", "Contacts in Campaign",
        "Critical Gaps", "Potential Gaps", "Total Gaps",
        "Missing Domains (Most Peers Have)", "Missing Titles (Most Peers Have)",
        "Missing Domains (Some Peers Have)", "Missing Titles (Some Peers Have)",
    ])

    for gap in sorted(gaps, key=lambda g: g.critical_gap_count or 0, reverse=True):
        norm = gap.company_name_normalized
        covered_domains = {r["domain"].lower() for r in recipient_companies.get(norm, []) if r["domain"]}
        crit_domains = [d for d in _parse_json(gap.missing_domains_critical)
                        if not any(d.lower() in cd or cd in d.lower() for cd in covered_domains)]
        pot_domains = [d for d in _parse_json(gap.missing_domains_potential)
                       if not any(d.lower() in cd or cd in d.lower() for cd in covered_domains)]

        writer.writerow([
            gap.company_name,
            gap.industry or "",
            gap.tier or "",
            len(recipient_companies.get(norm, [])),
            gap.critical_gap_count or 0,
            gap.potential_gap_count or 0,
            gap.total_gap_count or 0,
            "; ".join(crit_domains),
            "; ".join(_parse_json(gap.missing_titles_critical)),
            "; ".join(pot_domains),
            "; ".join(_parse_json(gap.missing_titles_potential)),
        ])

    output.seek(0)
    safe_name = campaign.name.replace(" ", "_").replace("/", "-")[:40]
    filename = f"gap_analysis_{safe_name}.csv"

    return StreamingResponse(
        output,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.put("/{campaign_id}", response_model=CampaignOut)
def update_campaign(
    campaign_id: int,
    payload: CampaignUpdate,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    _check_campaign_access(current_user)

    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    status_val = campaign.status.value if hasattr(campaign.status, "value") else campaign.status
    if status_val not in ("draft",):
        raise HTTPException(400, "Can only edit campaigns in draft status")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(campaign, field, value)
    campaign.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(campaign)
    return _campaign_to_out(campaign)


@router.post("/{campaign_id}/recipients")
def add_recipients(
    campaign_id: int,
    payload: CampaignAddRecipientsRequest,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    _check_campaign_access(current_user)

    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    status_val = campaign.status.value if hasattr(campaign.status, "value") else campaign.status
    if status_val not in ("draft", "ready"):
        raise HTTPException(400, "Can only add recipients to draft or ready campaigns")

    added = 0

    # Individual contact IDs
    if payload.contact_ids:
        existing = set(
            r[0] for r in db.query(CampaignRecipient.contact_id)
            .filter(CampaignRecipient.campaign_id == campaign_id).all()
        )
        for cid in payload.contact_ids:
            if cid in existing:
                continue
            contact = db.query(Contact).filter(
                Contact.id == cid,
                Contact.status == ContactStatusEnum.ACTIVE,
                Contact.email.isnot(None), Contact.email != "",
            ).first()
            if contact:
                db.add(CampaignRecipient(
                    campaign_id=campaign_id, contact_id=cid,
                    status=CampaignRecipientStatusEnum.PENDING,
                    added_via="individual",
                    created_at=datetime.now(timezone.utc),
                ))
                existing.add(cid)
                added += 1

    # Grouped filter-based add (new)
    if payload.groups and len(payload.groups) > 0:
        combine = payload.combine or "or"
        all_ids: set[int] = set() if combine == "or" else None
        intersected_ids: set[int] | None = None

        for group in payload.groups:
            query = _build_filtered_contacts_query(db, group, campaign_id)
            ids = set(c.id for c in query.with_entities(Contact.id).all())
            if combine == "or":
                all_ids.update(ids)
            else:
                if intersected_ids is None:
                    intersected_ids = ids
                else:
                    intersected_ids &= ids

        final_ids = all_ids if combine == "or" else (intersected_ids or set())
        # Remove already-existing (in case individual adds happened above)
        existing_now = set(
            r[0] for r in db.query(CampaignRecipient.contact_id)
            .filter(CampaignRecipient.campaign_id == campaign_id).all()
        )
        for cid in final_ids - existing_now:
            db.add(CampaignRecipient(
                campaign_id=campaign_id, contact_id=cid,
                status=CampaignRecipientStatusEnum.PENDING,
                added_via="filter",
                created_at=datetime.now(timezone.utc),
            ))
            added += 1

    # Legacy flat filter-based bulk add (backward compatible)
    elif not payload.groups:
        has_filters = any([
            payload.filter_client_tier, payload.filter_sector,
            payload.filter_responsibility_domain, payload.filter_group_domicile,
            payload.filter_owner_business_area, payload.filter_owner_team,
            payload.filter_search, payload.filter_expert_area,
            payload.filter_relevance_tag,
            payload.filter_is_decision_maker is not None,
        ])
        if has_filters:
            contacts = _build_filtered_contacts_query(db, payload, campaign_id).all()
            for contact in contacts:
                db.add(CampaignRecipient(
                    campaign_id=campaign_id, contact_id=contact.id,
                    status=CampaignRecipientStatusEnum.PENDING,
                    added_via="filter",
                    created_at=datetime.now(timezone.utc),
                ))
                added += 1

    campaign.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(campaign)
    return {"added": added, "total": len(campaign.recipients)}


@router.delete("/{campaign_id}/recipients")
def remove_recipients(
    campaign_id: int,
    payload: CampaignRemoveRecipientsRequest,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    _check_campaign_access(current_user)

    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    status_val = campaign.status.value if hasattr(campaign.status, "value") else campaign.status
    if status_val not in ("draft", "ready"):
        raise HTTPException(400, "Can only remove recipients from draft or ready campaigns")

    removed = db.query(CampaignRecipient).filter(
        CampaignRecipient.campaign_id == campaign_id,
        CampaignRecipient.contact_id.in_(payload.contact_ids),
    ).delete(synchronize_session=False)

    campaign.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"removed": removed}


@router.delete("/{campaign_id}/recipients/all")
def clear_all_recipients(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    _check_campaign_access(current_user)

    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    status_val = campaign.status.value if hasattr(campaign.status, "value") else campaign.status
    if status_val not in ("draft", "ready"):
        raise HTTPException(400, "Can only clear recipients from draft or ready campaigns")

    removed = db.query(CampaignRecipient).filter(
        CampaignRecipient.campaign_id == campaign_id,
    ).delete(synchronize_session=False)

    campaign.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"removed": removed}


@router.get("/{campaign_id}/preview-recipients")
def preview_recipients(
    campaign_id: int,
    filter_client_tier: Optional[str] = Query(None),
    filter_sector: Optional[str] = Query(None),
    filter_responsibility_domain: Optional[str] = Query(None),
    filter_group_domicile: Optional[str] = Query(None),
    filter_owner_business_area: Optional[str] = Query(None),
    filter_owner_team: Optional[str] = Query(None),
    filter_search: Optional[str] = Query(None),
    filter_expert_area: Optional[str] = Query(None),
    filter_relevance_tag: Optional[str] = Query(None),
    filter_is_decision_maker: Optional[bool] = Query(None),
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    _check_campaign_access(current_user)

    filters = CampaignAddRecipientsRequest(
        filter_client_tier=filter_client_tier,
        filter_sector=filter_sector,
        filter_responsibility_domain=filter_responsibility_domain,
        filter_group_domicile=filter_group_domicile,
        filter_owner_business_area=filter_owner_business_area,
        filter_owner_team=filter_owner_team,
        filter_search=filter_search,
        filter_expert_area=filter_expert_area,
        filter_relevance_tag=filter_relevance_tag,
        filter_is_decision_maker=filter_is_decision_maker,
    )
    query = _build_filtered_contacts_query(db, filters, campaign_id)
    count = query.count()
    contacts = query.limit(200).all()
    return {
        "count": count,
        "contacts": [
            {
                "id": c.id,
                "full_name": c.full_name,
                "email": c.email,
                "company_name": c.company_name,
                "job_title": c.job_title,
                "responsibility_domain": c.responsibility_domain,
                "client_tier": c.client_tier,
                "group_domicile": c.group_domicile,
                "expert_areas": c.expert_areas,
                "is_decision_maker": c.is_decision_maker,
                "relevance_tags": c.relevance_tags,
            }
            for c in contacts
        ],
    }


@router.post("/{campaign_id}/preview-recipients-grouped")
def preview_recipients_grouped(
    campaign_id: int,
    payload: FilterGroupsPreviewRequest,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    """Preview recipients using multiple filter groups combined with OR/AND."""
    _check_campaign_access(current_user)

    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    if len(payload.groups) > 5:
        raise HTTPException(400, "Maximum 5 filter groups allowed")

    group_counts = []
    all_ids: set[int] = set() if payload.combine == "or" else None
    intersected_ids: set[int] | None = None

    for group in payload.groups:
        query = _build_filtered_contacts_query(db, group, campaign_id)
        ids = set(c.id for c in query.with_entities(Contact.id).all())
        group_counts.append(len(ids))

        if payload.combine == "or":
            all_ids.update(ids)
        else:  # and
            if intersected_ids is None:
                intersected_ids = ids
            else:
                intersected_ids &= ids

    final_ids = all_ids if payload.combine == "or" else (intersected_ids or set())

    # Fetch sample contacts for preview
    contacts = []
    if final_ids:
        contacts = db.query(Contact).filter(Contact.id.in_(list(final_ids)[:200])).all()

    return {
        "total_count": len(final_ids),
        "group_counts": group_counts,
        "contacts": [
            {
                "id": c.id,
                "full_name": c.full_name,
                "email": c.email,
                "company_name": c.company_name,
                "job_title": c.job_title,
                "responsibility_domain": c.responsibility_domain,
                "client_tier": c.client_tier,
                "group_domicile": c.group_domicile,
                "expert_areas": c.expert_areas,
                "is_decision_maker": c.is_decision_maker,
                "relevance_tags": c.relevance_tags,
            }
            for c in contacts
        ],
    }


@router.post("/{campaign_id}/finalize", response_model=CampaignOut)
def finalize_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    _check_campaign_access(current_user)

    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    status_val = campaign.status.value if hasattr(campaign.status, "value") else campaign.status
    if status_val != "draft":
        raise HTTPException(400, "Campaign must be in draft status to finalize")

    if not campaign.email_subject or not campaign.email_body:
        raise HTTPException(400, "Email subject and body are required")

    if not campaign.recipients:
        raise HTTPException(400, "At least one recipient is required")

    campaign.status = CampaignStatusEnum.READY
    now = datetime.now(timezone.utc)
    campaign.updated_at = now

    # Create notifications for all assigned consultants (deferred from draft)
    for r in campaign.recipients:
        if r.assigned_consultant_id and r.consultant_status == "pending":
            contact = r.contact
            contact_name = contact.full_name if contact else "Unknown"
            db.add(Notification(
                employee_id=r.assigned_consultant_id,
                notification_type="campaign_assignment",
                title=f"Campaign assignment: {campaign.name}",
                message=f"You have been assigned to send the campaign email to {contact_name}.",
                link="/campaign-assignments",
                reference_type="campaign_recipient",
                reference_id=r.id,
                is_read=False,
                created_at=now,
            ))

    db.commit()
    db.refresh(campaign)
    return _campaign_to_out(campaign)


@router.post("/{campaign_id}/revert-to-draft", response_model=CampaignOut)
def revert_to_draft(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    _check_campaign_access(current_user)

    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    status_val = campaign.status.value if hasattr(campaign.status, "value") else campaign.status
    if status_val != "ready":
        raise HTTPException(400, "Only ready campaigns can be reverted to draft")

    campaign.status = CampaignStatusEnum.DRAFT
    campaign.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(campaign)
    return _campaign_to_out(campaign)


@router.post("/{campaign_id}/send", response_model=CampaignOut)
def send_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    _check_campaign_access(current_user)

    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    status_val = campaign.status.value if hasattr(campaign.status, "value") else campaign.status
    if status_val != "ready":
        raise HTTPException(400, "Campaign must be in ready status to send")

    now = datetime.now(timezone.utc)
    sent_count = 0
    pending_consultant = 0
    for r in campaign.recipients:
        # If assigned to a consultant who hasn't accepted yet, leave as pending
        if getattr(r, "assigned_consultant_id", None) and getattr(r, "consultant_status", None) != "accepted":
            pending_consultant += 1
            continue
        r.status = CampaignRecipientStatusEnum.SENT
        r.sent_at = now
        sent_count += 1

    campaign.status = CampaignStatusEnum.SENT
    campaign.sent_at = now
    campaign.updated_at = now

    details = f"Sent to {sent_count} recipients"
    if pending_consultant > 0:
        details += f"; {pending_consultant} pending consultant acceptance"

    db.add(AuditLog(
        employee_id=current_user.id, action="send_campaign",
        entity_type="campaign", entity_id=campaign.id,
        new_value=details,
        timestamp=now,
    ))
    db.commit()
    db.refresh(campaign)
    return _campaign_to_out(campaign)


@router.post("/{campaign_id}/cancel", response_model=CampaignOut)
def cancel_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    _check_campaign_access(current_user)

    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    status_val = campaign.status.value if hasattr(campaign.status, "value") else campaign.status
    if status_val in ("sent", "cancelled"):
        raise HTTPException(400, "Cannot cancel a sent or already cancelled campaign")

    campaign.status = CampaignStatusEnum.CANCELLED
    campaign.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(campaign)
    return _campaign_to_out(campaign)


@router.delete("/{campaign_id}")
def delete_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    _check_campaign_access(current_user)

    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    # Only admin, ba_manager, or creator can delete
    is_admin_or_ba = current_user.role in (RoleEnum.ADMIN, RoleEnum.BA_MANAGER)
    is_creator = current_user.id == campaign.created_by_id
    if not (is_admin_or_ba or is_creator):
        raise HTTPException(403, "Only the campaign creator or an admin can delete this campaign")

    status_val = campaign.status.value if hasattr(campaign.status, "value") else campaign.status
    if status_val in ("sent", "sending"):
        raise HTTPException(400, "Cannot delete a sent or sending campaign")

    campaign_name = campaign.name

    # Clean up related records
    recipient_ids = [
        r[0] for r in db.query(CampaignRecipient.id)
        .filter(CampaignRecipient.campaign_id == campaign_id).all()
    ]
    if recipient_ids:
        db.query(Notification).filter(
            Notification.reference_type == "campaign_recipient",
            Notification.reference_id.in_(recipient_ids),
        ).delete(synchronize_session=False)

    db.query(CampaignRecipient).filter(CampaignRecipient.campaign_id == campaign_id).delete()
    db.query(CampaignAttachment).filter(CampaignAttachment.campaign_id == campaign_id).delete()

    db.delete(campaign)

    db.add(AuditLog(
        employee_id=current_user.id, action="delete_campaign",
        entity_type="campaign", entity_id=campaign_id,
        new_value=campaign_name, timestamp=datetime.now(timezone.utc),
    ))

    db.commit()
    return {"status": "deleted"}


# ── Campaign Attachments ──────────────────────────────────────────────

@router.post("/{campaign_id}/attachments", response_model=CampaignAttachmentOut)
async def upload_campaign_attachment(
    campaign_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    _check_campaign_access(current_user)

    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    status_val = campaign.status.value if hasattr(campaign.status, "value") else campaign.status
    if status_val != "draft":
        raise HTTPException(400, "Attachments can only be added to draft campaigns")

    # Validate content type
    content_type = file.content_type or ""
    if content_type not in ALLOWED_CAMPAIGN_ATTACHMENT_TYPES:
        allowed = ", ".join(ALLOWED_CAMPAIGN_ATTACHMENT_TYPES.values())
        raise HTTPException(400, f"File type not allowed. Accepted: {allowed}")

    # Read and check size
    data = await file.read()
    if len(data) > MAX_CAMPAIGN_ATTACHMENT_SIZE:
        raise HTTPException(400, f"File too large. Max {MAX_CAMPAIGN_ATTACHMENT_SIZE // (1024*1024)} MB")

    # Store file
    ext = ALLOWED_CAMPAIGN_ATTACHMENT_TYPES[content_type]
    stored_name = f"{uuid.uuid4().hex}{ext}"
    os.makedirs(CAMPAIGN_UPLOAD_DIR, exist_ok=True)
    file_path = os.path.join(CAMPAIGN_UPLOAD_DIR, stored_name)
    with open(file_path, "wb") as f:
        f.write(data)

    original = file.filename or "attachment"
    attachment = CampaignAttachment(
        campaign_id=campaign.id,
        original_filename=original,
        display_name=os.path.splitext(original)[0],
        stored_filename=stored_name,
        content_type=content_type,
        file_size_bytes=len(data),
        uploaded_by_id=current_user.id,
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    return CampaignAttachmentOut.model_validate(attachment)


@router.get("/{campaign_id}/attachments", response_model=List[CampaignAttachmentOut])
def list_campaign_attachments(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    _check_campaign_access(current_user)

    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    attachments = db.query(CampaignAttachment).filter(
        CampaignAttachment.campaign_id == campaign_id,
        CampaignAttachment.is_active == True,
    ).all()
    return [CampaignAttachmentOut.model_validate(a) for a in attachments]


@router.get("/{campaign_id}/attachments/{attachment_id}/download")
def download_campaign_attachment(
    campaign_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    _check_campaign_access(current_user)

    attachment = db.query(CampaignAttachment).filter(
        CampaignAttachment.id == attachment_id,
        CampaignAttachment.campaign_id == campaign_id,
        CampaignAttachment.is_active == True,
    ).first()
    if not attachment:
        raise HTTPException(404, "Attachment not found")

    file_path = os.path.join(CAMPAIGN_UPLOAD_DIR, attachment.stored_filename)
    if not os.path.exists(file_path):
        raise HTTPException(404, "File not found on disk")

    ext = os.path.splitext(attachment.stored_filename)[1]
    download_name = f"{attachment.display_name}{ext}"
    return FileResponse(
        file_path,
        media_type=attachment.content_type,
        filename=download_name,
    )


@router.delete("/{campaign_id}/attachments/{attachment_id}")
def delete_campaign_attachment(
    campaign_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    _check_campaign_access(current_user)

    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    status_val = campaign.status.value if hasattr(campaign.status, "value") else campaign.status
    if status_val != "draft":
        raise HTTPException(400, "Attachments can only be removed from draft campaigns")

    attachment = db.query(CampaignAttachment).filter(
        CampaignAttachment.id == attachment_id,
        CampaignAttachment.campaign_id == campaign_id,
    ).first()
    if not attachment:
        raise HTTPException(404, "Attachment not found")

    attachment.is_active = False
    db.commit()
    return {"status": "deleted"}


# ── Consultant Assignment ─────────────────────────────────────────────

@router.post("/{campaign_id}/recipients/{recipient_id}/assign")
def assign_consultant(
    campaign_id: int,
    recipient_id: int,
    payload: AssignConsultantRequest,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    _check_campaign_access(current_user)

    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    status_val = campaign.status.value if hasattr(campaign.status, "value") else campaign.status
    if status_val not in ("draft", "ready"):
        raise HTTPException(400, "Can only assign consultants in draft or ready campaigns")

    recipient = db.query(CampaignRecipient).filter(
        CampaignRecipient.id == recipient_id,
        CampaignRecipient.campaign_id == campaign_id,
    ).first()
    if not recipient:
        raise HTTPException(404, "Recipient not found")

    consultant = db.query(Employee).filter(
        Employee.id == payload.consultant_id,
        Employee.is_active == True,
    ).first()
    if not consultant:
        raise HTTPException(404, "Consultant not found or inactive")

    now = datetime.now(timezone.utc)
    recipient.assigned_consultant_id = consultant.id
    recipient.consultant_status = "pending"
    recipient.custom_email_subject = None
    recipient.custom_email_body = None
    recipient.consultant_accepted_at = None

    # Only create notification if campaign is already finalized (READY).
    # For DRAFT campaigns, notifications are deferred until finalize.
    contact = recipient.contact
    contact_name = contact.full_name if contact else "Unknown"
    if status_val == "ready":
        db.add(Notification(
            employee_id=consultant.id,
            notification_type="campaign_assignment",
            title=f"Campaign assignment: {campaign.name}",
            message=f"You have been assigned to send the campaign email to {contact_name}.",
            link="/campaign-assignments",
            reference_type="campaign_recipient",
            reference_id=recipient.id,
            is_read=False,
            created_at=now,
        ))

    db.add(AuditLog(
        employee_id=current_user.id, action="assign_campaign_consultant",
        entity_type="campaign_recipient", entity_id=recipient.id,
        new_value=f"Assigned {consultant.name} to {contact_name}",
        timestamp=now,
    ))

    db.commit()
    db.refresh(recipient)
    return _recipient_to_out(recipient)


@router.post("/{campaign_id}/recipients/{recipient_id}/unassign")
def unassign_consultant(
    campaign_id: int,
    recipient_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    _check_campaign_access(current_user)

    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    status_val = campaign.status.value if hasattr(campaign.status, "value") else campaign.status
    if status_val not in ("draft", "ready"):
        raise HTTPException(400, "Can only unassign consultants in draft or ready campaigns")

    recipient = db.query(CampaignRecipient).filter(
        CampaignRecipient.id == recipient_id,
        CampaignRecipient.campaign_id == campaign_id,
    ).first()
    if not recipient:
        raise HTTPException(404, "Recipient not found")

    old_consultant_id = recipient.assigned_consultant_id
    recipient.assigned_consultant_id = None
    recipient.consultant_status = None
    recipient.custom_email_subject = None
    recipient.custom_email_body = None
    recipient.consultant_accepted_at = None

    # Delete related notification
    if old_consultant_id:
        db.query(Notification).filter(
            Notification.reference_type == "campaign_recipient",
            Notification.reference_id == recipient.id,
            Notification.employee_id == old_consultant_id,
        ).delete(synchronize_session=False)

    db.commit()
    db.refresh(recipient)
    return _recipient_to_out(recipient)


    # (consultant actions moved to top of file for route priority)


# ── AI Presentation Analysis ─────────────────────────────────────────

@router.post("/{campaign_id}/analyze-attachment/{attachment_id}")
async def analyze_campaign_attachment(
    campaign_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    """Analyze a campaign attachment using AI to extract themes and suggest contacts."""
    _check_campaign_access(current_user)

    attachment = db.query(CampaignAttachment).filter(
        CampaignAttachment.id == attachment_id,
        CampaignAttachment.campaign_id == campaign_id,
        CampaignAttachment.is_active == True,
    ).first()
    if not attachment:
        raise HTTPException(404, "Attachment not found")

    analyzable_types = (
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    )
    if attachment.content_type not in analyzable_types:
        raise HTTPException(400, "Only PDF and PPTX files can be analyzed")

    file_path = os.path.join(CAMPAIGN_UPLOAD_DIR, attachment.stored_filename)
    if not os.path.exists(file_path):
        raise HTTPException(404, "File not found on disk")

    from app.services.presentation_analysis import PresentationAnalysisService
    service = PresentationAnalysisService(db)

    analysis = CampaignAnalysis(
        campaign_id=campaign_id,
        attachment_id=attachment_id,
        status="pending",
        created_at=datetime.now(timezone.utc),
    )
    db.add(analysis)
    db.commit()
    db.refresh(analysis)

    try:
        text = service.extract_text_from_file(file_path, attachment.content_type)
        if not text.strip():
            raise ValueError("No text could be extracted from the file")

        themes = await service.analyze_themes(text)
        suggestions = service.find_matching_contacts(themes, limit=100)

        analysis.extracted_themes = json.dumps(themes)
        analysis.suggested_tags = json.dumps([s["matched_tags"] for s in suggestions[:20]])
        analysis.status = "completed"
        analysis.completed_at = datetime.now(timezone.utc)
        db.commit()

        return {
            "analysis_id": analysis.id,
            "extracted_themes": themes,
            "suggested_contacts": suggestions[:50],
            "total_matches": len(suggestions),
        }

    except Exception as e:
        analysis.status = "failed"
        analysis.error_message = str(e)
        db.commit()
        raise HTTPException(500, f"Analysis failed: {str(e)}")
