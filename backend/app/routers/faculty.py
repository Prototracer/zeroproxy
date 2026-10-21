from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_role
from app.db import get_db
from app.models.user import User
from app.schemas.auth import UserResponse

router = APIRouter(prefix="/faculty", tags=["Faculty"])


@router.get("/students/pending", response_model=list[UserResponse])
async def list_pending_students(
    faculty: User = Depends(require_role("faculty")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User)
        .where(
            User.tenant_id == faculty.tenant_id,
            User.role == "student",
            User.status == "pending",
        )
        .order_by(User.id)
    )
    return result.scalars().all()


@router.post(
    "/students/{student_id}/approve",
    response_model=UserResponse,
)
async def approve_student(
    student_id: int,
    faculty: User = Depends(require_role("faculty")),
    db: AsyncSession = Depends(get_db),
):
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

    if student.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Student is not pending approval",
        )

    student.status = "active"
    await db.commit()
    await db.refresh(student)

    return student