import io
from datetime import datetime
from typing import Dict, List, Optional, Tuple

import openpyxl
from sqlalchemy.orm import Session

from app.models.models import Contact, Meeting, ColumnMapping, ContactStatusEnum
from app.schemas.schemas import UploadDiffSummary


class ExcelImportService:
    def __init__(self, db: Session):
        self.db = db

    def _get_mappings(self, file_type: str) -> Dict[str, str]:
        """Get logical→physical column mappings for a file type."""
        mappings = self.db.query(ColumnMapping).filter(ColumnMapping.file_type == file_type).all()
        return {m.logical_field: m.physical_column for m in mappings}

    def _get_required_fields(self, file_type: str) -> List[str]:
        """Get list of required logical fields."""
        mappings = (
            self.db.query(ColumnMapping)
            .filter(ColumnMapping.file_type == file_type, ColumnMapping.is_required == True)
            .all()
        )
        return [m.logical_field for m in mappings]

    def _read_excel(self, content: bytes) -> Tuple[List[str], List[Dict]]:
        """Read Excel file and return headers + rows as list of dicts."""
        wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        ws = wb.active

        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            raise ValueError("Empty file")

        headers = [str(h).strip() if h else "" for h in rows[0]]
        data = []
        for row in rows[1:]:
            row_dict = {}
            for i, val in enumerate(row):
                if i < len(headers) and headers[i]:
                    row_dict[headers[i]] = val
            if any(v is not None for v in row_dict.values()):
                data.append(row_dict)

        wb.close()
        return headers, data

    def _resolve_value(self, row: Dict, mappings: Dict[str, str], logical_field: str) -> Optional[str]:
        """Get value from row using the configured column mapping."""
        physical = mappings.get(logical_field)
        if not physical:
            return None
        val = row.get(physical)
        if val is None or str(val).strip() in ("", "#N/A", "N/A", "nan"):
            return None
        return str(val).strip()

    def _resolve_float(self, row: Dict, mappings: Dict[str, str], logical_field: str) -> Optional[float]:
        val = self._resolve_value(row, mappings, logical_field)
        if val is None:
            return None
        try:
            return float(val)
        except (ValueError, TypeError):
            return None

    def _resolve_int(self, row: Dict, mappings: Dict[str, str], logical_field: str) -> Optional[int]:
        val = self._resolve_value(row, mappings, logical_field)
        if val is None:
            return None
        try:
            return int(float(val))
        except (ValueError, TypeError):
            return None

    def _resolve_datetime(self, row: Dict, mappings: Dict[str, str], logical_field: str) -> Optional[datetime]:
        physical = mappings.get(logical_field)
        if not physical:
            return None
        val = row.get(physical)
        if val is None:
            return None
        if isinstance(val, datetime):
            return val
        try:
            return datetime.fromisoformat(str(val))
        except (ValueError, TypeError):
            return None

    def _resolve_bool(self, row: Dict, mappings: Dict[str, str], logical_field: str) -> bool:
        val = self._resolve_value(row, mappings, logical_field)
        if val is None:
            return False
        return val.lower() in ("true", "1", "yes", "x")

    def _resolve_optional_bool(self, row: Dict, mappings: Dict[str, str], logical_field: str):
        """Like _resolve_bool but returns None when the field is absent/empty (so upserts preserve existing values)."""
        val = self._resolve_value(row, mappings, logical_field)
        if val is None:
            return None
        return val.lower() in ("true", "1", "yes", "x")

    def _dedup_key(self, row: Dict, mappings: Dict[str, str]) -> Optional[str]:
        """Build deduplication key: email > record_id > (company_id, full_name)."""
        email = self._resolve_value(row, mappings, "email")
        if email:
            return f"email:{email.lower()}"

        record_id = self._resolve_value(row, mappings, "record_id")
        if record_id:
            return f"rid:{record_id}"

        company_id = self._resolve_value(row, mappings, "associated_company_id")
        full_name = self._resolve_value(row, mappings, "full_name")
        if company_id and full_name:
            return f"comp:{company_id}:{full_name.lower()}"

        return None

    def import_contacts(self, content: bytes, batch_id: str, uploaded_by_id: int) -> UploadDiffSummary:
        mappings = self._get_mappings("contacts")
        if not mappings:
            mappings = self._default_contact_mappings()
            self._save_default_mappings("contacts", mappings)

        required = self._get_required_fields("contacts")
        headers, data = self._read_excel(content)

        # Validate required mappings exist in headers
        errors = []
        for field in required:
            physical = mappings.get(field)
            if physical and physical not in headers:
                errors.append(f"Required column '{physical}' (for {field}) not found in file")

        if errors:
            raise ValueError("; ".join(errors))

        # Build lookup of existing contacts by dedup key
        existing_contacts = self.db.query(Contact).all()
        existing_map: Dict[str, Contact] = {}
        for c in existing_contacts:
            if c.email:
                existing_map[f"email:{c.email.lower()}"] = c
            elif c.record_id:
                existing_map[f"rid:{c.record_id}"] = c
            elif c.associated_company_id and c.full_name:
                existing_map[f"comp:{c.associated_company_id}:{c.full_name.lower()}"] = c

        added = 0
        updated = 0
        seen_keys = set()

        for row in data:
            key = self._dedup_key(row, mappings)
            if not key:
                continue
            if key in seen_keys:
                continue
            seen_keys.add(key)

            contact_data = {
                "record_id": self._resolve_value(row, mappings, "record_id"),
                "first_name": self._resolve_value(row, mappings, "first_name"),
                "last_name": self._resolve_value(row, mappings, "last_name"),
                "full_name": self._resolve_value(row, mappings, "full_name"),
                "email": self._resolve_value(row, mappings, "email"),
                "job_title": self._resolve_value(row, mappings, "job_title"),
                "company_name": self._resolve_value(row, mappings, "company_name"),
                "associated_company_id": self._resolve_value(row, mappings, "associated_company_id"),
                "sector": self._resolve_value(row, mappings, "sector"),
                "client_tier": self._resolve_value(row, mappings, "client_tier"),
                "responsibility_domain": self._resolve_value(row, mappings, "responsibility_domain"),
                "group_domicile": self._resolve_value(row, mappings, "group_domicile"),
                "owner_name": self._resolve_value(row, mappings, "owner_name"),
                "owner_business_area": self._resolve_value(row, mappings, "owner_business_area"),
                "owner_org_site": self._resolve_value(row, mappings, "owner_org_site"),
                "owner_team": self._resolve_value(row, mappings, "owner_team"),
                "owner_seniority": self._resolve_value(row, mappings, "owner_seniority"),
                "last_activity_date": self._resolve_datetime(row, mappings, "last_activity_date"),
                "revenue": self._resolve_float(row, mappings, "revenue"),
                "has_historical_revenue": self._resolve_bool(row, mappings, "has_historical_revenue"),
                "days_since_interaction": self._resolve_int(row, mappings, "days_since_interaction"),
                "contacted_last_1y": self._resolve_bool(row, mappings, "contacted_last_1y"),
                "relevant_search": self._resolve_optional_bool(row, mappings, "relevant_search"),
                "hubspot_import_batch": batch_id,
            }

            # Build full_name if missing
            if not contact_data["full_name"] and contact_data["first_name"] and contact_data["last_name"]:
                contact_data["full_name"] = f"{contact_data['last_name']}, {contact_data['first_name']}"

            existing = existing_map.get(key)
            if existing:
                file_lad = contact_data.get('last_activity_date')
                # Determine whether the file's last_activity_date is newer than the app's
                _file_lad_accepted = False
                if file_lad is not None:
                    existing_lad = existing.last_activity_date
                    # Normalise both to naive datetime for comparison
                    file_lad_n = file_lad.replace(tzinfo=None) if getattr(file_lad, 'tzinfo', None) else file_lad
                    existing_lad_n = existing_lad.replace(tzinfo=None) if existing_lad and getattr(existing_lad, 'tzinfo', None) else existing_lad
                    _file_lad_accepted = (existing_lad_n is None or file_lad_n > existing_lad_n)

                for k, v in contact_data.items():
                    if v is None:
                        continue
                    if k == 'last_activity_date':
                        if _file_lad_accepted:
                            existing.last_activity_date = v
                        # else: keep the app's newer value (e.g. set by a sent email)
                        continue
                    if k == 'days_since_interaction':
                        # Only accept the file's days_since value if the file's date was also accepted
                        if _file_lad_accepted:
                            existing.days_since_interaction = v
                        continue
                    setattr(existing, k, v)
                existing.status = ContactStatusEnum.ACTIVE
                updated += 1
            else:
                contact = Contact(**contact_data)
                self.db.add(contact)
                added += 1

        # Mark contacts not in upload as inactive
        removed = 0
        for key, contact in existing_map.items():
            if key not in seen_keys and contact.status == ContactStatusEnum.ACTIVE:
                contact.status = ContactStatusEnum.INACTIVE_MISSING
                removed += 1

        self.db.commit()

        return UploadDiffSummary(
            added=added,
            updated=updated,
            removed=removed,
            unchanged=len(seen_keys) - added - updated,
            total_rows=len(data),
            errors=errors,
        )

    def import_meetings(self, content: bytes, batch_id: str, uploaded_by_id: int) -> UploadDiffSummary:
        mappings = self._get_mappings("meetings")
        if not mappings:
            mappings = self._default_meeting_mappings()
            self._save_default_mappings("meetings", mappings)

        headers, data = self._read_excel(content)
        errors = []

        existing_meetings = self.db.query(Meeting).all()
        existing_by_rid = {m.record_id: m for m in existing_meetings if m.record_id}

        added = 0
        updated = 0
        seen_rids = set()

        for row in data:
            rid = self._resolve_value(row, mappings, "record_id")
            if rid:
                seen_rids.add(rid)

            meeting_data = {
                "record_id": rid,
                "employee_name": self._resolve_value(row, mappings, "activity_assigned_to"),
                "employee_name_corrected": self._resolve_value(row, mappings, "name_correction"),
                "activity_date": self._resolve_datetime(row, mappings, "activity_date"),
                "details": self._resolve_value(row, mappings, "details"),
                "outcome": self._resolve_value(row, mappings, "meeting_outcome"),
                "associated_company": self._resolve_value(row, mappings, "associated_companies"),
                "associated_contacts": self._resolve_value(row, mappings, "associated_contacts"),
                "company_corrected": self._resolve_value(row, mappings, "company_corrected"),
                "client_tier": self._resolve_value(row, mappings, "client_tier"),
                "group_domicile": self._resolve_value(row, mappings, "group_domicile"),
                "seniority": self._resolve_value(row, mappings, "seniority"),
                "hubspot_import_batch": batch_id,
            }

            # Try to link to contact
            contact_name = self._resolve_value(row, mappings, "associated_contacts")
            if contact_name:
                contact = self.db.query(Contact).filter(
                    Contact.full_name.ilike(f"%{contact_name}%")
                ).first()
                if contact:
                    meeting_data["contact_id"] = contact.id

            existing = existing_by_rid.get(rid) if rid else None
            if existing:
                for k, v in meeting_data.items():
                    if v is not None:
                        setattr(existing, k, v)
                updated += 1
            else:
                meeting = Meeting(**meeting_data)
                self.db.add(meeting)
                added += 1

        self.db.commit()

        return UploadDiffSummary(
            added=added,
            updated=updated,
            removed=0,
            unchanged=len(seen_rids) - updated,
            total_rows=len(data),
            errors=errors,
        )

    def _default_contact_mappings(self) -> Dict[str, str]:
        return {
            "record_id": "Record ID",
            "first_name": "FirstName",
            "last_name": "LastName",
            "email": "CONTACT_Email",
            "job_title": "CONTACT_JobTitle",
            "company_name": "CONTACT_Company",
            "associated_company_id": "Associated Company IDs (Primary)",
            "sector": "CONTACT_Sector",
            "client_tier": "CONTACT_ClientTier",
            "responsibility_domain": "CONTACT_ResponsibilityDomain",
            "group_domicile": "CONTACT_GroupDomicile",
            "owner_name": "OWNER_CONTACT",
            "owner_business_area": "OWNER_BusinessArea",
            "owner_org_site": "OWNER_OrgSite",
            "owner_team": "OWNER_Team",
            "owner_seniority": "OWNER_SENIORITY",
            "last_activity_date": "Last Activity Date",
            "revenue": "CONTACT_Revenue",
            "has_historical_revenue": "CONTACT_HasHistRevenue",
            "days_since_interaction": "CONTACT_DaysSinceInteraction",
            "contacted_last_1y": "CONTACT_ContactedLast1Y",
            "relevant_search": "CONTACT_RelevantSearch",
            "full_name": "CONTACT_FullName (L_F)",
            "associated_company_primary": "Associated Company (Primary)",
        }

    def _default_meeting_mappings(self) -> Dict[str, str]:
        return {
            "record_id": "Record ID",
            "details": "Details",
            "activity_date": "Activity date",
            "activity_assigned_to": "Activity assigned to",
            "associated_companies": "Associated Companies",
            "associated_contacts": "Associated Contacts",
            "meeting_outcome": "Meeting outcome",
            "name_correction": "NameCorrection",
            "company_corrected": "Company (corrected)",
            "client_tier": "ClientTier",
            "group_domicile": "GroupDomicile",
            "seniority": "Seniority",
        }

    def _save_default_mappings(self, file_type: str, mappings: Dict[str, str]):
        required_contacts = {"record_id", "email", "first_name", "last_name"}
        required_meetings = {"record_id", "activity_date"}

        required_set = required_contacts if file_type == "contacts" else required_meetings

        for logical, physical in mappings.items():
            m = ColumnMapping(
                file_type=file_type,
                logical_field=logical,
                physical_column=physical,
                is_required=logical in required_set,
            )
            self.db.add(m)
        self.db.commit()
