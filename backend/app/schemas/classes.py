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


