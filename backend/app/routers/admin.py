"""
Admin and Reports router — DPDP compliance and audit reports.

Endpoints (handbook §7):
  DELETE /admin/students/{id}/face  — delete student's face data on request (DPDP)
  GET    /reports/overrides         — override volume per faculty
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_role
from app.db import get_db
from app.models.attendance_log import AttendanceLog
from app.models.attendance_session import AttendanceSession
from app.models.face_vector import FaceVector
from app.models.user import User

router = APIRouter(tags=["Admin & Reports"])


# ── DELETE /admin/students/{id}/face ─────────────────────────────────────────

@router.delete("/admin/students/{student_id}/face", status_code=status.HTTP_200_OK)
async def delete_student_face_data(
    student_id: int,
    admin: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    Delete a student's stored face data on request (DPDP compliance, handbook §7).
    Deactivates existing face vectors and resets student status to pending.
    """
    student_result = await db.execute(
        select(User).where(
            User.id == student_id,
            User.tenant_id == admin.tenant_id,
            User.role == "student",
        )
    )
    student = student_result.scalar_one_or_none()
    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student not found",
        )

    # Deactivate / mark face vectors as inactive (or delete)
    vectors_result = await db.execute(
        select(FaceVector).where(
            FaceVector.user_id == student.id,
            FaceVector.tenant_id == admin.tenant_id,
        )
    )
    vectors = vectors_result.scalars().all()
    count = len(vectors)
    for vector in vectors:
        vector.active = False

    # Student must re-enroll before being approved again
    student.status = "pending"

    await db.commit()

    return {
        "message": f"Successfully deactivated face data for student {student.roll_no}",
        "records_affected": count,
        "student_status": student.status,
    }


# ── GET /reports/overrides ───────────────────────────────────────────────────

@router.get("/reports/overrides", status_code=status.HTTP_200_OK)
async def get_override_reports(
    admin: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    Override volume per faculty (handbook §7).
    """
    query = (
        select(
            AttendanceSession.faculty_id,
            User.name.label("faculty_name"),
            User.email.label("faculty_email"),
            func.count(AttendanceLog.id).label("override_count"),
        )
        .select_from(AttendanceLog)
        .join(AttendanceSession, AttendanceLog.session_id == AttendanceSession.id)
        .join(User, AttendanceSession.faculty_id == User.id)
        .where(
            AttendanceLog.tenant_id == admin.tenant_id,
            AttendanceLog.source == "override",
        )
        .group_by(AttendanceSession.faculty_id, User.name, User.email)
        .order_by(func.count(AttendanceLog.id).desc())
    )

    result = await db.execute(query)
    rows = result.all()

    return [
        {
            "faculty_id": row.faculty_id,
            "faculty_name": row.faculty_name,
            "faculty_email": row.faculty_email,
            "override_count": row.override_count,
        }
        for row in rows
    ]
