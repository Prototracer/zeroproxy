from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field


class CreateClassRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    code: str = Field(min_length=1, max_length=50)
    semester: str = Field(min_length=1, max_length=50)
    student_roll_numbers: list[str] = Field(default_factory=list)


class AddStudentsToClassRequest(BaseModel):
    roll_numbers: list[str] = Field(min_length=1)


class ClassResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    code: str
    semester: str
    faculty_id: int
    student_count: int = 0
    session: str = "No active session"
    active_session_id: int | None = None
    join_code: str | None = None
    join_code_enabled: bool | None = True


class StudentClassItem(BaseModel):
    id: int
    name: str
    code: str
    semester: str
    faculty_name: str | None = None
    faculty_email: str | None = None
    enrolled_at: datetime
    active: bool


class LeaveClassRequest(BaseModel):
    reason: str | None = None


class RemoveStudentFromClassRequest(BaseModel):
    reason: str = Field(min_length=2, max_length=500)


class ClassStudentItem(BaseModel):
    enrollment_id: int
    student_id: int
    name: str
    full_name: str
    roll_no: str
    email: str
    active: bool
    enrolled_at: datetime
    left_at: datetime | None = None
    ended_by: str | None = None
    reason: str | None = None


class ClassStudentsResponse(BaseModel):
    class_id: int
    class_name: str
    class_code: str
    active_students: list[ClassStudentItem]
    removed_students: list[ClassStudentItem]
