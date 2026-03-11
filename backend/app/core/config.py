import os
import logging
from pydantic_settings import BaseSettings
from typing import Optional

_logger = logging.getLogger(__name__)

_DEFAULT_SECRET = "CHANGE-ME-IN-PRODUCTION"


class Settings(BaseSettings):
    APP_NAME: str = "Advisense Sales Coordination"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = False  # Default to False (safe for production)

    # Database — SQLite locally, PostgreSQL in Azure
    DATABASE_URL: str = "sqlite:///./database/sales_support.db"

    # JWT Authentication
    SECRET_KEY: str = _DEFAULT_SECRET
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    ALGORITHM: str = "HS256"

    # CORS — comma-separated origins (parsed to list below)
    ALLOWED_ORIGINS: str = "http://localhost:5173,http://localhost:5174,http://localhost:3000,http://localhost:8001"

    # Microsoft Graph (for future Outlook integration)
    AZURE_TENANT_ID: Optional[str] = None
    AZURE_CLIENT_ID: Optional[str] = None
    AZURE_CLIENT_SECRET: Optional[str] = None
    GRAPH_API_ENDPOINT: str = "https://graph.microsoft.com/v1.0"

    # AI Presentation Analysis
    ANTHROPIC_API_KEY: Optional[str] = None

    # Rate limiting — login endpoint
    LOGIN_RATE_LIMIT_ATTEMPTS: int = 5
    LOGIN_RATE_LIMIT_WINDOW_SECONDS: int = 300  # 5 minutes

    # Outreach defaults
    DEFAULT_COOLDOWN_DAYS_OUTREACH: int = 90
    DEFAULT_COOLDOWN_DAYS_LAST_ACTIVITY: int = 180
    DEFAULT_MIN_LEAD_DAYS: int = 7
    DEFAULT_MEETING_DURATION_MINUTES: int = 45
    DEFAULT_WORK_START_HOUR: int = 9
    DEFAULT_WORK_END_HOUR: int = 16

    # Scoring weights (defaults, configurable via admin)
    SCORE_WEIGHT_TIER: float = 0.30
    SCORE_WEIGHT_REVENUE: float = 0.15
    SCORE_WEIGHT_DAYS_SINCE_INTERACTION: float = 0.25
    SCORE_WEIGHT_DOMAIN_MATCH: float = 0.20
    SCORE_WEIGHT_SENIORITY: float = 0.10
    SCORE_WEIGHT_GAP_FILL: float = 0.10

    @property
    def allowed_origins_list(self) -> list[str]:
        """Parse comma-separated ALLOWED_ORIGINS into a list."""
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]

    @property
    def is_sqlite(self) -> bool:
        return "sqlite" in self.DATABASE_URL

    class Config:
        env_file = os.path.join(os.path.dirname(__file__), "..", "..", ".env")
        env_file_encoding = "utf-8"
        extra = "ignore"  # Ignore unknown env vars


settings = Settings()

# Warn at startup if using default secret key
if settings.SECRET_KEY == _DEFAULT_SECRET:
    _logger.warning(
        "SECRET_KEY is set to the default value. "
        "Set SECRET_KEY in your .env file for production use."
    )
