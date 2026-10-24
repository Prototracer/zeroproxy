from datetime import datetime
from pydantic import BaseModel, ConfigDict, EmailStr


class CreateJoinRequest(BaseModel):
    join_code: str | None = None
    faculty_email: EmailStr | None = None
    course_code: str | None = None



class JoinRequestMessageResponse(BaseModel):
    status: str
    message: str


class StudentJoinRequestItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    faculty_id: int | None = None
    faculty_email: str | None = None
    faculty_name: str | None = None
    class_id: int | None = None
    class_name: str | None = None
    course_code: str | None = None
    status: str
    created_at: datetime
    decided_at: datetime | None = None
    rejection_reason: str | None = None


class FacultyJoinRequestItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    student_id: int
    student_name: str
    student_roll_no: str
    student_email: str
    created_at: datetime
    status: str
    class_id: int | None = None
    decided_at: datetime | None = None


class ApproveJoinRequest(BaseModel):
    class_id: int


class RejectJoinRequest(BaseModel):
    reason: str | None = None
