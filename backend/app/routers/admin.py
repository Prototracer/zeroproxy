"""
Admin and Reports router — User management, faculty creation, DPDP compliance,
and audit reports (Handbook §7 & §8).
"""

import re
import secrets
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import ROLL_NO_PATTERN
from app.core.deps import require_role
from app.core.security import hash_password
from app.db import get_db
from app.models.attendance_log import AttendanceLog
from app.models.attendance_session import AttendanceSession
from app.models.audit import AuditEvent
from app.models.face_vector import FaceVector
from app.models.user import User
from app.schemas.admin import (
    AdminUserListItem,
    AdminUserListResponse,
    AuditEventResponse,
    CorrectUserDetailsRequest,
    CreateFacultyRequest,
    ResetUserPasswordRequest,
    UpdateUserStatusRequest,
)
from app.schemas.auth import UserResponse
from app.stores.memory import refresh_token_store

router = APIRouter(tags=["Admin & Reports"])


# ── GET /admin/users ─────────────────────────────────────────────────────────

@router.get("/admin/users", response_model=AdminUserListResponse, status_code=status.HTTP_200_OK)
async def list_users(
    role: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=100),
    admin: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    List and search users in tenant with role, status filters, and active face vector flag.
    Strictly excludes password hashes and face descriptors.
    """
    base_query = select(User).where(User.tenant_id == admin.tenant_id)

    if role:
        base_query = base_query.where(User.role == role)
    if status_filter:
        base_query = base_query.where(User.status == status_filter)
    if search and search.strip():
        term = f"%{search.strip()}%"
        base_query = base_query.where(
            or_(
                User.name.ilike(term),
                User.roll_no.ilike(term),
                User.email.ilike(term),
            )
        )

    # Count total
    count_query = select(func.count()).select_from(base_query.subquery())
    count_res = await db.execute(count_query)
    total = count_res.scalar_one() or 0

    # Paginate
    offset = (page - 1) * limit
    paginated_query = base_query.order_by(User.id.desc()).offset(offset).limit(limit)
    users_res = await db.execute(paginated_query)
    users = list(users_res.scalars().all())

    # Get set of user_ids with active face vectors
    user_ids = [u.id for u in users]
    face_user_ids = set()
    if user_ids:
        face_query = select(FaceVector.user_id).where(
            FaceVector.user_id.in_(user_ids),
            FaceVector.tenant_id == admin.tenant_id,
            FaceVector.active.is_(True),
        )
        face_res = await db.execute(face_query)
        face_user_ids = set(face_res.scalars().all())

    items = [
        AdminUserListItem(
            id=u.id,
            roll_no=u.roll_no,
            name=u.name,
            email=u.email,
            role=u.role,
            status=u.status,
            must_change_password=bool(u.must_change_password) if u.must_change_password is not None else False,
            has_face_vector=(u.id in face_user_ids),
            created_at=u.created_at,
        )
        for u in users
    ]

    return AdminUserListResponse(
        users=items,
        total=total,
        page=page,
        limit=limit,
    )


# ── POST /admin/faculty ──────────────────────────────────────────────────────

@router.post("/admin/faculty", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_faculty_account(
    body: CreateFacultyRequest,
    admin: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    Admin directly creates a faculty user account with temporary password flag.
    """
    # Check duplicate roll_no or email in tenant
    existing = await db.execute(
        select(User).where(
            (User.email == body.email) | (User.roll_no == body.roll_no),
            User.tenant_id == admin.tenant_id,
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Faculty with this email or roll_no already exists",
        )

    pwd_hash = hash_password(body.password)
    faculty_user = User(
        tenant_id=admin.tenant_id,
        roll_no=body.roll_no,
        name=body.name,
        email=body.email,
        password_hash=pwd_hash,
        role="faculty",
        status="active",
        must_change_password=True,
    )
    db.add(faculty_user)
    await db.commit()
    await db.refresh(faculty_user)

    audit = AuditEvent(
        tenant_id=admin.tenant_id,
        actor_id=admin.id,
        action="faculty_created",
        target=f"user:{faculty_user.id}",
        meta={"email": body.email, "roll_no": body.roll_no, "name": body.name},
    )
    db.add(audit)
    await db.commit()

    return faculty_user


# ── POST /admin/users/{user_id}/status ───────────────────────────────────────

@router.post("/admin/users/{user_id}/status", status_code=status.HTTP_200_OK)
async def update_user_status(
    user_id: int,
    body: UpdateUserStatusRequest,
    admin: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    Update user status (active, suspended, pending).
    If suspending, revokes all active refresh tokens for the user.
    """
    if user_id == admin.id and body.status == "suspended":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Admin cannot suspend their own account",
        )

    user_res = await db.execute(
        select(User).where(
            User.id == user_id,
            User.tenant_id == admin.tenant_id,
        )
    )
    user = user_res.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    old_status = user.status
    user.status = body.status

    if body.status == "suspended":
        refresh_token_store.revoke_all_for_user(user.id)

    audit = AuditEvent(
        tenant_id=admin.tenant_id,
        actor_id=admin.id,
        action="user_status_changed",
        target=f"user:{user.id}",
        meta={"old_status": old_status, "new_status": body.status},
    )
    db.add(audit)
    await db.commit()

    return {
        "id": user.id,
        "status": user.status,
        "message": f"User status updated from {old_status} to {user.status}",
    }


# ── PATCH /admin/users/{user_id} ──────────────────────────────────────────

@router.patch("/admin/users/{user_id}", response_model=AdminUserListItem, status_code=status.HTTP_200_OK)
async def correct_user_details(
    user_id: int,
    body: CorrectUserDetailsRequest,
    admin: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    Admin only: Correct full_name or roll_no for a user.
    Reason is strictly required and the action is audit logged.
    """
    if not body.reason or not body.reason.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A valid reason is required for correcting user details.",
        )

    user_res = await db.execute(
        select(User).where(
            User.id == user_id,
            User.tenant_id == admin.tenant_id,
        )
    )
    user = user_res.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    old_name = user.name
    old_roll_no = user.roll_no
    changes_made = {}

    new_name = (body.full_name or body.name or "").strip()
    if new_name and new_name != old_name:
        if len(new_name) < 2 or len(new_name) > 255:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Full name must be between 2 and 255 characters",
            )
        user.name = new_name
        changes_made["name"] = {"from": old_name, "to": new_name}

    if body.roll_no is not None:
        new_roll = body.roll_no.strip().upper()
        if new_roll and new_roll != old_roll_no:
            if not re.match(ROLL_NO_PATTERN, new_roll):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Roll number must be 3 to 30 characters from [A-Z0-9-_/]",
                )
            # Check case-insensitive uniqueness across other users
            existing = await db.execute(
                select(User.id).where(
                    func.lower(User.roll_no) == new_roll.lower(),
                    User.id != user.id,
                )
            )
            if existing.scalar_one_or_none() is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Roll number is already in use by another user",
                )
            user.roll_no = new_roll
            changes_made["roll_no"] = {"from": old_roll_no, "to": new_roll}

    if not changes_made:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No changes detected in provided full_name or roll_no",
        )

    audit = AuditEvent(
        tenant_id=admin.tenant_id,
        actor_id=admin.id,
        action="user_details_corrected",
        target=f"user:{user.id}",
        meta={
            "reason": body.reason.strip(),
            "changes": changes_made,
        },
    )
    db.add(audit)
    await db.commit()
    await db.refresh(user)

    face_res = await db.execute(
        select(FaceVector.id).where(
            FaceVector.user_id == user.id,
            FaceVector.tenant_id == admin.tenant_id,
            FaceVector.active.is_(True),
        ).limit(1)
    )
    has_face = face_res.scalar_one_or_none() is not None

    return AdminUserListItem(
        id=user.id,
        roll_no=user.roll_no,
        name=user.name,
        full_name=user.name,
        email=user.email,
        role=user.role,
        status=user.status,
        must_change_password=bool(user.must_change_password) if user.must_change_password is not None else False,
        has_face_vector=has_face,
        created_at=user.created_at,
    )



# ── POST /admin/users/{user_id}/reset-password ──────────────────────────────

@router.post("/admin/users/{user_id}/reset-password", status_code=status.HTTP_200_OK)
async def reset_user_password(
    user_id: int,
    body: ResetUserPasswordRequest,
    admin: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    Admin resets password for any user. Flags must_change_password=True and revokes refresh tokens.
    """
    user_res = await db.execute(
        select(User).where(
            User.id == user_id,
            User.tenant_id == admin.tenant_id,
        )
    )
    user = user_res.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    temp_password = body.temporary_password or secrets.token_urlsafe(9)
    user.password_hash = hash_password(temp_password)
    user.must_change_password = True

    refresh_token_store.revoke_all_for_user(user.id)

    audit = AuditEvent(
        tenant_id=admin.tenant_id,
        actor_id=admin.id,
        action="password_reset_by_admin",
        target=f"user:{user.id}",
    )
    db.add(audit)
    await db.commit()

    return {
        "id": user.id,
        "temporary_password": temp_password,
        "must_change_password": True,
        "message": "Password reset successfully. User must change password on next login.",
    }


# ── POST /admin/users/{user_id}/reset-face ──────────────────────────────────

@router.post("/admin/users/{user_id}/reset-face", status_code=status.HTTP_200_OK)
async def reset_user_face_biometrics(
    user_id: int,
    admin: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    Admin resets a student's face biometric enrollment so they can re-enroll.
    Deactivates existing face vectors, resets status to pending, and writes audit log.
    """
    user_res = await db.execute(
        select(User).where(
            User.id == user_id,
            User.tenant_id == admin.tenant_id,
            User.role == "student",
        )
    )
    student = user_res.scalar_one_or_none()
    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student not found",
        )

    vectors_res = await db.execute(
        select(FaceVector).where(
            FaceVector.user_id == student.id,
            FaceVector.tenant_id == admin.tenant_id,
        )
    )
    vectors = list(vectors_res.scalars().all())
    for v in vectors:
        v.active = False

    student.status = "pending"

    audit = AuditEvent(
        tenant_id=admin.tenant_id,
        actor_id=admin.id,
        action="face_enrollment_reset",
        target=f"user:{student.id}",
        meta={"vectors_deactivated": len(vectors)},
    )
    db.add(audit)
    await db.commit()

    return {
        "id": student.id,
        "status": student.status,
        "vectors_deactivated": len(vectors),
        "message": "Face enrollment successfully reset. Student can now re-enroll.",
    }


# ── POST /admin/users/{user_id}/purge-biometrics ────────────────────────────

@router.post("/admin/users/{user_id}/purge-biometrics", status_code=status.HTTP_200_OK)
async def purge_biometrics_dpdp(
    user_id: int,
    admin: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    DPDP tool: Purge all biometric descriptors and face vectors for a student.
    Sets vectors inactive, student status to pending, and logs audit.
    """
    user_res = await db.execute(
        select(User).where(
            User.id == user_id,
            User.tenant_id == admin.tenant_id,
            User.role == "student",
        )
    )
    student = user_res.scalar_one_or_none()
    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student not found",
        )

    vectors_res = await db.execute(
        select(FaceVector).where(
            FaceVector.user_id == student.id,
            FaceVector.tenant_id == admin.tenant_id,
        )
    )
    vectors = list(vectors_res.scalars().all())
    for v in vectors:
        v.active = False

    student.status = "pending"

    audit = AuditEvent(
        tenant_id=admin.tenant_id,
        actor_id=admin.id,
        action="biometrics_purged_dpdp",
        target=f"user:{student.id}",
        meta={"vectors_purged": len(vectors)},
    )
    db.add(audit)
    await db.commit()

    return {
        "id": student.id,
        "message": f"Biometric data for student {student.roll_no} permanently purged in compliance with DPDP.",
        "records_purged": len(vectors),
        "student_status": student.status,
    }


# ── DELETE /admin/students/{id}/face (backward compatibility) ───────────────

@router.delete("/admin/students/{student_id}/face", status_code=status.HTTP_200_OK)
async def delete_student_face_data(
    student_id: int,
    admin: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    Legacy DPDP endpoint alias for backward compatibility.
    """
    return await purge_biometrics_dpdp(student_id, admin, db)


# ── GET /admin/audit ─────────────────────────────────────────────────────────

@router.get("/admin/audit", response_model=list[AuditEventResponse], status_code=status.HTTP_200_OK)
async def get_audit_logs(
    limit: int = Query(default=50, ge=1, le=100),
    action: str | None = Query(default=None),
    admin: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    Return recent audit logs in tenant, joined with actor details.
    """
    query = (
        select(
            AuditEvent,
            User.name.label("actor_name"),
            User.email.label("actor_email"),
        )
        .outerjoin(User, AuditEvent.actor_id == User.id)
        .where(AuditEvent.tenant_id == admin.tenant_id)
    )
    if action and action.strip():
        query = query.where(AuditEvent.action == action.strip())

    query = query.order_by(AuditEvent.created_at.desc()).limit(limit)
    res = await db.execute(query)
    rows = res.all()

    items = []
    for event, actor_name, actor_email in rows:
        items.append(
            AuditEventResponse(
                id=event.id,
                actor_id=event.actor_id,
                actor_name=actor_name,
                actor_email=actor_email,
                action=event.action,
                target=event.target,
                meta=event.meta,
                created_at=event.created_at,
            )
        )
    return items


# ── GET /reports/overrides & GET /admin/reports/overrides ────────────────────

@router.get("/reports/overrides", status_code=status.HTTP_200_OK)
@router.get("/admin/reports/overrides", status_code=status.HTTP_200_OK)
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
