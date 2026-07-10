"""Password hashing, JWT sessions, and FastAPI auth guards."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Cookie, Depends, HTTPException, Response, status

from app.auth import store
from app.config import Settings, get_settings

log = logging.getLogger(__name__)

COOKIE_NAME = "exim_session"
_ALGO = "HS256"


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
