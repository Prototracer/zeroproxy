
from datetime import datetime, timezone
from itertools import combinations

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import FACE_MATCH_THRESHOLD, DUPLICATE_FACE_THRESHOLD
from app.core.encryption import (
    DescriptorEncryptionError,
    decrypt_descriptor_set,
    encrypt_descriptor_set,
)
from app.core.face_enrollment import (
    EnrollmentValidationError,
    euclidean_distance,
    validate_enrollment_descriptors,
)
from app.models.face_vector import FaceVector
from app.models.user import User


class EnrollmentServiceError(Exception):
    """Base exception for face-enrollment service errors."""


class EnrollmentStudentNotFound(EnrollmentServiceError):
    """Student does not exist in the faculty member's tenant."""


class DuplicateFaceError(EnrollmentServiceError):
    """A submitted face matches another student's active enrollment."""


class EnrollmentDataError(EnrollmentServiceError):
    """Enrollment data or stored biometric data is invalid."""


async def enroll_student(
    db: AsyncSession,
    *,
    faculty: User | None = None,
    student: User | None = None,
    student_id: int | None = None,
    descriptors: list[list[float]],
    consent: bool,
) -> FaceVector:
    """Validate, encrypt and store a student's face enrollment.

    Supports both faculty-supervised enrollment and student self-enrollment.
    This function commits the enrollment transaction and activates the student.
    """

    if faculty is not None:
        if faculty.role != "faculty":
            raise EnrollmentServiceError("Faculty authorization required")
        target_student_id = student_id
        approver_id = faculty.id
        tenant_id = faculty.tenant_id
    elif student is not None:
        if student.role != "student":
            raise EnrollmentServiceError("Student authorization required")
        target_student_id = student.id
        approver_id = student.id
        tenant_id = student.tenant_id
    elif student_id is not None:
        target_student_id = student_id
        approver_id = student_id
        tenant_id = 1
    else:
        raise EnrollmentServiceError("Target student not specified")

    if consent is not True:
        raise EnrollmentDataError("Consent is required for enrollment")

    try:
        validated = validate_enrollment_descriptors(descriptors)
    except (EnrollmentValidationError, TypeError) as exc:
        raise EnrollmentDataError(str(exc)) from exc

    # Find the student within the tenant.
    result = await db.execute(
        select(User).where(
            User.id == target_student_id,
            User.tenant_id == tenant_id,
            User.role == "student",
        )
    )
    student = result.scalar_one_or_none()

    if student is None:
        raise EnrollmentStudentNotFound(
            "Student not found in your tenant"
        )

    # Re-enrollment without a reset is rejected (handbook §1 & §8.1)
    if student.status != "pending":
        existing_vec = await db.execute(
            select(FaceVector.id).where(
                FaceVector.user_id == student.id,
                FaceVector.tenant_id == tenant_id,
                FaceVector.active.is_(True),
            )
        )
        if existing_vec.scalar_one_or_none() is not None:
            raise EnrollmentDataError(
                "Student is already active. Re-enrollment requires a reset."
            )


    try:
        # Compare against every other active student's active enrollment.
        result = await db.execute(
            select(FaceVector)
            .join(User, User.id == FaceVector.user_id)
            .where(
                FaceVector.tenant_id == tenant_id,
                FaceVector.active.is_(True),
                FaceVector.user_id != student.id,
                User.status == "active",
                User.role == "student",
            )
        )
        active_enrollments = result.scalars().all()

        for existing in active_enrollments:
            try:
                existing_descriptors = decrypt_descriptor_set(
                    existing.descriptor_enc,
                    user_id=existing.user_id,
                    version=existing.version,
                )
            except (DescriptorEncryptionError, RuntimeError) as exc:
                # Fail closed rather than silently skipping an enrollment
                # that could contain a duplicate face.
                raise EnrollmentServiceError(
                    "An existing enrollment could not be verified"
                ) from exc

            min_dist = min(
                euclidean_distance(proposed, stored)
                for proposed in validated
                for stored in existing_descriptors
            )
            if min_dist < DUPLICATE_FACE_THRESHOLD:
                raise DuplicateFaceError(
                    f"Face matches another student's active enrollment (student ID {existing.user_id}, distance {min_dist:.3f} < threshold {DUPLICATE_FACE_THRESHOLD})"
                )

        # Re-enrollment uses the next version and deactivates the old one.
        result = await db.execute(
            select(func.max(FaceVector.version)).where(
                FaceVector.tenant_id == tenant_id,
                FaceVector.user_id == student.id,
            )
        )
        current_version = result.scalar_one_or_none() or 0
        new_version = current_version + 1

        encrypted = encrypt_descriptor_set(
            validated,
            user_id=student.id,
            version=new_version,
        )

        # Deactivate older versions before inserting the new active record.
        result = await db.execute(
            select(FaceVector).where(
                FaceVector.tenant_id == tenant_id,
                FaceVector.user_id == student.id,
                FaceVector.active.is_(True),
            )
        )
        for old_enrollment in result.scalars().all():
            old_enrollment.active = False

        enrollment = FaceVector(
            tenant_id=tenant_id,
            user_id=student.id,
            descriptor_enc=encrypted,
            version=new_version,
            active=True,
            approved_by=approver_id,
            consent_at=datetime.now(timezone.utc),
        )

        db.add(enrollment)

        # Activate the student only after valid enrollment data is ready.
        student.status = "active"

        await db.commit()
        await db.refresh(enrollment)
        return enrollment

    except Exception:
        await db.rollback()
        raise
