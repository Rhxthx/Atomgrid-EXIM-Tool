"""Application settings.

Driven by environment variables with sensible defaults so the service runs
out-of-the-box pointing at the Phase 1 ``output/trade_database.duckdb``.

Override with env vars:
    EXIM_DUCKDB_PATH=/path/to/trade_database.duckdb
    EXIM_LOG_DIR=/path/to/logs
    EXIM_DEFAULT_PAGE_SIZE=50
    EXIM_MAX_PAGE_SIZE=500
    EXIM_ALLOW_ORIGINS=*           # CSV of allowed CORS origins
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = BACKEND_ROOT.parent
DEFAULT_DUCKDB = PROJECT_ROOT / "output" / "trade_database.duckdb"
DEFAULT_LOG_DIR = BACKEND_ROOT / "logs"
# User/auth store — a SEPARATE SQLite file that must survive trade-data
# rebuilds (which delete trade_database.duckdb). On cloud, point this at the
# persistent volume via EXIM_AUTH_DB_PATH.
DEFAULT_AUTH_DB = PROJECT_ROOT / "output" / "auth.db"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="EXIM_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    duckdb_path: Path = Field(default=DEFAULT_DUCKDB)
    log_dir: Path = Field(default=DEFAULT_LOG_DIR)

    default_page_size: int = Field(default=50, ge=1, le=1000)
    max_page_size: int = Field(default=500, ge=1, le=10000)

    # Max rows a NON-admin user may download in one CSV export. Admins always
    # export the full filtered result set (up to the safety cap). Override with
    # EXIM_USER_EXPORT_CAP. Mirrored to the frontend via /stats.
    user_export_cap: int = Field(default=50, ge=1)

    # Default max CSV downloads a NON-admin user may run per day (each is
    # <= user_export_cap rows). Per-user overrides live on the user record
    # (daily_export_limit); this is the fallback. 0 blocks downloads; admins
    # are unlimited. Override with EXIM_USER_DAILY_EXPORTS. Mirrored via /stats.
    user_daily_exports: int = Field(default=10, ge=0)

    # Comma-separated list of allowed CORS origins.  "*" disables the check.
    allow_origins: str = Field(default="*")

    # Read-only by design — the API never mutates the database.
    read_only: bool = True

    # Cache TTL (seconds) for distinct-name lists used by /suggest and /similar.
    distinct_cache_ttl: int = Field(default=600, ge=0)

    # ---- Authentication ---------------------------------------------------
    auth_db_path: Path = Field(default=DEFAULT_AUTH_DB)
    # Secret for signing session JWTs. MUST be overridden in production
    # (EXIM_JWT_SECRET=<long random string>).
    jwt_secret: str = Field(default="dev-insecure-change-me")
    jwt_expire_hours: int = Field(default=12, ge=1)
    # Send the session cookie only over HTTPS. Set EXIM_COOKIE_SECURE=true in
    # production (Railway/behind HTTPS); keep false for http://localhost dev.
    cookie_secure: bool = Field(default=False)
    # First-run admin bootstrap: if the user store is empty, seed this admin.
    admin_email: str = Field(default="admin@atomgrid.in")
    admin_password: str = Field(default="")   # empty => skip auto-seed

    @field_validator("duckdb_path", "log_dir", "auth_db_path", mode="after")
    @classmethod
    def _to_abs(cls, v: Path) -> Path:
        return v.expanduser().resolve()

    @property
    def cors_origins(self) -> list[str]:
        raw = self.allow_origins.strip()
        if raw == "*" or not raw:
            return ["*"]
        return [o.strip() for o in raw.split(",") if o.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Singleton accessor — FastAPI ``Depends(get_settings)``."""
    return Settings()
