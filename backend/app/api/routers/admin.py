"""Admin user-management endpoints (require an admin session)."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import security, store
from app.schemas.auth import CreateUserRequest, UpdateUserRequest, UserOut

log = logging.getLogger(__name__)

# Every route here requires an admin session.
router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(security.require_admin)],
)


@router.get("/users", response_model=list[UserOut], summary="List all users")
def list_users() -> list[UserOut]:
    return [UserOut(**u) for u in store.list_users()]


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED,
             summary="Create a user")
def create_user(body: CreateUserRequest) -> UserOut:
    if store.get_by_email(body.email):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="A user with that email already exists")
    user = store.create_user(
        email=str(body.email),
        name=body.name,
        password_hash=security.hash_password(body.password),
        role=body.role,
        must_change_password=True,   # user changes the temp password on first login
    )
    return UserOut(**user)


@router.patch("/users/{user_id}", response_model=UserOut, summary="Update a user")
def update_user(
    user_id: int,
    body: UpdateUserRequest,
    admin: dict = Depends(security.require_admin),
) -> UserOut:
    target = store.get_by_id(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    # Don't let an admin lock themselves out (demote/deactivate self).
    if target["id"] == admin["id"] and (body.role == "user" or body.is_active is False):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="You cannot demote or deactivate your own account")
    fields: dict = {}
    if body.name is not None:
        fields["name"] = body.name
    if body.role is not None:
        fields["role"] = body.role
    if body.is_active is not None:
        fields["is_active"] = body.is_active
    if body.new_password:
        fields["password_hash"] = security.hash_password(body.new_password)
        fields["must_change_password"] = True
    return UserOut(**store.update_user(user_id, **fields))


@router.delete("/users/{user_id}", summary="Delete a user")
def delete_user(user_id: int, admin: dict = Depends(security.require_admin)) -> dict:
    if user_id == admin["id"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="You cannot delete your own account")
    if not store.get_by_id(user_id):
        raise HTTPException(status_code=404, detail="User not found")
    store.delete_user(user_id)
    return {"status": "deleted"}
