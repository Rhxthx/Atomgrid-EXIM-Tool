"""Password hashing, JWT sessions, and FastAPI auth guards."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import bcrypt
import jwt
from fastapi import Cookie, Depends, HTTPException, Response, status

from app.auth import store
from app.config import Settings, get_settings

log = logging.getLogger(__name__)

COOKIE_NAME = "exim_session"
_ALGO = "HS256"

# Daily export quotas reset at local midnight in this zone.
_QUOTA_TZ = ZoneInfo("Asia/Kolkata")


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------
def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:  # noqa: BLE001 — malformed hash, etc.
        return False


# ---------------------------------------------------------------------------
# JWT session tokens
# ---------------------------------------------------------------------------
def create_token(user: dict, settings: Settings) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user["id"]),
        "email": user["email"],
        "role": user["role"],
        "iat": now,
        "exp": now + timedelta(hours=settings.jwt_expire_hours),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=_ALGO)


def _decode(token: str, settings: Settings) -> dict | None:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[_ALGO])
    except jwt.PyJWTError:
        return None


def set_session_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=settings.jwt_expire_hours * 3600,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")


# ---------------------------------------------------------------------------
# Guards (FastAPI dependencies)
# ---------------------------------------------------------------------------
_UNAUTH = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Cookie"},
)


def get_current_user(
    exim_session: str | None = Cookie(default=None),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Resolve the logged-in user from the session cookie, or raise 401."""
    if not exim_session:
        raise _UNAUTH
    claims = _decode(exim_session, settings)
    if not claims:
        raise _UNAUTH
    user = store.get_by_id(int(claims["sub"]))
    if not user or not user["is_active"]:
        raise _UNAUTH
    return user


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Admin access required")
    return user


# ---------------------------------------------------------------------------
# Daily export quota
# ---------------------------------------------------------------------------
def _quota_day_bounds() -> tuple[str, str]:
    """Return (utc_iso_of_today's_local_midnight, iso_of_next_local_midnight)."""
    now_local = datetime.now(_QUOTA_TZ)
    start_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    next_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc).isoformat(), next_local.isoformat()


def effective_daily_limit(user: dict, settings: Settings) -> int | None:
    """Downloads/day allowed for this user. ``None`` means unlimited (admins).

    A per-user ``daily_export_limit`` (incl. 0 = blocked) overrides the global
    default; ``None`` on the record falls back to the configured default.
    """
    if user.get("role") == "admin":
        return None
    lim = user.get("daily_export_limit")
    return settings.user_daily_exports if lim is None else int(lim)


def export_quota(user: dict, settings: Settings) -> dict:
    """Current export-quota state for the UI / enforcement."""
    limit = effective_daily_limit(user, settings)
    start_utc, resets_at = _quota_day_bounds()
    used = store.count_exports_since(user["id"], start_utc)
    if limit is None:
        return {"unlimited": True, "limit": None, "used": used,
                "remaining": None, "resets_at": resets_at}
    return {"unlimited": False, "limit": limit, "used": used,
            "remaining": max(0, limit - used), "resets_at": resets_at}


def check_and_record_export(user: dict, settings: Settings, *, rows: int,
                            dataset: str) -> None:
    """Enforce the daily limit for non-admins, then log the download.

    Raises HTTP 429 when the user is already at their limit. Admins are never
    blocked but their downloads are still logged for the audit trail.
    """
    limit = effective_daily_limit(user, settings)
    if limit is not None:
        start_utc, resets_at = _quota_day_bounds()
        used = store.count_exports_since(user["id"], start_utc)
        if used >= limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=(f"Daily download limit reached ({limit} per day). "
                        "It resets at midnight IST."),
            )
    store.record_export(user["id"], rows=rows, dataset=dataset)


# ---------------------------------------------------------------------------
# First-run bootstrap
# ---------------------------------------------------------------------------
def seed_admin_if_empty(settings: Settings) -> None:
    """Create the initial admin from env vars if the user store is empty."""
    if store.count_users() > 0:
        return
    if not settings.admin_password:
        log.warning(
            "No users exist and EXIM_ADMIN_PASSWORD is not set — set it once to "
            "bootstrap the first admin (%s).", settings.admin_email,
        )
        return
    store.create_user(
        email=settings.admin_email,
        name="Administrator",
        password_hash=hash_password(settings.admin_password),
        role="admin",
        must_change_password=True,
    )
    log.info("Seeded initial admin user: %s", settings.admin_email)
