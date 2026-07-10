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


class CreateUserRequest(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1)
    password: str = Field(min_length=6)
    role: str = Field(default="user", pattern="^(user|admin)$")


class UpdateUserRequest(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = Field(default=None, pattern="^(user|admin)$")
    is_active: Optional[bool] = None
    # When set, resets the password and forces a change on next login.
    new_password: Optional[str] = Field(default=None, min_length=6)
