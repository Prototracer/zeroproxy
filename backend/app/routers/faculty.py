from datetime import datetime, timezone
import secrets
from fastapi import APIRouter, Depends, HTTPException, status
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
from app.models.attendance_session import AttendanceSession
from app.models.audit import AuditEvent
from app.models.class_enrollment import ClassEnrollment
from app.models.course import Course
from app.models.face_vector import FaceVector
from app.models.join_request import JoinRequest
from app.models.user import User
from app.schemas.auth import ResetPasswordRequest, ResetPasswordResponse, UserResponse
from app.schemas.classes import ClassResponse, CreateClassRequest
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

    # Add student to class_enrollments if not already present
    enrollment_res = await db.execute(
        select(ClassEnrollment.id).where(
            ClassEnrollment.course_id == body.class_id,
            ClassEnrollment.student_id == join_req.student_id,
            ClassEnrollment.tenant_id == faculty.tenant_id,
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
            detail="duplicate_face",
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

    course = Course(
        tenant_id=faculty.tenant_id,
        name=body.name,
        code=body.code,
        semester=body.semester,
        faculty_id=faculty.id,
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
    )


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
