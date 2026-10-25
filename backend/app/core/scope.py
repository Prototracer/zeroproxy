from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.class_enrollment import ClassEnrollment
from app.models.course import Course
from app.models.face_vector import FaceVector
from app.models.join_request import JoinRequest
from app.models.user import User


async def can_view_student(
    db: AsyncSession,
    faculty: User,
    student_id: int,
) -> bool:
    """Check if faculty member is allowed to view the student.

    Faculty may view a student if the student:
    1. Has a pending or approved join request addressed to this faculty member, OR
    2. Is enrolled in one of this faculty member's classes.
    """
    # 1. Join request check
    jr_query = select(JoinRequest.id).where(
        JoinRequest.student_id == student_id,
        JoinRequest.faculty_id == faculty.id,
        JoinRequest.tenant_id == faculty.tenant_id,
        JoinRequest.status.in_(["pending", "approved"]),
    )
    jr_res = await db.execute(jr_query)
    if jr_res.scalar_one_or_none() is not None:
        return True

    # 2. Class membership check
    class_query = (
        select(ClassEnrollment.id)
        .join(Course, Course.id == ClassEnrollment.course_id)
        .where(
            ClassEnrollment.student_id == student_id,
            Course.faculty_id == faculty.id,
            ClassEnrollment.tenant_id == faculty.tenant_id,
        )
    )
    class_res = await db.execute(class_query)
    if class_res.scalar_one_or_none() is not None:
        return True

    return False


async def get_scoped_student_or_404(
    db: AsyncSession,
    faculty: User,
    student_id: int,
) -> User:
    """Retrieve student if in faculty view scope; otherwise raise 404."""
    user_res = await db.execute(
        select(User).where(
            User.id == student_id,
            User.tenant_id == faculty.tenant_id,
            User.role == "student",
        )
    )
    student = user_res.scalar_one_or_none()
    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student not found",
        )

    allowed = await can_view_student(db, faculty, student_id)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student not found",
        )

    return student


async def can_enroll_student(
    db: AsyncSession,
    faculty: User,
    student_id: int,
) -> bool:
    """Check if student is in scope for face enrollment by faculty.

    Face enrollment needs an APPROVED join request (or class membership, for re-enrollment).
    """
    # 1. Approved join request check
    jr_query = select(JoinRequest.id).where(
        JoinRequest.student_id == student_id,
        JoinRequest.faculty_id == faculty.id,
        JoinRequest.tenant_id == faculty.tenant_id,
        JoinRequest.status == "approved",
    )
    jr_res = await db.execute(jr_query)
    if jr_res.scalar_one_or_none() is not None:
        return True

    # 2. Class membership check (for re-enrollment)
    class_query = (
        select(ClassEnrollment.id)
        .join(Course, Course.id == ClassEnrollment.course_id)
        .where(
            ClassEnrollment.student_id == student_id,
            Course.faculty_id == faculty.id,
            ClassEnrollment.tenant_id == faculty.tenant_id,
        )
    )
    class_res = await db.execute(class_query)
    if class_res.scalar_one_or_none() is not None:
        return True

    return False


async def get_enrollable_student_or_404(
    db: AsyncSession,
    faculty: User,
    student_id: int,
) -> User:
    """Retrieve student if in enrollment scope; otherwise raise 404."""
    user_res = await db.execute(
        select(User).where(
            User.id == student_id,
            User.tenant_id == faculty.tenant_id,
            User.role == "student",
        )
    )
    student = user_res.scalar_one_or_none()
    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student not found",
        )

    allowed = await can_enroll_student(db, faculty, student_id)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student not found",
        )

    return student


async def get_student_in_faculty_class_or_404(
    db: AsyncSession,
    faculty: User,
    student_id: int,
) -> User:
    """Retrieve student if in one of faculty's own classes; otherwise raise 404."""
    user_res = await db.execute(
        select(User).where(
            User.id == student_id,
            User.tenant_id == faculty.tenant_id,
            User.role == "student",
        )
    )
    student = user_res.scalar_one_or_none()
    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student not found",
        )

    class_query = (
        select(ClassEnrollment.id)
        .join(Course, Course.id == ClassEnrollment.course_id)
        .where(
            ClassEnrollment.student_id == student_id,
            Course.faculty_id == faculty.id,
            ClassEnrollment.tenant_id == faculty.tenant_id,
            ClassEnrollment.active.is_(True),
        )
    )
    class_res = await db.execute(class_query)
    if class_res.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student not found",
        )

    return student


async def get_scoped_pending_students(
    db: AsyncSession,
    faculty: User,
) -> list[User]:
    """Return faculty's students with an approved join request or class enrollment who need face enrollment.

    Includes students who are status 'pending' OR have not completed face enrollment (no active face vector).
    """
    active_face_subquery = (
        select(FaceVector.user_id)
        .where(
            FaceVector.tenant_id == faculty.tenant_id,
            FaceVector.active.is_(True),
        )
    )

    query = (
        select(User)
        .outerjoin(
            JoinRequest,
            (JoinRequest.student_id == User.id)
            & (JoinRequest.faculty_id == faculty.id)
            & (JoinRequest.tenant_id == faculty.tenant_id)
            & (JoinRequest.status == "approved"),
        )
        .outerjoin(
            ClassEnrollment,
            (ClassEnrollment.student_id == User.id)
            & (ClassEnrollment.tenant_id == faculty.tenant_id),
        )
        .outerjoin(
            Course,
            (Course.id == ClassEnrollment.course_id)
            & (Course.faculty_id == faculty.id)
            & (Course.tenant_id == faculty.tenant_id),
        )
        .where(
            User.tenant_id == faculty.tenant_id,
            User.role == "student",
            or_(
                JoinRequest.id.is_not(None),
                Course.id.is_not(None),
            ),
            or_(
                User.status == "pending",
                User.id.not_in(active_face_subquery),
            ),
        )
        .distinct()
        .order_by(User.id)
    )
    result = await db.execute(query)
    return list(result.scalars().all())

