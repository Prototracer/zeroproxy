from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_role
from app.core.rate_limiter import limiter
from app.db import get_db
from app.models.attendance_correction import AttendanceCorrection
from app.models.attendance_log import AttendanceLog
from app.models.attendance_session import AttendanceSession
from app.models.audit import AuditEvent
from app.models.class_enrollment import ClassEnrollment
from app.models.course import Course
from app.models.join_request import JoinRequest
from app.models.user import User
from app.schemas.auth import UserResponse
from app.schemas.classes import LeaveClassRequest, StudentClassItem
from app.schemas.face_enrollment import FaceEnrollmentRequest
from app.schemas.join_request import (
    CreateJoinRequest,
    JoinRequestMessageResponse,
    StudentJoinRequestItem,
)
from app.services.face_enrollment_service import (
    DuplicateFaceError,
    EnrollmentDataError,
    EnrollmentServiceError,
    EnrollmentStudentNotFound,
    enroll_student,
)

router = APIRouter(prefix="/student", tags=["Student"])

STANDARD_JOIN_SUCCESS_MESSAGE = (
    "If the email belongs to a faculty member in your institution, "
    "your join request has been submitted."
)


@router.post(
    "/join-requests",
    response_model=JoinRequestMessageResponse,
    status_code=status.HTTP_200_OK,
)
@limiter.limit("10/minute")
async def create_join_request(
    request: Request,
    body: CreateJoinRequest,
    student: User = Depends(require_role("student")),
    db: AsyncSession = Depends(get_db),
):
    """Submit a join request to a course by join code or faculty email.

    Prevents multiple or duplicate join requests for the same course or faculty.
    """
    # 1. Enforce student max 5 pending requests cap
    pending_count_res = await db.execute(
        select(func.count(JoinRequest.id)).where(
            JoinRequest.student_id == student.id,
            JoinRequest.tenant_id == student.tenant_id,
            JoinRequest.status == "pending",
        )
    )
    pending_count = pending_count_res.scalar() or 0
    if pending_count >= 5:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Maximum 5 pending join requests allowed",
        )

    # 2. Path A: Join via Course Join Code
    if body.join_code and body.join_code.strip():
        clean_code = body.join_code.strip().upper()
        course_res = await db.execute(
            select(Course).where(
                Course.join_code == clean_code,
                Course.tenant_id == student.tenant_id,
            )
        )
        course = course_res.scalar_one_or_none()
        if not course:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Join code '{clean_code}' is invalid.",
            )

        if not course.join_code_enabled:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Join requests for {course.name} ({course.code}) are currently disabled by the instructor.",
            )

        # 1. Check if student has active enrollment or prior removal
        membership = (
            await db.execute(
                select(ClassEnrollment).where(
                    ClassEnrollment.student_id == student.id,
                    ClassEnrollment.course_id == course.id,
                    ClassEnrollment.tenant_id == student.tenant_id,
                ).order_by(ClassEnrollment.id.desc()).limit(1)
            )
        ).scalar_one_or_none()
        if membership is not None:
            if getattr(membership, "active", True):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"You are already enrolled in {course.name} ({course.code}).",
                )
            elif getattr(membership, "ended_by", None) == "faculty":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"You were removed from {course.name} ({course.code}) by the instructor and cannot rejoin via code. Please contact your instructor.",
                )


        # Check if student already has a pending or approved request for this course
        existing_jr = (
            await db.execute(
                select(JoinRequest).where(
                    JoinRequest.student_id == student.id,
                    JoinRequest.class_id == course.id,
                    JoinRequest.tenant_id == student.tenant_id,
                    JoinRequest.status.in_(["pending", "approved"]),
                )
            )
        ).scalar_one_or_none()
        if existing_jr is not None:
            if existing_jr.status == "pending":
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"You already have a pending join request for {course.name} ({course.code}).",
                )
            else:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Your join request for {course.name} ({course.code}) was already approved.",
                )

        # Persist pending join request
        join_req = JoinRequest(
            tenant_id=student.tenant_id,
            student_id=student.id,
            faculty_id=course.faculty_id,
            class_id=course.id,
            status="pending",
        )
        db.add(join_req)
        await db.commit()

        return JoinRequestMessageResponse(
            status="submitted",
            message=f"Join request for {course.name} ({course.code}) sent successfully! Awaiting instructor approval.",
        )

    # 3. Path B: Join via Faculty Email (Legacy path)
    if not body.faculty_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please provide a valid Course Join Code or faculty email.",
        )

    faculty_res = await db.execute(
        select(User).where(
            User.email == body.faculty_email.lower().strip(),
            User.tenant_id == student.tenant_id,
            User.role == "faculty",
        )
    )
    faculty = faculty_res.scalar_one_or_none()

    # If email does not correspond to a faculty member in tenant, return neutral success
    if faculty is None:
        return JoinRequestMessageResponse(
            status="submitted",
            message=STANDARD_JOIN_SUCCESS_MESSAGE,
        )

    # Lookup optional course code if provided
    target_class_id = None
    if body.course_code and body.course_code.strip():
        code_query = select(Course).where(
            Course.code.ilike(body.course_code.strip()),
            Course.faculty_id == faculty.id,
            Course.tenant_id == student.tenant_id,
        )
        code_res = await db.execute(code_query)
        target_class = code_res.scalar_one_or_none()
        if target_class:
            target_class_id = target_class.id

            membership = (
                await db.execute(
                    select(ClassEnrollment).where(
                        ClassEnrollment.student_id == student.id,
                        ClassEnrollment.course_id == target_class_id,
                        ClassEnrollment.tenant_id == student.tenant_id,
                    ).order_by(ClassEnrollment.id.desc()).limit(1)
                )
            ).scalar_one_or_none()
            if membership is not None:
                if getattr(membership, "active", True):
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=f"You are already enrolled in course {body.course_code.strip()}.",
                    )
                elif getattr(membership, "ended_by", None) == "faculty":
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail=f"You were removed from course {body.course_code.strip()} by the instructor and cannot rejoin via code. Please contact your instructor.",
                    )


    # Check for existing pending or approved request in a single query
    existing_res = await db.execute(
        select(JoinRequest.id).where(
            JoinRequest.student_id == student.id,
            JoinRequest.faculty_id == faculty.id,
            JoinRequest.tenant_id == student.tenant_id,
            JoinRequest.status.in_(["pending", "approved"]),
        )
    )
    if existing_res.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A pending join request for this faculty member already exists",
        )



    # Create and persist pending join request
    join_req = JoinRequest(
        tenant_id=student.tenant_id,
        student_id=student.id,
        faculty_id=faculty.id,
        class_id=target_class_id,
        status="pending",
    )
    db.add(join_req)
    await db.commit()

    return JoinRequestMessageResponse(
        status="submitted",
        message=STANDARD_JOIN_SUCCESS_MESSAGE,
    )



@router.get(
    "/join-requests",
    response_model=list[StudentJoinRequestItem],
    status_code=status.HTTP_200_OK,
)
async def list_my_join_requests(
    student: User = Depends(require_role("student")),
    db: AsyncSession = Depends(get_db),
):
    """List all join requests submitted by the logged-in student."""
    query = (
        select(
            JoinRequest,
            User.email.label("faculty_email"),
            User.name.label("faculty_name"),
            Course.name.label("class_name"),
            Course.code.label("course_code"),
        )
        .join(User, User.id == JoinRequest.faculty_id)
        .outerjoin(Course, Course.id == JoinRequest.class_id)
        .where(
            JoinRequest.student_id == student.id,
            JoinRequest.tenant_id == student.tenant_id,
        )
        .order_by(JoinRequest.created_at.desc())
    )
    result = await db.execute(query)
    rows = result.all()

    items = []
    for jr, faculty_email, faculty_name, class_name, course_code in rows:
        items.append(
            StudentJoinRequestItem(
                id=jr.id,
                faculty_id=jr.faculty_id,
                faculty_email=faculty_email,
                faculty_name=faculty_name,
                class_id=jr.class_id,
                class_name=class_name,
                course_code=course_code,
                status=jr.status,
                created_at=jr.created_at,
                decided_at=jr.decided_at,
                rejection_reason=jr.rejection_reason,
            )
        )
    return items


@router.delete(
    "/join-requests/{id}",
    response_model=JoinRequestMessageResponse,
    status_code=status.HTTP_200_OK,
)
async def cancel_join_request(
    id: int,
    student: User = Depends(require_role("student")),
    db: AsyncSession = Depends(get_db),
):
    """Cancel a pending join request."""
    result = await db.execute(
        select(JoinRequest).where(
            JoinRequest.id == id,
            JoinRequest.student_id == student.id,
            JoinRequest.tenant_id == student.tenant_id,
        )
    )
    join_req = result.scalar_one_or_none()
    if join_req is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Join request not found",
        )

    if join_req.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only pending requests can be cancelled",
        )

    join_req.status = "cancelled"
    await db.commit()

    return JoinRequestMessageResponse(
        status="cancelled",
        message="Join request cancelled successfully",
    )


@router.get(
    "/instructors",
    status_code=status.HTTP_200_OK,
)
async def list_available_instructors(
    student: User = Depends(require_role("student")),
    db: AsyncSession = Depends(get_db),
):
    """List available faculty members and their courses in this tenant."""
    query = (
        select(User, Course)
        .outerjoin(
            Course,
            (Course.faculty_id == User.id) & (Course.tenant_id == student.tenant_id),
        )
        .where(
            User.tenant_id == student.tenant_id,
            User.role == "faculty",
            User.status == "active",
        )
        .order_by(User.name.asc(), Course.code.asc())
    )
    result = await db.execute(query)
    rows = result.all()

    faculty_map = {}
    for user, course in rows:
        if user.id not in faculty_map:
            faculty_map[user.id] = {
                "id": user.id,
                "name": user.name or user.email,
                "email": user.email,
                "courses": [],
            }
        if course:
            faculty_map[user.id]["courses"].append({
                "id": course.id,
                "name": course.name,
                "code": course.code,
            })

    return list(faculty_map.values())


# ── Student Face Self-Enrollment ──────────────────────────────────────────

@router.post(
    "/enroll",
    response_model=UserResponse,
    status_code=status.HTTP_200_OK,
)
@router.post(
    "/face/enroll",
    response_model=UserResponse,
    status_code=status.HTTP_200_OK,
)
async def enroll_student_face_self(
    body: FaceEnrollmentRequest,
    student: User = Depends(require_role("student")),
    db: AsyncSession = Depends(get_db),
):
    """Validate consent, encrypt biometrics, store FaceVector, and activate student account."""
    try:
        await enroll_student(
            db,
            faculty=None,
            student=student,
            student_id=student.id,
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
            User.id == student.id,
            User.tenant_id == student.tenant_id,
        )
    )
    return result.scalar_one()


# ── Student Classes & Leaving Class ──────────────────────────────────────────

@router.get(
    "/classes",
    response_model=list[StudentClassItem],
    status_code=status.HTTP_200_OK,
)
async def list_enrolled_classes(
    student: User = Depends(require_role("student")),
    db: AsyncSession = Depends(get_db),
):
    """List all classes in which the student is currently actively enrolled."""
    query = (
        select(Course, ClassEnrollment, User)
        .join(ClassEnrollment, ClassEnrollment.course_id == Course.id)
        .join(User, User.id == Course.faculty_id)
        .where(
            ClassEnrollment.student_id == student.id,
            ClassEnrollment.tenant_id == student.tenant_id,
            ClassEnrollment.active.is_(True),
        )
        .order_by(Course.name.asc())
    )
    result = await db.execute(query)
    rows = result.all()

    return [
        StudentClassItem(
            id=course.id,
            name=course.name,
            code=course.code,
            semester=course.semester,
            faculty_name=faculty.name,
            faculty_email=faculty.email,
            enrolled_at=enrollment.enrolled_at,
            active=enrollment.active,
        )
        for course, enrollment, faculty in rows
    ]


@router.get(
    "/classes/{class_id}/details",
    status_code=status.HTTP_200_OK,
)
async def get_student_class_details(
    class_id: int,
    student: User = Depends(require_role("student")),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns course info, student's course-specific attendance metrics,
    and session-by-session attendance history for this course.
    """
    query = (
        select(Course, ClassEnrollment, User)
        .join(ClassEnrollment, ClassEnrollment.course_id == Course.id)
        .join(User, User.id == Course.faculty_id)
        .where(
            Course.id == class_id,
            ClassEnrollment.student_id == student.id,
            ClassEnrollment.tenant_id == student.tenant_id,
            ClassEnrollment.active.is_(True),
        )
    )
    res = await db.execute(query)
    row = res.first()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You are not actively enrolled in this class or class was not found",
        )
    course, enrollment, faculty = row

    # All sessions for this course
    sess_res = await db.execute(
        select(AttendanceSession).where(
            AttendanceSession.course_id == course.id,
            AttendanceSession.tenant_id == student.tenant_id,
        ).order_by(AttendanceSession.started_at.desc())
    )
    sessions = list(sess_res.scalars().all())
    session_ids = [s.id for s in sessions]

    # Attendance logs for this student
    logs_by_session = {}
    if session_ids:
        logs_res = await db.execute(
            select(AttendanceLog).where(
                AttendanceLog.session_id.in_(session_ids),
                AttendanceLog.student_id == student.id,
                AttendanceLog.tenant_id == student.tenant_id,
            )
        )
        for l in logs_res.scalars().all():
            logs_by_session[l.session_id] = l

    # Attendance corrections for this student
    corr_by_session = {}
    if session_ids:
        corr_res = await db.execute(
            select(AttendanceCorrection).where(
                AttendanceCorrection.session_id.in_(session_ids),
                AttendanceCorrection.student_id == student.id,
                AttendanceCorrection.tenant_id == student.tenant_id,
            ).order_by(AttendanceCorrection.id.asc())
        )
        for c in corr_res.scalars().all():
            corr_by_session[c.session_id] = c

    records = []
    attended_count = 0

    for s in sessions:
        corr = corr_by_session.get(s.id)
        log = logs_by_session.get(s.id)

        if corr is not None:
            eff_status = corr.status.lower()
            source = "correction"
            reason = corr.reason
            dt = corr.created_at
        elif log is not None:
            eff_status = "present"
            source = log.source
            reason = None
            dt = log.marked_at
        else:
            eff_status = "absent"
            source = "unmarked"
            reason = "Session missed / late enrollment"
            dt = s.started_at

        if eff_status == "present":
            attended_count += 1

        records.append({
            "session_id": s.id,
            "status": eff_status.capitalize(),
            "source": source,
            "reason": reason,
            "started_at": s.started_at.isoformat() if s.started_at else None,
            "date": dt.strftime("%d %b %Y") if dt else "Unknown",
            "time": dt.strftime("%I:%M %p") if dt else "Unknown",
        })

    total_classes = len(sessions)
    missed_count = max(0, total_classes - attended_count)
    percentage = (
        round((attended_count / total_classes) * 100, 1)
        if total_classes > 0
        else (100.0 if attended_count > 0 else 0.0)
    )

    return {
        "course": {
            "id": course.id,
            "name": course.name,
            "code": course.code,
            "semester": course.semester,
            "faculty_name": faculty.name,
            "faculty_email": faculty.email,
            "enrolled_at": enrollment.enrolled_at.isoformat() if enrollment.enrolled_at else None,
        },
        "analytics": {
            "total_classes": total_classes,
            "classes_attended": attended_count,
            "classes_missed": missed_count,
            "percentage": percentage,
        },
        "records": records,
    }


@router.post(
    "/classes/{class_id}/leave",
    status_code=status.HTTP_200_OK,
)
async def leave_class(
    class_id: int,
    body: LeaveClassRequest | None = None,
    student: User = Depends(require_role("student")),
    db: AsyncSession = Depends(get_db),
):
    """Allows a student to leave an actively enrolled class with full audit logging."""
    enrollment_res = await db.execute(
        select(ClassEnrollment).where(
            ClassEnrollment.student_id == student.id,
            ClassEnrollment.course_id == class_id,
            ClassEnrollment.tenant_id == student.tenant_id,
            ClassEnrollment.active.is_(True),
        )
    )
    enrollment = enrollment_res.scalar_one_or_none()
    if enrollment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You are not actively enrolled in this class",
        )

    now = datetime.now(timezone.utc)
    enrollment.active = False
    enrollment.left_at = now
    enrollment.ended_by = "student"
    enrollment.reason = (body and body.reason and body.reason.strip()) or "Student left class voluntarily"

    # Audit event logged
    db.add(
        AuditEvent(
            tenant_id=student.tenant_id,
            actor_id=student.id,
            action="class_leave",
            target=f"course:{class_id}",
            meta={
                "enrollment_id": enrollment.id,
                "reason": enrollment.reason,
            },
        )
    )
    await db.commit()

    return {
        "status": "left",
        "message": "You have successfully left the class.",
    }


