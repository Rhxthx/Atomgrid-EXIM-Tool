"""Auth / user-management request & response models."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    email: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6)


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    role: str
    is_active: bool
    must_change_password: bool
    created_at: str
    last_login: Optional[str] = None
    # Downloads/day for this user; null = use the global default, 0 = blocked.
    daily_export_limit: Optional[int] = None


class CreateUserRequest(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1)
    password: str = Field(min_length=6)
    role: str = Field(default="user", pattern="^(user|admin)$")
    # null = use global default; 0 = block downloads; N = N downloads/day.
    daily_export_limit: Optional[int] = Field(default=None, ge=0)


class UpdateUserRequest(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = Field(default=None, pattern="^(user|admin)$")
    is_active: Optional[bool] = None
    # When set, resets the password and forces a change on next login.
    new_password: Optional[str] = Field(default=None, min_length=6)
    # Sent explicitly (incl. null to reset to default); applied via
    # model_fields_set in the router so "not sent" != "set to null".
    daily_export_limit: Optional[int] = Field(default=None, ge=0)
