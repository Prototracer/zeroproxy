from datetime import datetime, time, timezone
import secrets
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_role
from app.core.scope import (
    get_enrollable_student_or_404,
    get_scoped_pending_students,
    get_student_in_faculty_class_or_404,
)
from app.core.security import hash_password
from app.db import get_db
from app.models.attendance_correction import AttendanceCorrection
from app.models.attendance_session import AttendanceSession
from app.models.audit import AuditEvent
from app.models.class_enrollment import ClassEnrollment
from app.models.course import Course
from app.models.face_vector import FaceVector
from app.models.join_request import JoinRequest
from app.models.user import User
from app.schemas.attendance import (
    AttendanceCorrectionItem,
    AttendanceCorrectionRequest,
    ClassSessionSummary,
    SessionUnifiedAttendanceResponse,
)
from app.schemas.auth import ResetPasswordRequest, ResetPasswordResponse, UserResponse
from app.services.attendance_export import (
    generate_attendance_csv,
    generate_attendance_xlsx,
    get_course_attendance_export_data,
)
from app.services.attendance_resolution import resolve_session_effective_attendance
from app.schemas.classes import (
    ClassResponse,
    ClassStudentItem,
    ClassStudentsResponse,
    CreateClassRequest,
    RemoveStudentFromClassRequest,
)
from app.schemas.face_enrollment import FaceEnrollmentRequest
from app.schemas.join_request import (
    ApproveJoinRequest,
    FacultyJoinRequestItem,
    RejectJoinRequest,
)
from app.services.face_enrollment_service import (
    DuplicateFaceError,
    EnrollmentDataError,
    EnrollmentServiceError,
    EnrollmentStudentNotFound,
    enroll_student,
)

router = APIRouter(prefix="/faculty", tags=["Faculty"])


# ── Join Requests ───────────────────────────────────────────────────────────

@router.get(
    "/join-requests",
    response_model=list[FacultyJoinRequestItem],
    status_code=status.HTTP_200_OK,
)
async def list_faculty_join_requests(
    faculty: User = Depends(require_role("faculty")),
    db: AsyncSession = Depends(get_db),
):
    """List join requests addressed to this faculty member."""
    query = (
        select(
            JoinRequest,
            User.name.label("student_name"),
            User.roll_no.label("student_roll_no"),
            User.email.label("student_email"),
        )
        .join(User, User.id == JoinRequest.student_id)
        .where(
            JoinRequest.faculty_id == faculty.id,
            JoinRequest.tenant_id == faculty.tenant_id,
        )
        .order_by(JoinRequest.created_at.desc())
    )
    result = await db.execute(query)
    rows = result.all()

    return [
        FacultyJoinRequestItem(
            id=jr.id,
            student_id=jr.student_id,
            student_name=name,
            student_roll_no=roll_no,
            student_email=email,
            created_at=jr.created_at,
            status=jr.status,
            class_id=jr.class_id,
            decided_at=jr.decided_at,
        )
        for jr, name, roll_no, email in rows
    ]


@router.post(
    "/join-requests/{id}/approve",
    response_model=dict,
    status_code=status.HTTP_200_OK,
)
async def approve_join_request(
    id: int,
    body: ApproveJoinRequest,
    faculty: User = Depends(require_role("faculty")),
    db: AsyncSession = Depends(get_db),
):
    """Approve a student's join request into one of the faculty member's classes.

    In ONE transaction:
    - Verify class belongs to this faculty member.
    - Set status approved, set class_id, insert into class_enrollments.
    - Do NOT change users.status (only enroll_student activates).
    - Write an audit event.
    """
    # 1. Verify class belongs to this faculty member
    class_res = await db.execute(
        select(Course).where(
            Course.id == body.class_id,
            Course.faculty_id == faculty.id,
            Course.tenant_id == faculty.tenant_id,
        )
    )
    course = class_res.scalar_one_or_none()
    if course is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Class not found or does not belong to you",
        )

    # 2. Verify join request exists and is addressed to this faculty
    jr_res = await db.execute(
        select(JoinRequest).where(
            JoinRequest.id == id,
            JoinRequest.faculty_id == faculty.id,
            JoinRequest.tenant_id == faculty.tenant_id,
        )
    )
    join_req = jr_res.scalar_one_or_none()
    if join_req is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Join request not found",
        )

    if join_req.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Join request is already {join_req.status}",
        )

    # 3. Transactional update
    now = datetime.now(timezone.utc)
    join_req.status = "approved"
    join_req.class_id = body.class_id
    join_req.decided_at = now
    join_req.decided_by = faculty.id

    # Add student to class_enrollments if not already actively enrolled
    enrollment_res = await db.execute(
        select(ClassEnrollment.id).where(
            ClassEnrollment.course_id == body.class_id,
            ClassEnrollment.student_id == join_req.student_id,
            ClassEnrollment.tenant_id == faculty.tenant_id,
            ClassEnrollment.active.is_(True),
        )
    )
    if enrollment_res.scalar_one_or_none() is None:
        db.add(
            ClassEnrollment(
                tenant_id=faculty.tenant_id,
                course_id=body.class_id,
                student_id=join_req.student_id,
                active=True,
            )
        )

    # Record audit event
    db.add(
        AuditEvent(
            tenant_id=faculty.tenant_id,
            actor_id=faculty.id,
            action="join_request_approve",
            target=str(join_req.student_id),
            meta={"join_request_id": join_req.id, "class_id": body.class_id},
        )
    )

    await db.commit()
    return {"status": "approved", "message": "Join request approved"}


@router.post(
    "/join-requests/{id}/reject",
    response_model=dict,
    status_code=status.HTTP_200_OK,
)
async def reject_join_request(
    id: int,
    body: RejectJoinRequest | None = None,
    faculty: User = Depends(require_role("faculty")),
    db: AsyncSession = Depends(get_db),
):
    """Reject a pending join request with an optional reason."""
    jr_res = await db.execute(
        select(JoinRequest).where(
            JoinRequest.id == id,
            JoinRequest.faculty_id == faculty.id,
            JoinRequest.tenant_id == faculty.tenant_id,
        )
    )
    join_req = jr_res.scalar_one_or_none()
    if join_req is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Join request not found",
        )

    if join_req.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Join request is already {join_req.status}",
        )

    now = datetime.now(timezone.utc)
    reason = body.reason if body else None
    join_req.status = "rejected"
    join_req.rejection_reason = reason
    join_req.decided_at = now
    join_req.decided_by = faculty.id

    db.add(
        AuditEvent(
            tenant_id=faculty.tenant_id,
            actor_id=faculty.id,
            action="join_request_reject",
            target=str(join_req.student_id),
            meta={"join_request_id": join_req.id, "reason": reason},
        )
    )

    await db.commit()
    return {"status": "rejected", "message": "Join request rejected"}


# ── Pending & Approval ───────────────────────────────────────────────────────

@router.get("/students/pending", response_model=list[UserResponse])
@router.get("/pending", response_model=list[UserResponse])
async def list_pending_students(
    faculty: User = Depends(require_role("faculty")),
    db: AsyncSession = Depends(get_db),
):
    """Returns ONLY students with an approved join request whose users.status is still 'pending'."""
    return await get_scoped_pending_students(db, faculty)


@router.post(
    "/students/{student_id}/approve",
    response_model=UserResponse,
)
async def approve_student(
    student_id: int,
    faculty: User = Depends(require_role("faculty")),
    db: AsyncSession = Depends(get_db),
):
    """Confirm verification without activating student (face enrollment is the only activation path)."""
    result = await db.execute(
        select(User).where(
            User.id == student_id,
            User.tenant_id == faculty.tenant_id,
            User.role == "student",
        )
    )
    student = result.scalar_one_or_none()

    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student not found",
        )

    # Standalone approval does NOT set student.status = 'active'
    await db.commit()
    await db.refresh(student)
    return student


# ── Face Enrollment ─────────────────────────────────────────────────────────

@router.post(
    "/students/{student_id}/enroll",
    response_model=UserResponse,
)
@router.post(
    "/enroll/{student_id}",
    response_model=UserResponse,
)
async def enroll_student_face(
    student_id: int,
    body: FaceEnrollmentRequest,
    faculty: User = Depends(require_role("faculty")),
    db: AsyncSession = Depends(get_db),
):
    """Validate consent, check scope (404 if out of scope), store encrypted vectors, and activate student."""
    # Scope check: Face enrollment requires an APPROVED join request or class membership
    await get_enrollable_student_or_404(db, faculty, student_id)

    try:
        await enroll_student(
            db,
            faculty=faculty,
            student_id=student_id,
            descriptors=body.descriptors,
            consent=body.consent,
        )
    except EnrollmentStudentNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except DuplicateFaceError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"duplicate_face: {exc}",
        ) from exc
    except (EnrollmentDataError, EnrollmentServiceError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    # Return the activated student
    result = await db.execute(
        select(User).where(
            User.id == student_id,
            User.tenant_id == faculty.tenant_id,
        )
    )
    return result.scalar_one()


# ── Classes Management ───────────────────────────────────────────────────────

@router.get("/classes", response_model=list[ClassResponse])
async def list_faculty_classes(
    faculty: User = Depends(require_role("faculty")),
    db: AsyncSession = Depends(get_db),
):
    """List all classes created by the current faculty member."""
    result = await db.execute(
        select(Course)
        .where(
            Course.tenant_id == faculty.tenant_id,
            Course.faculty_id == faculty.id,
        )
        .order_by(Course.id)
    )
    courses = result.scalars().all()

    class_responses: list[ClassResponse] = []
    for course in courses:
        count_result = await db.execute(
            select(func.count(ClassEnrollment.id)).where(
                ClassEnrollment.course_id == course.id,
                ClassEnrollment.tenant_id == faculty.tenant_id,
                ClassEnrollment.active.is_(True),
            )
        )
        student_count = count_result.scalar_one() or 0

        session_result = await db.execute(
            select(AttendanceSession.id)
            .where(
                AttendanceSession.course_id == course.id,
                AttendanceSession.tenant_id == faculty.tenant_id,
                AttendanceSession.status == "active",
            )
            .order_by(AttendanceSession.id.desc())
            .limit(1)
        )
        active_session_id = session_result.scalar_one_or_none()
        session_str = (
            f"Active session #{active_session_id}"
            if active_session_id
            else "No active session"
        )

        class_responses.append(
            ClassResponse(
                id=course.id,
                name=course.name,
                code=course.code,
                semester=course.semester,
                faculty_id=course.faculty_id,
                student_count=student_count,
                session=session_str,
                active_session_id=active_session_id,
                join_code=getattr(course, "join_code", None),
                join_code_enabled=True if getattr(course, "join_code_enabled", None) is None else bool(course.join_code_enabled),
            )
        )

    return class_responses


@router.post("/classes", response_model=ClassResponse, status_code=status.HTTP_201_CREATED)
async def create_faculty_class(
    body: CreateClassRequest,
    faculty: User = Depends(require_role("faculty")),
    db: AsyncSession = Depends(get_db),
):
    """Create a class for the current faculty member."""
    code_check = await db.execute(
        select(Course.id).where(
            Course.tenant_id == faculty.tenant_id,
            Course.code == body.code,
        )
    )
    if code_check.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Course with this code already exists",
        )

    from app.services.join_code_service import generate_course_join_code

    course = Course(
        tenant_id=faculty.tenant_id,
        name=body.name,
        code=body.code,
        semester=body.semester,
        faculty_id=faculty.id,
        join_code=generate_course_join_code(6),
        join_code_enabled=True,
    )
    db.add(course)
    await db.flush()

    await db.commit()
    await db.refresh(course)

    return ClassResponse(
        id=course.id,
        name=course.name,
        code=course.code,
        semester=course.semester,
        faculty_id=course.faculty_id,
        student_count=0,
        session="No active session",
        join_code=course.join_code,
        join_code_enabled=course.join_code_enabled,
    )


@router.post("/courses/{id}/toggle-join-code")
async def toggle_course_join_code(
    id: int,
    faculty: User = Depends(require_role("faculty")),
    db: AsyncSession = Depends(get_db),
):
    """Enable or disable course admission via join code."""
    from app.services.join_code_service import generate_course_join_code

    result = await db.execute(
        select(Course).where(
            Course.id == id,
            Course.faculty_id == faculty.id,
            Course.tenant_id == faculty.tenant_id,
        )
    )
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    if not course.join_code:
        course.join_code = generate_course_join_code(6)

    course.join_code_enabled = not course.join_code_enabled
    await db.commit()

    return {
        "status": "ok",
        "course_id": course.id,
        "join_code": course.join_code,
        "join_code_enabled": course.join_code_enabled,
        "message": f"Join requests through code are now {'enabled' if course.join_code_enabled else 'disabled'}.",
    }


@router.post("/courses/{id}/regenerate-join-code")
async def regenerate_course_join_code(
    id: int,
    faculty: User = Depends(require_role("faculty")),
    db: AsyncSession = Depends(get_db),
):
    """Regenerate a new unique join code for a course."""
    from app.services.join_code_service import generate_course_join_code

    result = await db.execute(
        select(Course).where(
            Course.id == id,
            Course.faculty_id == faculty.id,
            Course.tenant_id == faculty.tenant_id,
        )
    )
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    new_code = generate_course_join_code(6)
    for _ in range(10):
        existing = (await db.execute(select(Course.id).where(Course.join_code == new_code))).scalar_one_or_none()
        if not existing:
            break
        new_code = generate_course_join_code(6)

    course.join_code = new_code
    course.join_code_enabled = True
    await db.commit()

    return {
        "status": "ok",
        "course_id": course.id,
        "join_code": course.join_code,
        "join_code_enabled": course.join_code_enabled,
        "message": f"New join code '{course.join_code}' generated and enabled.",
    }


# ── Class Students Roster, Removal & Restoration ────────────────────────────

@router.get(
    "/classes/{id}/students",
    response_model=ClassStudentsResponse,
    status_code=status.HTTP_200_OK,
)
async def list_class_students(
    id: int,
    faculty: User = Depends(require_role("faculty")),
    db: AsyncSession = Depends(get_db),
):
    """List all students (active and removed) in the specified class belonging to this faculty."""
    course_res = await db.execute(
        select(Course).where(
            Course.id == id,
            Course.faculty_id == faculty.id,
            Course.tenant_id == faculty.tenant_id,
        )
    )
    course = course_res.scalar_one_or_none()
    if course is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Class not found or does not belong to you",
        )

    # Fetch all enrollments for this class
    query = (
        select(ClassEnrollment, User)
        .join(User, User.id == ClassEnrollment.student_id)
        .where(
            ClassEnrollment.course_id == id,
            ClassEnrollment.tenant_id == faculty.tenant_id,
        )
        .order_by(ClassEnrollment.id.desc())
    )
    result = await db.execute(query)
    rows = result.all()

    active_students: list[ClassStudentItem] = []
    removed_students: list[ClassStudentItem] = []
    seen_active_student_ids = set()

    for enrollment, student in rows:
        item = ClassStudentItem(
            enrollment_id=enrollment.id,
            student_id=student.id,
            name=student.name,
            full_name=student.name,
            roll_no=student.roll_no,
            email=student.email,
            active=enrollment.active,
            enrolled_at=enrollment.enrolled_at,
            left_at=enrollment.left_at,
            ended_by=enrollment.ended_by,
            reason=enrollment.reason,
        )
        if enrollment.active:
            active_students.append(item)
            seen_active_student_ids.add(student.id)
        else:
            if student.id not in seen_active_student_ids:
                removed_students.append(item)

    active_students.sort(key=lambda x: (x.roll_no or x.name))
    removed_students.sort(key=lambda x: (x.roll_no or x.name))

    return ClassStudentsResponse(
        class_id=course.id,
        class_name=course.name,
        class_code=course.code,
        active_students=active_students,
        removed_students=removed_students,
    )


@router.post(
    "/classes/{id}/students/{student_id}/remove",
    status_code=status.HTTP_200_OK,
)
async def remove_student_from_class(
    id: int,
    student_id: int,
    body: RemoveStudentFromClassRequest,
    faculty: User = Depends(require_role("faculty")),
    db: AsyncSession = Depends(get_db),
):
    """Faculty removes a student from a class. Requires a non-empty reason and logs audit event."""
    if not body.reason or not body.reason.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A valid reason is required to remove a student from the class.",
        )

    course_res = await db.execute(
        select(Course).where(
            Course.id == id,
            Course.faculty_id == faculty.id,
            Course.tenant_id == faculty.tenant_id,
        )
    )
    course = course_res.scalar_one_or_none()
    if course is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Class not found or does not belong to you",
        )

    enrollment_res = await db.execute(
        select(ClassEnrollment).where(
            ClassEnrollment.course_id == id,
            ClassEnrollment.student_id == student_id,
            ClassEnrollment.tenant_id == faculty.tenant_id,
            ClassEnrollment.active.is_(True),
        )
    )
    enrollment = enrollment_res.scalar_one_or_none()
    if enrollment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student is not actively enrolled in this class",
        )

    now = datetime.now(timezone.utc)
    enrollment.active = False
    enrollment.left_at = now
    enrollment.ended_by = "faculty"
    enrollment.reason = body.reason.strip()

    db.add(
        AuditEvent(
            tenant_id=faculty.tenant_id,
            actor_id=faculty.id,
            action="student_removed_from_class",
            target=f"user:{student_id}",
            meta={
                "class_id": id,
                "reason": enrollment.reason,
            },
        )
    )
    await db.commit()

    return {
        "status": "removed",
        "message": f"Student successfully removed from {course.name} ({course.code}).",
    }


@router.post(
    "/classes/{id}/students/{student_id}/restore",
    status_code=status.HTTP_200_OK,
)
async def restore_student_to_class(
    id: int,
    student_id: int,
    faculty: User = Depends(require_role("faculty")),
    db: AsyncSession = Depends(get_db),
):
    """Faculty restores a previously removed student to the class. Logs audit event."""
    course_res = await db.execute(
        select(Course).where(
            Course.id == id,
            Course.faculty_id == faculty.id,
            Course.tenant_id == faculty.tenant_id,
        )
    )
    course = course_res.scalar_one_or_none()
    if course is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Class not found or does not belong to you",
        )

    # Check if already active
    active_enrollment = (
        await db.execute(
            select(ClassEnrollment.id).where(
                ClassEnrollment.course_id == id,
                ClassEnrollment.student_id == student_id,
                ClassEnrollment.tenant_id == faculty.tenant_id,
                ClassEnrollment.active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if active_enrollment is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Student is already actively enrolled in this class",
        )

    # Verify student exists in tenant
    student_res = await db.execute(
        select(User).where(
            User.id == student_id,
            User.tenant_id == faculty.tenant_id,
            User.role == "student",
        )
    )
    student = student_res.scalar_one_or_none()
    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student not found",
        )

    now = datetime.now(timezone.utc)
    new_enrollment = ClassEnrollment(
        tenant_id=faculty.tenant_id,
        course_id=id,
        student_id=student_id,
        active=True,
        enrolled_at=now,
    )
    db.add(new_enrollment)

    db.add(
        AuditEvent(
            tenant_id=faculty.tenant_id,
            actor_id=faculty.id,
            action="student_restored_to_class",
            target=f"user:{student_id}",
            meta={
                "class_id": id,
            },
        )
    )
    await db.commit()

    return {
        "status": "restored",
        "message": f"Student successfully restored to {course.name} ({course.code}).",
    }


# ── In-Person Password Reset ─────────────────────────────────────────────────

@router.post(
    "/students/{student_id}/reset-password",
    response_model=ResetPasswordResponse,
)
async def in_person_reset_password(
    student_id: int,
    body: ResetPasswordRequest | None = None,
    faculty_or_admin: User = Depends(require_role("faculty", "admin")),
    db: AsyncSession = Depends(get_db),
):
    """In-person password reset by faculty/admin.

    Faculty may only reset passwords of students enrolled in their own classes.
    """
    if faculty_or_admin.role == "faculty":
        student = await get_student_in_faculty_class_or_404(
            db, faculty_or_admin, student_id
        )
    else:
        result = await db.execute(
            select(User).where(
                User.id == student_id,
                User.tenant_id == faculty_or_admin.tenant_id,
                User.role == "student",
            )
        )
        student = result.scalar_one_or_none()
        if student is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Student not found",
            )

    new_password = (body and body.new_password) or secrets.token_urlsafe(9)
    student.password_hash = hash_password(new_password)
    student.must_change_password = True

    await db.commit()
    await db.refresh(student)

    return ResetPasswordResponse(
        message="Password reset successfully",
        temporary_password=new_password,
        must_change_password=True,
    )


# ── Attendance Corrections & Sessions (Phase 3) ─────────────────────────────

@router.get(
    "/classes/{id}/sessions",
    response_model=list[ClassSessionSummary],
    status_code=status.HTTP_200_OK,
)
async def list_class_sessions(
    id: int,
    faculty: User = Depends(require_role("faculty")),
    db: AsyncSession = Depends(get_db),
):
    """List all attendance sessions for a faculty's class with real-time turnout counts."""
    course_res = await db.execute(
        select(Course).where(
            Course.id == id,
            Course.tenant_id == faculty.tenant_id,
            Course.faculty_id == faculty.id,
        )
    )
    course = course_res.scalar_one_or_none()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Class not found or not authorized",
        )

    st_count_res = await db.execute(
        select(func.count(ClassEnrollment.id)).where(
            ClassEnrollment.course_id == id,
            ClassEnrollment.tenant_id == faculty.tenant_id,
            ClassEnrollment.active.is_(True),
        )
    )
    total_students = st_count_res.scalar_one() or 0

    sess_res = await db.execute(
        select(AttendanceSession).where(
            AttendanceSession.course_id == id,
            AttendanceSession.tenant_id == faculty.tenant_id,
        ).order_by(AttendanceSession.started_at.desc())
    )
    sessions = sess_res.scalars().all()

    summaries: list[ClassSessionSummary] = []
    for s in sessions:
        _, _, students = await resolve_session_effective_attendance(db, s.id, faculty.tenant_id)
        present_cnt = sum(1 for st in students if st.status == "present")
        summaries.append(
            ClassSessionSummary(
                id=s.id,
                course_id=s.course_id,
                started_at=s.started_at,
                ended_at=s.ended_at,
                status=s.status,
                present_count=present_cnt,
                total_students=len(students) if students else total_students,
            )
        )
    return summaries


@router.get(
    "/sessions/{session_id}/attendance",
    response_model=SessionUnifiedAttendanceResponse,
    status_code=status.HTTP_200_OK,
)
async def get_session_unified_attendance(
    session_id: int,
    faculty: User = Depends(require_role("faculty")),
    db: AsyncSession = Depends(get_db),
):
    """
    Get unified effective attendance for a session.
    Resolution rule:
      Latest correction wins (present or absent) > AttendanceLog (present) > Absent.
    """
    sess_res = await db.execute(
        select(AttendanceSession).where(
            AttendanceSession.id == session_id,
            AttendanceSession.tenant_id == faculty.tenant_id,
            AttendanceSession.faculty_id == faculty.id,
        )
    )
    session = sess_res.scalar_one_or_none()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found or not authorized",
        )

    course, session, students = await resolve_session_effective_attendance(
        db, session_id, faculty.tenant_id
    )
    if not session or not course:
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
    "/sessions/{session_id}/corrections",
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
    Correct a session's attendance (present or absent).
    Appends an AttendanceCorrection row (append-only) and logs an audit event.
    """
    sess_res = await db.execute(
        select(AttendanceSession).where(
            AttendanceSession.id == session_id,
            AttendanceSession.tenant_id == faculty.tenant_id,
            AttendanceSession.faculty_id == faculty.id,
        )
    )
    session = sess_res.scalar_one_or_none()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found or not authorized",
        )

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


# ── Attendance Export (Phase 4) ─────────────────────────────────────────────

def _parse_export_date(val: str | None, end_of_day: bool = False) -> datetime | None:
    if not val:
        return None
    val = val.strip()
    try:
        if len(val) == 10 and "-" in val:
            d = datetime.strptime(val, "%Y-%m-%d")
            if end_of_day:
                return datetime.combine(d.date(), time.max, tzinfo=timezone.utc)
            return datetime.combine(d.date(), time.min, tzinfo=timezone.utc)
        dt = datetime.fromisoformat(val)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid date format: '{val}'. Expected YYYY-MM-DD.",
        )


@router.get(
    "/classes/{id}/export",
    status_code=status.HTTP_200_OK,
)
async def export_class_attendance(
    id: int,
    from_date: str | None = Query(default=None, alias="from"),
    to_date: str | None = Query(default=None, alias="to"),
    format: str = Query(default="xlsx"),
    faculty: User = Depends(require_role("faculty")),
    db: AsyncSession = Depends(get_db),
):
    """
    Export class attendance as XLSX or CSV in fixed layout:
    Serial No, Roll No, Name, [session date/time headers in Asia/Kolkata], Total Present, Total Sessions, Attendance %.
    Cells contain 1 (present) or 0 (absent). Formula characters (=, +, -, @) are sanitized.
    """
    # 1. Verify faculty owns course
    course_res = await db.execute(
        select(Course).where(
            Course.id == id,
            Course.tenant_id == faculty.tenant_id,
            Course.faculty_id == faculty.id,
        )
    )
    course = course_res.scalar_one_or_none()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Class not found or not authorized",
        )

    # 2. Parse dates
    dt_from = _parse_export_date(from_date, end_of_day=False)
    dt_to = _parse_export_date(to_date, end_of_day=True)

    # 3. Validate format
    clean_fmt = format.lower().strip()
    if clean_fmt not in ("xlsx", "csv"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Export format must be 'xlsx' or 'csv'",
        )

    # 4. Fetch export data
    headers, rows, sessions = await get_course_attendance_export_data(
        db=db,
        course=course,
        tenant_id=faculty.tenant_id,
        from_date=dt_from,
        to_date=dt_to,
    )

    timestamp_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    safe_code = "".join(c for c in course.code if c.isalnum() or c in ("-", "_")) or "class"

    if clean_fmt == "csv":
        csv_data = generate_attendance_csv(headers, rows)
        filename = f"{safe_code}_attendance_{timestamp_str}.csv"
        return Response(
            content=csv_data,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    else:
        xlsx_data = generate_attendance_xlsx(
            headers=headers,
            rows=rows,
            course_name=course.name,
            course_code=course.code,
        )
        filename = f"{safe_code}_attendance_{timestamp_str}.xlsx"
        return Response(
            content=xlsx_data,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )


