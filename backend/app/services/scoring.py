import json
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import Contact, SystemConfig, HotTopic
from app.core.config import settings


class ScoringService:
    """Contact prioritisation scoring engine.

    Score based on:
    - Client tier (Tier1 highest)
    - Historical revenue flag
    - Days since last interaction (within preferred window)
    - Responsibility domain <-> BA/Team hot topic match
    - Job title seniority proxy
    """

    def __init__(self, db: Session):
        self.db = db
        self._load_weights()

    def _load_weights(self):
        self.w_tier = self._get_config_float("score_weight_tier", settings.SCORE_WEIGHT_TIER)
        self.w_revenue = self._get_config_float("score_weight_revenue", settings.SCORE_WEIGHT_REVENUE)
        self.w_days = self._get_config_float("score_weight_days_since_interaction", settings.SCORE_WEIGHT_DAYS_SINCE_INTERACTION)
        self.w_domain = self._get_config_float("score_weight_domain_match", settings.SCORE_WEIGHT_DOMAIN_MATCH)
        self.w_seniority = self._get_config_float("score_weight_seniority", settings.SCORE_WEIGHT_SENIORITY)

    def _get_config_float(self, key: str, default: float) -> float:
        config = self.db.query(SystemConfig).filter(SystemConfig.key == key).first()
        if config:
            try:
                return float(config.value)
            except ValueError:
                pass
        return default

    def score_contact(self, contact: Contact, hot_topic_domains: Optional[set] = None) -> float:
        score = 0.0

        # Tier score (0-1)
        tier_scores = {"Tier1": 1.0, "Tier2": 0.7, "Tier3": 0.3}
        tier_score = tier_scores.get(contact.client_tier, 0.2)
        score += self.w_tier * tier_score

        # Revenue score (0 or 1)
        revenue_score = 1.0 if contact.has_historical_revenue else 0.0
        score += self.w_revenue * revenue_score

        # Days since interaction score
        # Sweet spot: 90-365 days (not too recent, not too stale)
        days = contact.days_since_interaction
        if days is not None:
            if days < 30:
                days_score = 0.1  # Too recent
            elif days < 90:
                days_score = 0.4
            elif days < 180:
                days_score = 1.0  # Sweet spot
            elif days < 365:
                days_score = 0.7
            else:
                days_score = 0.3  # Very stale
        else:
            days_score = 0.5  # Unknown
        score += self.w_days * days_score

        # Domain match score
        domain_score = 0.0
        if hot_topic_domains and contact.responsibility_domain:
            if contact.responsibility_domain in hot_topic_domains:
                domain_score = 1.0
        score += self.w_domain * domain_score

        # Seniority proxy from job title
        seniority_score = self._estimate_seniority(contact.job_title)
        score += self.w_seniority * seniority_score

        return round(score, 4)

    def _estimate_seniority(self, job_title: Optional[str]) -> float:
        if not job_title:
            return 0.3

        title_lower = job_title.lower()

        # C-level
        if any(t in title_lower for t in ["chief", "ceo", "cfo", "cro", "cto", "cio", "coo"]):
            return 1.0

        # SVP / EVP / Managing Director
        if any(t in title_lower for t in ["senior vice president", "svp", "evp", "managing director"]):
            return 0.9

        # VP / Director
        if any(t in title_lower for t in ["vice president", "director", "head of"]):
            return 0.8

        # Senior Manager
        if any(t in title_lower for t in ["senior manager", "principal"]):
            return 0.7

        # Manager
        if "manager" in title_lower:
            return 0.6

        # Senior individual
        if "senior" in title_lower:
            return 0.5

        # Lead / Specialist
        if any(t in title_lower for t in ["lead", "specialist", "expert"]):
            return 0.4

        return 0.3

    def score_all_contacts(self):
        """Recalculate priority scores for all active contacts."""
        hot_topics = self.db.query(HotTopic).filter(HotTopic.is_active == True).all()
        hot_topic_domains = {ht.responsibility_domain for ht in hot_topics}

        contacts = self.db.query(Contact).filter(Contact.status == "active").all()
        for contact in contacts:
            contact.priority_score = self.score_contact(contact, hot_topic_domains)

        self.db.commit()
        return len(contacts)
