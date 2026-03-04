from datetime import datetime
from typing import Optional, List

from jinja2 import Template
from sqlalchemy.orm import Session

from app.models.models import (
    Contact, Employee, EmailTemplate, HotTopic, LanguageEnum,
)


class EmailGeneratorService:
    """Generate personalised outreach emails using templates.

    Anti-hallucination rules:
    - Only use data from approved inputs (contact data, templates, hot topics)
    - No references to past meetings unless explicitly in the data
    - Mandatory phrasing for physical/digital meeting options
    """

    # Default meeting phrasing per language
    MEETING_PHRASING = {
        LanguageEnum.ENGLISH: "I would be happy to meet either in person at your offices or via a digital meeting, whichever suits you best.",
        LanguageEnum.SWEDISH: "Jag träffar dig gärna antingen fysiskt hos er eller via ett digitalt möte, beroende på vad som passar bäst.",
        LanguageEnum.NORWEGIAN: "Jeg møter deg gjerne enten fysisk hos dere eller via et digitalt møte, avhengig av hva som passer best.",
        LanguageEnum.DANISH: "Jeg møder dig gerne enten fysisk hos jer eller via et digitalt møde, alt efter hvad der passer bedst.",
        LanguageEnum.GERMAN: "Gerne treffe ich Sie persönlich in Ihrem Büro oder über ein digitales Meeting – ganz wie es Ihnen am besten passt.",
        LanguageEnum.FINNISH: "Tapaan mielelläni joko henkilökohtaisesti toimistollanne tai digitaalisesti, kumpi teille parhaiten sopii.",
    }

    def __init__(self, db: Session):
        self.db = db

    def generate_email(
        self,
        contact: Contact,
        employee: Employee,
        template_id: Optional[int] = None,
        language: Optional[LanguageEnum] = None,
        slot_1_text: Optional[str] = None,
        slot_2_text: Optional[str] = None,
    ) -> dict:
        """Generate an email draft.

        Returns dict with 'subject' and 'body'.
        """
        lang = language or employee.primary_language or LanguageEnum.ENGLISH

        # Find best template
        template = self._find_template(contact, lang, template_id)

        # Get relevant hot topics
        hot_topics = self._get_hot_topics(contact, employee, lang)

        # Build template context (only approved data)
        context = self._build_context(contact, employee, hot_topics, lang, slot_1_text, slot_2_text)

        if template:
            subject = self._render(template.subject_template, context)
            body = self._render(template.body_template, context)
        else:
            subject, body = self._default_email(context, lang)

        return {
            "subject": subject,
            "body": body,
            "language": lang.value,
            "template_id": template.id if template else None,
            "template_version": template.version if template else None,
        }

    def _find_template(
        self, contact: Contact, language: LanguageEnum, template_id: Optional[int] = None
    ) -> Optional[EmailTemplate]:
        if template_id:
            return self.db.query(EmailTemplate).filter(EmailTemplate.id == template_id).first()

        # Try to find by responsibility domain + language
        if contact.responsibility_domain:
            t = (
                self.db.query(EmailTemplate)
                .filter(
                    EmailTemplate.responsibility_domain == contact.responsibility_domain,
                    EmailTemplate.language == language,
                    EmailTemplate.is_active == True,
                )
                .first()
            )
            if t:
                return t

        # Fall back to generic template for language
        return (
            self.db.query(EmailTemplate)
            .filter(
                EmailTemplate.responsibility_domain.is_(None),
                EmailTemplate.language == language,
                EmailTemplate.is_active == True,
            )
            .first()
        )

    def _get_hot_topics(
        self, contact: Contact, employee: Employee, language: LanguageEnum
    ) -> List[str]:
        query = self.db.query(HotTopic).filter(
            HotTopic.is_active == True,
            HotTopic.language == language,
        )

        if contact.responsibility_domain:
            query = query.filter(HotTopic.responsibility_domain == contact.responsibility_domain)

        if employee.business_area_id:
            query = query.filter(HotTopic.business_area_id == employee.business_area_id)

        return [ht.topic_text for ht in query.limit(3).all()]

    def _build_context(
        self,
        contact: Contact,
        employee: Employee,
        hot_topics: List[str],
        language: LanguageEnum,
        slot_1_text: Optional[str],
        slot_2_text: Optional[str],
    ) -> dict:
        return {
            "contact_first_name": contact.first_name or "",
            "contact_last_name": contact.last_name or "",
            "contact_full_name": contact.full_name or f"{contact.first_name} {contact.last_name}",
            "contact_title": contact.job_title or "",
            "contact_company": contact.company_name or "",
            "contact_sector": contact.sector or "",
            "contact_domain": contact.responsibility_domain or "",
            "employee_name": employee.name,
            "employee_title": employee.seniority or "Consultant",
            "employee_team": employee.team.name if employee.team else "",
            "employee_ba": employee.business_area.name if employee.business_area else "Advisense",
            "hot_topics": hot_topics,
            "hot_topics_text": ", ".join(hot_topics) if hot_topics else "",
            "meeting_phrasing": self.MEETING_PHRASING.get(language, self.MEETING_PHRASING[LanguageEnum.ENGLISH]),
            "slot_1": slot_1_text or "",
            "slot_2": slot_2_text or "",
            "company_name": "Advisense",
        }

    def _render(self, template_str: str, context: dict) -> str:
        try:
            tmpl = Template(template_str)
            return tmpl.render(**context)
        except Exception:
            return template_str

    def _default_email(self, ctx: dict, language: LanguageEnum) -> tuple:
        if language == LanguageEnum.SWEDISH:
            subject = f"Möjlighet till samtal – {ctx['employee_ba']}"
            body = (
                f"Hej {ctx['contact_first_name']},\n\n"
                f"Mitt namn är {ctx['employee_name']} och jag arbetar som {ctx['employee_title']} "
                f"på {ctx['company_name']}. Vi arbetar aktivt inom {ctx['contact_domain'] or 'ert verksamhetsområde'} "
                f"och jag skulle gärna vilja boka in ett kort möte för att diskutera hur vi kan stötta er.\n\n"
            )
            if ctx["hot_topics"]:
                body += f"Aktuella ämnen vi ser i marknaden inkluderar: {ctx['hot_topics_text']}.\n\n"
            body += f"{ctx['meeting_phrasing']}\n\n"
            if ctx["slot_1"] or ctx["slot_2"]:
                body += f"Jag föreslår följande tider:\n"
                if ctx["slot_1"]:
                    body += f"  - {ctx['slot_1']}\n"
                if ctx["slot_2"]:
                    body += f"  - {ctx['slot_2']}\n"
                body += "\n"
            body += f"Med vänliga hälsningar,\n{ctx['employee_name']}\n{ctx['company_name']}"
        elif language == LanguageEnum.GERMAN:
            subject = f"Gesprächsmöglichkeit – {ctx['employee_ba']}"
            body = (
                f"Sehr geehrte/r {ctx['contact_first_name']} {ctx['contact_last_name']},\n\n"
                f"mein Name ist {ctx['employee_name']} und ich arbeite als {ctx['employee_title']} "
                f"bei {ctx['company_name']}. Wir sind aktiv im Bereich {ctx['contact_domain'] or 'Ihrem Fachgebiet'} "
                f"tätig und ich würde mich freuen, ein kurzes Gespräch zu vereinbaren.\n\n"
            )
            if ctx["hot_topics"]:
                body += f"Aktuelle Themen, die wir im Markt sehen: {ctx['hot_topics_text']}.\n\n"
            body += f"{ctx['meeting_phrasing']}\n\n"
            if ctx["slot_1"] or ctx["slot_2"]:
                body += f"Ich schlage folgende Termine vor:\n"
                if ctx["slot_1"]:
                    body += f"  - {ctx['slot_1']}\n"
                if ctx["slot_2"]:
                    body += f"  - {ctx['slot_2']}\n"
                body += "\n"
            body += f"Mit freundlichen Grüßen,\n{ctx['employee_name']}\n{ctx['company_name']}"
        else:
            # English default
            subject = f"Meeting opportunity – {ctx['employee_ba']}"
            body = (
                f"Dear {ctx['contact_first_name']},\n\n"
                f"My name is {ctx['employee_name']} and I work as {ctx['employee_title']} "
                f"at {ctx['company_name']}. We are actively engaged in {ctx['contact_domain'] or 'your area of expertise'} "
                f"and I would welcome the opportunity to schedule a brief meeting to discuss how we might support your work.\n\n"
            )
            if ctx["hot_topics"]:
                body += f"Current topics we see in the market include: {ctx['hot_topics_text']}.\n\n"
            body += f"{ctx['meeting_phrasing']}\n\n"
            if ctx["slot_1"] or ctx["slot_2"]:
                body += f"I would like to suggest the following times:\n"
                if ctx["slot_1"]:
                    body += f"  - {ctx['slot_1']}\n"
                if ctx["slot_2"]:
                    body += f"  - {ctx['slot_2']}\n"
                body += "\n"
            body += f"Kind regards,\n{ctx['employee_name']}\n{ctx['company_name']}"

        return subject, body
