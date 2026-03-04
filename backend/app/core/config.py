from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    APP_NAME: str = "Advisense Sales Coordination"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = True

    # Database
    DATABASE_URL: str = "sqlite:///./database/sales_support.db"

    # Auth (mocked for prototype)
    SECRET_KEY: str = "dev-secret-key-change-in-production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    ALGORITHM: str = "HS256"

    # Microsoft Graph (for future Outlook integration)
    AZURE_TENANT_ID: Optional[str] = None
    AZURE_CLIENT_ID: Optional[str] = None
    AZURE_CLIENT_SECRET: Optional[str] = None
    GRAPH_API_ENDPOINT: str = "https://graph.microsoft.com/v1.0"

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

    class Config:
        env_file = ".env"


settings = Settings()
