from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_role
from app.core.rate_limiter import limiter
from app.db import get_db
from app.models.course import Course
from app.models.join_request import JoinRequest
from app.models.user import User
from app.schemas.join_request import (
    CreateJoinRequest,
    JoinRequestMessageResponse,
    StudentJoinRequestItem,
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
    """Submit a join request to a faculty member by email.

    Always returns the exact same success-style response regardless of
    whether the faculty member exists, preventing email enumeration.
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

    # 2. Look up faculty member in the same tenant
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

    # 3. Check for existing pending request for this (student, faculty) pair
    existing_res = await db.execute(
        select(JoinRequest.id).where(
            JoinRequest.student_id == student.id,
            JoinRequest.faculty_id == faculty.id,
            JoinRequest.tenant_id == student.tenant_id,
            JoinRequest.status == "pending",
        )
    )
    if existing_res.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A pending join request for this faculty member already exists",
        )

    # 4. Lookup optional course code if provided
    target_class_id = None
    if body.course_code and body.course_code.strip():
        code_query = select(Course.id).where(
            Course.code.ilike(body.course_code.strip()),
            Course.faculty_id == faculty.id,
            Course.tenant_id == student.tenant_id,
        )
        code_res = await db.execute(code_query)
        target_class_id = code_res.scalar_one_or_none()

    # 5. Create and persist pending join request
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

