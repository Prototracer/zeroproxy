"""Pydantic schemas for attendance sessions and QR token responses."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


# ── Session management ───────────────────────────────────────────────────────

class CreateSessionRequest(BaseModel):
    course_id: int = Field(gt=0)


class SessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    tenant_id: int
    course_id: int
    faculty_id: int
    started_at: datetime
    ended_at: datetime | None
    status: str


# ── QR token polling ─────────────────────────────────────────────────────────

class QRTokenResponse(BaseModel):
    """Returned by GET /sessions/{id}/qr — the faculty page polls this."""
    session_id: int
    window: int
    mac: str
    expires_in_ms: int


# ── Student scan ─────────────────────────────────────────────────────────────

class ScanRequest(BaseModel):
    """
    Student submits the raw QR payload after scanning.
    The server re-validates the HMAC and issues a scan ticket.
    """
    session_id: int = Field(gt=0)
    window: int
    mac: str = Field(min_length=1)


class ScanResponse(BaseModel):
    """Ticket + liveness challenge returned to the student after a valid scan."""
    ticket_id: str
    nonce: str
    challenge: str
    session_id: int


# ── Attendance submission ────────────────────────────────────────────────────

class DescriptorSample(BaseModel):
    """One frontal, open-eye capture (handbook §3.1)."""
    t_ms: int
    descriptor: list[float] = Field(min_length=128, max_length=128)
    eye_openness: float = Field(alias="eyeOpenness")
    yaw_deg: float = Field(alias="yawDeg")

    model_config = ConfigDict(populate_by_name=True)


class LandmarkEntry(BaseModel):
    """One frame from the landmark series (handbook §3.1)."""
    t_ms: int
    left_eye: float = Field(alias="leftEye")
    right_eye: float = Field(alias="rightEye")
    mouth_ratio: float = Field(alias="mouthRatio")
    yaw_deg: float = Field(alias="yawDeg")
    pitch_deg: float = Field(default=0.0, alias="pitchDeg")
    eyebrow_raise: float = Field(default=0.0, alias="eyebrowRaise")
    face_count: int = Field(alias="faceCount")

    model_config = ConfigDict(populate_by_name=True)


class SubmitAttendanceRequest(BaseModel):
    """
    POST /attendance/submit body — handbook §3 step 6 / §3.1.

    Body size limit (~64 KB) is enforced in the router.
    """
    ticket_id: str
    nonce: str
    challenge: str
    duration_ms: int = Field(alias="durationMs", gt=0)
    samples: list[DescriptorSample] = Field(min_length=2, max_length=3)
    landmark_series: list[LandmarkEntry] = Field(
        alias="landmarkSeries",
        max_length=80,
    )

    model_config = ConfigDict(populate_by_name=True)


class AttendanceResponse(BaseModel):
    """Returned on a successful attendance record."""
    status: Literal["marked"]
    session_id: int
    student_id: int


# ── Live Session & Headcount schemas ─────────────────────────────────────────

class MarkedStudentEntry(BaseModel):
    student_id: int
    name: str
    roll_no: str
    marked_at: datetime
    source: str
    reason: str | None = None


class NotMarkedStudentEntry(BaseModel):
    student_id: int
    name: str
    roll_no: str


class LiveAttendanceResponse(BaseModel):
    session_id: int
    class_name: str
    course_name: str
    session_status: str
    status: str
    total_in_class: int
    marked_count: int
    present_count: int
    marked: list[MarkedStudentEntry] = Field(default_factory=list)
    not_marked: list[NotMarkedStudentEntry] = Field(default_factory=list)
    records: list[dict] = Field(default_factory=list)


# ── Manual Override schemas ──────────────────────────────────────────────────

class OverrideAttendanceRequest(BaseModel):
    student_ids: list[int] | None = Field(default=None, max_length=50)
    student_id: int | None = Field(default=None, gt=0)
    reason: str = Field(min_length=1, max_length=500)
    note: str | None = None

    model_config = ConfigDict(populate_by_name=True)


class OverrideAttendanceResponse(BaseModel):
    status: Literal["marked", "success"] = "marked"
    session_id: int
    marked: list[int] = Field(default_factory=list)
    already_marked: list[int] = Field(default_factory=list)
    marked_count: int = 0
    already_marked_count: int = 0
    student_id: int | None = None
    marked_at: datetime | None = None
    source: Literal["override"] = "override"
    reason: str


