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
from app.models.attendance_correction import AttendanceCorrection
from app.models.attendance_log import AttendanceLog
from app.models.attendance_session import AttendanceSession
from app.models.audit import AuditEvent
from app.models.class_enrollment import ClassEnrollment
from app.models.course import Course
from app.models.override import Override
from app.models.user import User
from app.schemas.attendance import (
    AttendanceCorrectionItem,
    AttendanceCorrectionRequest,
    CreateSessionRequest,
    LiveAttendanceResponse,
    MarkedStudentEntry,
    NotMarkedStudentEntry,
    OverrideAttendanceRequest,
    OverrideAttendanceResponse,
    QRTokenResponse,
    SessionResponse,
    SessionUnifiedAttendanceResponse,
)
from app.services.attendance_resolution import resolve_session_effective_attendance
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

VALID_REASONS = {"hackathon", "sports", "medical", "no_biometric_consent", "other"}


def _normalize_override_reason(reason_str: str, note_str: str | None) -> tuple[str, str | None]:
    r = reason_str.strip().lower()
    if r in VALID_REASONS:
        if r == "other" and (not note_str or not note_str.strip()):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Note is required when reason is 'other'",
            )
        return r, (note_str.strip() if note_str else None)

    note = note_str or reason_str
    if "med" in r:
        return "medical", note
    elif "sport" in r or "duty" in r:
        return "sports", note
    elif "hack" in r:
        return "hackathon", note
    elif "consent" in r or "bio" in r:
        return "no_biometric_consent", note
    else:
        return "other", note


@router.get("/{session_id}/live", response_model=LiveAttendanceResponse)
async def get_live_count(
    session_id: int,
    faculty: User = Depends(require_role("faculty")),
    db: AsyncSession = Depends(get_db),
):
    """
    Return the live attendance data and student rosters for the session (handbook §7).
    Only the session owner can call this. Out-of-scope faculty returns 404.
    """
    session = await _get_owned_session(session_id, faculty, db)

    # 1. Fetch course details
    course_res = await db.execute(
        select(Course).where(Course.id == session.course_id)
    )
    course = course_res.scalar_one_or_none()
    class_name = course.name if course else "Unknown Class"

    # 2. Fetch enrolled active students
    students_res = await db.execute(
        select(User)
        .join(ClassEnrollment, ClassEnrollment.student_id == User.id)
        .where(
            ClassEnrollment.course_id == session.course_id,
            ClassEnrollment.tenant_id == faculty.tenant_id,
            ClassEnrollment.active.is_(True),
            User.role == "student",
            User.tenant_id == faculty.tenant_id,
        )
        .order_by(User.roll_no.asc(), User.name.asc())
    )
    enrolled_students = list(students_res.scalars().all())
    student_map = {st.id: st for st in enrolled_students}
    total_in_class = len(enrolled_students)

    # 3. Fetch attendance logs for this session (newest first)
    logs_res = await db.execute(
        select(AttendanceLog)
        .where(
            AttendanceLog.session_id == session.id,
            AttendanceLog.tenant_id == faculty.tenant_id,
        )
        .order_by(AttendanceLog.marked_at.desc())
    )
    logs = list(logs_res.scalars().all())

    # 4. Fetch overrides for reasons
    overrides_res = await db.execute(
        select(Override).where(
            Override.session_id == session.id,
            Override.tenant_id == faculty.tenant_id,
        )
    )
    overrides = list(overrides_res.scalars().all())
    override_map = {ov.student_id: ov.reason for ov in overrides}

    # 5. Build marked list
    marked: list[MarkedStudentEntry] = []
    marked_ids: set[int] = set()
    records: list[dict] = []

    for log in logs:
        marked_ids.add(log.student_id)
        st = student_map.get(log.student_id)
        name = st.name if st else f"Student #{log.student_id}"
        roll_no = st.roll_no if st else str(log.student_id)
        reason = override_map.get(log.student_id)

        marked.append(
            MarkedStudentEntry(
                student_id=log.student_id,
                name=name,
                roll_no=roll_no,
                marked_at=log.marked_at,
                source=log.source,
                reason=reason,
            )
        )
        records.append({
            "student_id": log.student_id,
            "marked_at": log.marked_at.isoformat() if hasattr(log.marked_at, "isoformat") else str(log.marked_at),
            "source": log.source,
        })

    # 6. Build not_marked list
    not_marked = [
        NotMarkedStudentEntry(
            student_id=st.id,
            name=st.name,
            roll_no=st.roll_no,
        )
        for st in enrolled_students
        if st.id not in marked_ids
    ]

    return LiveAttendanceResponse(
        session_id=session.id,
        class_name=class_name,
        course_name=class_name,
        session_status=session.status,
        status=session.status,
        total_in_class=total_in_class,
        marked_count=len(marked),
        present_count=len(marked),
        marked=marked,
        not_marked=not_marked,
        records=records,
    )


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
    Supports single or bulk marking (up to 50 students).
    """
    session = await _get_owned_session(session_id, faculty, db)

    # 1. Normalize reason and note
    reason, note = _normalize_override_reason(body.reason, body.note)

    # 2. Extract and deduplicate student IDs
    raw_ids: list[int] = []
    if body.student_ids:
        raw_ids.extend(body.student_ids)
    if body.student_id is not None:
        raw_ids.append(body.student_id)

    if not raw_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="At least one student_id or student_ids must be provided",
        )

    target_ids = list(dict.fromkeys(raw_ids))
    if len(target_ids) > 50:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Cannot override more than 50 students in a single request",
        )

    # 3. Check students and enrollments
    if len(target_ids) == 1:
        single_id = target_ids[0]
        # Query 2: student check
        student_result = await db.execute(
            select(User).where(
                User.id == single_id,
                User.tenant_id == faculty.tenant_id,
                User.role == "student",
            )
        )
        if student_result.scalar_one_or_none() is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Student not found",
            )

        # Query 3: enrollment check
        enrollment_result = await db.execute(
            select(ClassEnrollment.id).where(
                ClassEnrollment.course_id == session.course_id,
                ClassEnrollment.student_id == single_id,
                ClassEnrollment.tenant_id == faculty.tenant_id,
                ClassEnrollment.active.is_(True),
            )
        )
        if enrollment_result.scalar_one_or_none() is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Student not found",
            )

        # Query 4: existing log check
        existing_log = await db.execute(
            select(AttendanceLog.id).where(
                AttendanceLog.session_id == session.id,
                AttendanceLog.student_id == single_id,
            )
        )
        is_already_marked = existing_log.scalar_one_or_none() is not None

        if is_already_marked:
            if body.student_ids is None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="already_marked",
                )
            already_marked = [single_id]
            to_mark = []
        else:
            already_marked = []
            to_mark = [single_id]
    else:
        # Bulk queries
        students_res = await db.execute(
            select(User.id).where(
                User.id.in_(target_ids),
                User.tenant_id == faculty.tenant_id,
                User.role == "student",
            )
        )
        found_students = set(students_res.scalars().all())
        if len(found_students) != len(target_ids):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="One or more students not found",
            )

        enrollments_res = await db.execute(
            select(ClassEnrollment.student_id).where(
                ClassEnrollment.course_id == session.course_id,
                ClassEnrollment.student_id.in_(target_ids),
                ClassEnrollment.tenant_id == faculty.tenant_id,
                ClassEnrollment.active.is_(True),
            )
        )
        enrolled_ids = set(enrollments_res.scalars().all())
        if len(enrolled_ids) != len(target_ids):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="One or more students not found in class",
            )

        existing_logs_res = await db.execute(
            select(AttendanceLog.student_id).where(
                AttendanceLog.session_id == session.id,
                AttendanceLog.student_id.in_(target_ids),
            )
        )
        already_marked_set = set(existing_logs_res.scalars().all())
        already_marked = [sid for sid in target_ids if sid in already_marked_set]
        to_mark = [sid for sid in target_ids if sid not in already_marked_set]

    now = datetime.now(timezone.utc)
    newly_marked: list[int] = []

    # 5. Insert AttendanceLog, Override, and AuditEvent in one atomic transaction
    for sid in to_mark:
        log = AttendanceLog(
            tenant_id=faculty.tenant_id,
            session_id=session.id,
            student_id=sid,
            marked_at=now,
            source="override",
            ip="faculty_override",
            match_distance=None,
            challenge=None,
        )
        db.add(log)

        override = Override(
            tenant_id=faculty.tenant_id,
            session_id=session.id,
            student_id=sid,
            actor_id=faculty.id,
            reason=reason,
            note=note,
            created_at=now,
        )
        db.add(override)

        audit = AuditEvent(
            tenant_id=faculty.tenant_id,
            actor_id=faculty.id,
            action="attendance_override",
            target=f"student:{sid}",
            meta={"session_id": session.id, "reason": reason, "note": note},
            created_at=now,
        )
        db.add(audit)
        newly_marked.append(sid)

    if newly_marked:
        await db.commit()

    return OverrideAttendanceResponse(
        status="marked",
        session_id=session.id,
        marked=newly_marked,
        already_marked=already_marked,
        marked_count=len(newly_marked),
        already_marked_count=len(already_marked),
        student_id=newly_marked[0] if newly_marked else (already_marked[0] if already_marked else None),
        marked_at=now,
        source="override",
        reason=reason,
    )


# ── Helper ───────────────────────────────────────────────────────────────────

async def _get_owned_session(
    session_id: int,
    faculty: User,
    db: AsyncSession,
) -> AttendanceSession:
    """
    Load a session and confirm the requesting faculty owns it.
    Raises 404 if not found or if it belongs to another faculty member (scoping §8).
    """
    result = await db.execute(
        select(AttendanceSession).where(
            AttendanceSession.id == session_id,
            AttendanceSession.tenant_id == faculty.tenant_id,
        )
    )
    session = result.scalar_one_or_none()

    if session is None or session.faculty_id != faculty.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found",
        )

    return session


# ── Attendance Corrections & Unified Attendance (Phase 3) ───────────────────

@router.get("/{session_id}/attendance", response_model=SessionUnifiedAttendanceResponse)
async def get_session_attendance(
    session_id: int,
    faculty: User = Depends(require_role("faculty")),
    db: AsyncSession = Depends(get_db),
):
    """
    Get unified effective attendance for a session.
    Latest correction wins (present or absent) > AttendanceLog (present) > Absent.
    """
    session = await _get_owned_session(session_id, faculty, db)
    course, session, students = await resolve_session_effective_attendance(
        db, session.id, faculty.tenant_id
    )
    if not course or not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session or course not found",
        )

    present_count = sum(1 for s in students if s.status == "present")
    absent_count = max(0, len(students) - present_count)

    return SessionUnifiedAttendanceResponse(
        session_id=session.id,
        class_id=course.id,
        class_name=course.name,
        class_code=course.code,
        session_status=session.status,
        started_at=session.started_at,
        ended_at=session.ended_at,
        total_students=len(students),
        present_count=present_count,
        absent_count=absent_count,
        students=students,
    )


@router.post(
    "/{session_id}/corrections",
    response_model=AttendanceCorrectionItem,
    status_code=status.HTTP_201_CREATED,
)
async def create_attendance_correction(
    session_id: int,
    body: AttendanceCorrectionRequest,
    faculty: User = Depends(require_role("faculty")),
    db: AsyncSession = Depends(get_db),
):
    """
    Append an attendance correction (present or absent) for a student in this session.
    Append-only with mandatory reason and audit log.
    """
    session = await _get_owned_session(session_id, faculty, db)

    clean_reason = body.reason.strip()
    if len(clean_reason) < 3:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Correction reason must be at least 3 characters long",
        )

    student_res = await db.execute(
        select(User).where(
            User.id == body.student_id,
            User.tenant_id == faculty.tenant_id,
            User.role == "student",
        )
    )
    student = student_res.scalar_one_or_none()
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student not found",
        )

    now = datetime.now(timezone.utc)
    correction = AttendanceCorrection(
        tenant_id=faculty.tenant_id,
        session_id=session.id,
        student_id=body.student_id,
        faculty_id=faculty.id,
        status=body.status,
        reason=clean_reason,
        created_at=now,
    )
    db.add(correction)

    audit = AuditEvent(
        tenant_id=faculty.tenant_id,
        actor_id=faculty.id,
        action="attendance_corrected",
        target=f"session:{session.id}:user:{body.student_id}",
        meta={
            "session_id": session.id,
            "status": body.status,
            "reason": clean_reason,
        },
        created_at=now,
    )
    db.add(audit)

    await db.commit()
    await db.refresh(correction)
    return correction

