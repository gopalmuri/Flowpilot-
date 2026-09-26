import re
import uuid
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, EmailStr, Field, field_validator


class UserRegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=10, max_length=128)
    full_name: str = Field(..., min_length=2, max_length=255)
    organization_name: Optional[str] = Field(None, min_length=2, max_length=255)

    @field_validator("password")
    @classmethod
    def validate_password_complexity(cls, v: str) -> str:
        if len(v) < 10:
            raise ValueError("Password must be at least 10 characters long")
        if not re.search(r"[A-Z]", v):
            raise ValueError("Password must contain at least one uppercase letter (A-Z)")
        if not re.search(r"[a-z]", v):
            raise ValueError("Password must contain at least one lowercase letter (a-z)")
        if not re.search(r"[0-9]", v):
            raise ValueError("Password must contain at least one numeric digit (0-9)")
        if not re.search(r"[!@#$%^&*(),.?\":{}|<>\-_=+;'\\[\]/`~]", v):
            raise ValueError("Password must contain at least one special character (!@#$%^&* etc.)")
        return v


class UserLoginRequest(BaseModel):
    email: EmailStr
    password: str
    organization_id: Optional[uuid.UUID] = None


class RefreshTokenRequest(BaseModel):
    refresh_token: Optional[str] = ""


class LogoutRequest(BaseModel):
    refresh_token: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int = 1800


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    is_active: bool
    is_superuser: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class UserOrganizationSummary(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    role: str

    model_config = {"from_attributes": True}


class UserMeResponse(BaseModel):
    user: UserResponse
    organizations: List[UserOrganizationSummary]
    active_organization_id: Optional[uuid.UUID] = None
    active_role: Optional[str] = None
