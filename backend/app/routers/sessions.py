"""
Sessions router — faculty creates and manages attendance sessions.

Endpoints (handbook §7):
  POST   /sessions              — faculty creates a session for their course
  POST   /sessions/{id}/end    — faculty ends their session
  GET    /sessions/{id}/qr     — session owner polls for current QR token
  GET    /sessions/{id}/live   — session owner gets present count + list
  POST   /sessions/{id}/override — manual attendance override with reason (handbook §7)
"""

from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_role
from app.db import get_db
from app.models.attendance_log import AttendanceLog
from app.models.attendance_session import AttendanceSession
from app.models.class_enrollment import ClassEnrollment
from app.models.course import Course
from app.models.user import User
from app.schemas.attendance import (
    CreateSessionRequest,
    OverrideAttendanceRequest,
    OverrideAttendanceResponse,
    QRTokenResponse,
    SessionResponse,
)
from app.services.qr_service import generate_qr_payload

router = APIRouter(prefix="/sessions", tags=["Sessions"])


# ── POST /sessions ───────────────────────────────────────────────────────────

@router.post("", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def create_session(
    body: CreateSessionRequest,
    faculty: User = Depends(require_role("faculty")),
    db: AsyncSession = Depends(get_db),
):
    """
    Faculty creates a new attendance session for a course they own.

    Authorization:
      - Course must belong to the faculty member's tenant.
      - Faculty must be the course's assigned faculty_id.
    """
    result = await db.execute(
        select(Course).where(
            Course.id == body.course_id,
            Course.tenant_id == faculty.tenant_id,
            Course.faculty_id == faculty.id,
        )
    )
    course = result.scalar_one_or_none()

    if course is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Course not found or not authorized",
        )

    session = AttendanceSession(
        tenant_id=faculty.tenant_id,
        course_id=course.id,
        faculty_id=faculty.id,
        status="active",
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


# ── POST /sessions/{id}/end ──────────────────────────────────────────────────

@router.post("/{session_id}/end", response_model=SessionResponse)
async def end_session(
    session_id: int,
    faculty: User = Depends(require_role("faculty")),
    db: AsyncSession = Depends(get_db),
):
    """Faculty ends their own session. After this, QR/scan/submit all reject."""
    session = await _get_owned_session(session_id, faculty, db)

    if session.status == "ended":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="session_ended",
        )

    session.status = "ended"
    session.ended_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(session)
    return session


# ── GET /sessions/{id}/qr ────────────────────────────────────────────────────

@router.get("/{session_id}/qr", response_model=QRTokenResponse)
async def get_qr_token(
    session_id: int,
    faculty: User = Depends(require_role("faculty")),
    db: AsyncSession = Depends(get_db),
):
    """
    Return the current rotating QR token for the session owner.

    The faculty page polls this when the previous token expires (handbook §1 "QR delivery").
    Rate limiting is applied by slowapi on this route (handbook §8 flaw #6).
    Students cannot call this because require_role("faculty") is enforced.
    """
    session = await _get_owned_session(session_id, faculty, db)

    if session.status == "ended":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="session_ended",
        )

    payload = generate_qr_payload(session.id)
    return QRTokenResponse(**payload)


# ── GET /sessions/{id}/live ──────────────────────────────────────────────────

@router.get("/{session_id}/live")
async def get_live_count(
    session_id: int,
    faculty: User = Depends(require_role("faculty")),
    db: AsyncSession = Depends(get_db),
):
    """
    Return the current attendance count for the session (handbook §7).
    Only the session owner can call this.
    """
    session = await _get_owned_session(session_id, faculty, db)

    result = await db.execute(
        select(AttendanceLog).where(
            AttendanceLog.session_id == session.id,
            AttendanceLog.tenant_id == faculty.tenant_id,
        )
    )
    logs = result.scalars().all()

    return {
        "session_id": session.id,
        "status": session.status,
        "present_count": len(logs),
        "records": [
            {
                "student_id": log.student_id,
                "marked_at": log.marked_at.isoformat(),
                "source": log.source,
            }
            for log in logs
        ],
    }


# ── POST /sessions/{id}/override ─────────────────────────────────────────────

@router.post(
    "/{session_id}/override",
    response_model=OverrideAttendanceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def override_attendance(
    session_id: int,
    body: OverrideAttendanceRequest,
    faculty: User = Depends(require_role("faculty")),
    db: AsyncSession = Depends(get_db),
):
    """
    Manual attendance by faculty with reason and audit (handbook §7).
    Allowed for the session's own faculty even after the session ended
    (late medical or duty cases); logged with source='override'.
    """
    session = await _get_owned_session(session_id, faculty, db)

    # 1. Verify student exists in the same tenant and is a student
    student_result = await db.execute(
        select(User).where(
            User.id == body.student_id,
            User.tenant_id == faculty.tenant_id,
            User.role == "student",
        )
    )
    student = student_result.scalar_one_or_none()
    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student not found",
        )

    # 2. Verify student is enrolled in the session's course
    enrollment_result = await db.execute(
        select(ClassEnrollment.id).where(
            ClassEnrollment.course_id == session.course_id,
            ClassEnrollment.student_id == student.id,
            ClassEnrollment.tenant_id == faculty.tenant_id,
            ClassEnrollment.active.is_(True),
        )
    )
    if enrollment_result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student not found",
        )

    # 3. Check duplicate attendance
    existing_log = await db.execute(
        select(AttendanceLog.id).where(
            AttendanceLog.session_id == session.id,
            AttendanceLog.student_id == student.id,
        )
    )
    if existing_log.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="already_marked",
        )

    now = datetime.now(timezone.utc)
    log = AttendanceLog(
        tenant_id=faculty.tenant_id,
        session_id=session.id,
        student_id=student.id,
        marked_at=now,
        source="override",
        ip="faculty_override",
        match_distance=None,
        challenge=None,
    )
    db.add(log)
    await db.commit()
    await db.refresh(log)

    return OverrideAttendanceResponse(
        status="marked",
        session_id=session.id,
        student_id=student.id,
        marked_at=log.marked_at,
        source="override",
        reason=body.reason,
    )


# ── Helper ───────────────────────────────────────────────────────────────────

async def _get_owned_session(
    session_id: int,
    faculty: User,
    db: AsyncSession,
) -> AttendanceSession:
    """
    Load a session and confirm the requesting faculty owns it.
    Raises 404 if not found, 403 if it belongs to another faculty member.
    """
    result = await db.execute(
        select(AttendanceSession).where(
            AttendanceSession.id == session_id,
            AttendanceSession.tenant_id == faculty.tenant_id,
        )
    )
    session = result.scalar_one_or_none()

    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found",
        )

    if session.faculty_id != faculty.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to access this session",
        )

    return session
