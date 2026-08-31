from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = (
        "postgresql+asyncpg://paper_review:paper_review_dev@127.0.0.1:5433/paper_review"
    )
    jwt_secret: str = "dev-only-change-me-please-use-32bytes+"
    jwt_access_ttl_seconds: int = 1800
    jwt_refresh_ttl_seconds: int = 1_209_600
    storage_root: Path = REPO_ROOT / "storage"
    seed_password: str = "ChangeMe!dev-only"
    app_name: str = "paper-review-api"


@lru_cache
def get_settings() -> Settings:
    return Settings()
