"""Authentication endpoints: login, logout, me, change-password."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.auth import security, store
from app.config import Settings, get_settings
from app.schemas.auth import ChangePasswordRequest, LoginRequest, UserOut

log = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


def _public(user: dict) -> UserOut:
    return UserOut(**user)


@router.post("/login", response_model=UserOut, summary="Log in")
def login(
    body: LoginRequest,
    response: Response,
    settings: Settings = Depends(get_settings),
) -> UserOut:
    user = store.get_by_email(body.email)
    if (not user or not user["is_active"]
            or not security.verify_password(body.password, user["password_hash"])):
        # Same message for all failure modes — don't leak which part was wrong.
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Invalid email or password")
    token = security.create_token(user, settings)
    security.set_session_cookie(response, token, settings)
    store.touch_last_login(user["id"])
    return _public(user)


@router.post("/logout", summary="Log out")
def logout(response: Response) -> dict:
    security.clear_session_cookie(response)
    return {"status": "ok"}


@router.get("/me", response_model=UserOut, summary="Current user")
def me(user: dict = Depends(security.get_current_user)) -> UserOut:
    return _public(user)


@router.post("/change-password", response_model=UserOut, summary="Change own password")
def change_password(
    body: ChangePasswordRequest,
    user: dict = Depends(security.get_current_user),
) -> UserOut:
    if not security.verify_password(body.current_password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Current password is incorrect")
    updated = store.update_user(
        user["id"],
        password_hash=security.hash_password(body.new_password),
        must_change_password=False,
    )
    return _public(updated)
