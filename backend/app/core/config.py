from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        hide_input_in_errors=True,
    )

    database_url: str = (
        "postgresql+asyncpg://paper_review:paper_review_dev@127.0.0.1:5433/paper_review"
    )
    app_env: Literal["development", "production"] = "development"
    migration_database_url: str | None = None
    business_database_url: str | None = None
    auth_database_url: str | None = None
    jwt_secret: str = "dev-only-change-me-please-use-32bytes+"
    jwt_access_ttl_seconds: int = 1800
    jwt_refresh_ttl_seconds: int = 1_209_600
    max_upload_bytes: int = Field(default=50 * 1024 * 1024, gt=0)
    storage_root: Path = REPO_ROOT / "storage"
    seed_password: str = "ChangeMe!dev-only"
    app_name: str = "paper-review-api"

    @model_validator(mode="after")
    def require_production_database_roles(self):
        if self.app_env == "production":
            urls = (self.migration_database_url, self.business_database_url, self.auth_database_url)
            if not all(urls):
                raise ValueError("production requires migration, business and auth database URLs")
            usernames = [urlparse(url).username for url in urls]
            if None in usernames or len(set(usernames)) != 3:
                raise ValueError("production database URLs require three distinct login roles")
            if (self.jwt_secret == type(self).model_fields['jwt_secret'].default
                    or not self.jwt_secret.strip()
                    or len(self.jwt_secret.encode('utf-8')) < 32):
                raise ValueError("production JWT_SECRET requires a non-default secret of at least 32 bytes")
            if (self.seed_password == type(self).model_fields['seed_password'].default
                    or not self.seed_password.strip()):
                raise ValueError("production SEED_PASSWORD must not be default or blank")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
