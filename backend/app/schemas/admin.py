from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, EmailStr, Field


class CreateFacultyRequest(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    email: EmailStr
    roll_no: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=8, max_length=128)


class UpdateUserStatusRequest(BaseModel):
    status: Literal["active", "suspended", "pending"]


class ResetUserPasswordRequest(BaseModel):
    temporary_password: str | None = Field(default=None, min_length=8, max_length=128)


class AdminUserListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    roll_no: str
    name: str
    email: str
    role: str
    status: str
    must_change_password: bool = False
    has_face_vector: bool = False
    created_at: datetime | None = None


class AdminUserListResponse(BaseModel):
    users: list[AdminUserListItem]
    total: int
    page: int
    limit: int


class AuditEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    actor_id: int | None
    actor_name: str | None = None
    actor_email: str | None = None
    action: str
    target: str | None
    meta: dict | None
    created_at: datetime
