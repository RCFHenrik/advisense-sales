from datetime import datetime, timedelta, time, timezone, date
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models.models import (
    Employee, OutreachRecord, OutreachStatusEnum, BankHoliday, SystemConfig,
)
from app.core.config import settings


class SchedulingService:
    """Meeting scheduling engine.

    Proposes two date/time options per outreach.
    Prevents collisions across pending outreach for the same consultant.
    Respects bank holidays, working hours, and configurable constraints.
    """

    def __init__(self, db: Session):
        self.db = db
        self._load_config()

    def _load_config(self):
        self.min_lead_days = self._get_config_int("min_lead_days", settings.DEFAULT_MIN_LEAD_DAYS)
        self.meeting_duration = self._get_config_int("meeting_duration_minutes", settings.DEFAULT_MEETING_DURATION_MINUTES)
        self.work_start = self._get_config_int("work_start_hour", settings.DEFAULT_WORK_START_HOUR)
        self.work_end = self._get_config_int("work_end_hour", settings.DEFAULT_WORK_END_HOUR)

    def _get_config_int(self, key: str, default: int) -> int:
        config = self.db.query(SystemConfig).filter(SystemConfig.key == key).first()
        if config:
            try:
                return int(config.value)
            except ValueError:
                pass
        return default

    def _get_bank_holidays(self, employee: Employee) -> set:
        """Get bank holidays for the employee's site/country."""
        holidays = set()

        query = self.db.query(BankHoliday)
        if employee.site_id:
            query = query.filter(
                (BankHoliday.site_id == employee.site_id) | (BankHoliday.site_id.is_(None))
            )
            if employee.site and employee.site.country_code:
                query = query.filter(
                    (BankHoliday.country_code == employee.site.country_code) | (BankHoliday.country_code.is_(None))
                )

        for h in query.all():
            holidays.add(h.date.date() if isinstance(h.date, datetime) else h.date)

        return holidays

    def _get_existing_slots(self, employee: Employee) -> List[Tuple[datetime, datetime]]:
        """Get all pending outreach time slots for this consultant."""
        pending = (
            self.db.query(OutreachRecord)
            .filter(
                OutreachRecord.employee_id == employee.id,
                OutreachRecord.status.in_([
                    OutreachStatusEnum.PROPOSED,
                    OutreachStatusEnum.ACCEPTED,
                    OutreachStatusEnum.DRAFT,
                    OutreachStatusEnum.PREPARED,
                ]),
            )
            .all()
        )

        slots = []
        for o in pending:
            if o.proposed_slot_1_start and o.proposed_slot_1_end:
                slots.append((o.proposed_slot_1_start, o.proposed_slot_1_end))
            if o.proposed_slot_2_start and o.proposed_slot_2_end:
                slots.append((o.proposed_slot_2_start, o.proposed_slot_2_end))

        return slots

    def _is_workday(self, d: date, holidays: set) -> bool:
        """Check if date is a workday (Mon-Fri, not a bank holiday)."""
        return d.weekday() < 5 and d not in holidays

    def _slots_overlap(
        self, start: datetime, end: datetime, existing: List[Tuple[datetime, datetime]]
    ) -> bool:
        """Check if proposed slot overlaps with any existing slot."""
        for ex_start, ex_end in existing:
            if start < ex_end and end > ex_start:
                return True
        return False

    def propose_meeting_slots(
        self, employee: Employee, calendar_busy: Optional[List[dict]] = None
    ) -> List[dict]:
        """Propose exactly two meeting slots.

        Each slot is a 2-hour availability window.
        The email will show the window (e.g., 10:00-12:00).
        The meeting itself is 45 minutes within that window.

        Args:
            employee: The consultant
            calendar_busy: Optional list of busy times from Outlook
                          [{"start": datetime, "end": datetime}, ...]

        Returns:
            List of 2 slot dicts with start/end (2h windows) and
            meeting_start/meeting_end (45-min actual slots).
        """
        holidays = self._get_bank_holidays(employee)
        existing_slots = self._get_existing_slots(employee)

        # Convert calendar busy times
        busy_periods = []
        if calendar_busy:
            for b in calendar_busy:
                busy_periods.append((b["start"], b["end"]))

        all_blocked = existing_slots + busy_periods

        now = datetime.now(timezone.utc)
        start_date = (now + timedelta(days=self.min_lead_days)).date()

        proposed = []
        check_date = start_date

        # Search up to 30 days ahead
        max_date = start_date + timedelta(days=30)

        while check_date <= max_date and len(proposed) < 2:
            if not self._is_workday(check_date, holidays):
                check_date += timedelta(days=1)
                continue

            # Try different time windows during the day
            for hour in range(self.work_start, self.work_end - 1):
                window_start = datetime.combine(check_date, time(hour, 0), tzinfo=timezone.utc)
                window_end = window_start + timedelta(hours=2)

                # Ensure window fits within work hours
                if window_end.hour > self.work_end:
                    continue

                # Meeting would be in the middle of the 2h window
                meeting_start = window_start + timedelta(minutes=30)
                meeting_end = meeting_start + timedelta(minutes=self.meeting_duration)

                if not self._slots_overlap(window_start, window_end, all_blocked):
                    proposed.append({
                        "window_start": window_start,
                        "window_end": window_end,
                        "meeting_start": meeting_start,
                        "meeting_end": meeting_end,
                    })
                    # Block this slot for collision detection within this call
                    all_blocked.append((window_start, window_end))
                    break  # Move to next day for variety

            check_date += timedelta(days=1)

        return proposed

    def format_slot_for_email(self, slot: dict, language: str = "en") -> str:
        """Format a slot for inclusion in an email."""
        ws = slot["window_start"]
        we = slot["window_end"]

        day_names = {
            "en": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
            "sv": ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag", "Söndag"],
            "no": ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"],
            "da": ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"],
            "de": ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"],
            "fi": ["Maanantai", "Tiistai", "Keskiviikko", "Torstai", "Perjantai", "Lauantai", "Sunnuntai"],
        }

        names = day_names.get(language, day_names["en"])
        day_name = names[ws.weekday()]

        return f"{day_name} {ws.strftime('%d %B')}, {ws.strftime('%H:%M')}–{we.strftime('%H:%M')}"
