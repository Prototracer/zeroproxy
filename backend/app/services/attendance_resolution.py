"""
Unified Attendance Resolution Service.

Implements the locked rule:
  For any session and student:
    - If one or more AttendanceCorrection records exist: LATEST CORRECTION WINS (present or absent)
    - Else if an AttendanceLog record exists: PRESENT (source: scan or override)
    - Else: ABSENT
"""

from typing import Any
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.attendance_correction import AttendanceCorrection
from app.models.attendance_log import AttendanceLog
from app.models.attendance_session import AttendanceSession
from app.models.class_enrollment import ClassEnrollment
from app.models.course import Course
from app.models.override import Override
from app.models.user import User
from app.schemas.attendance import StudentEffectiveAttendance


async def resolve_session_effective_attendance(
    db: AsyncSession,
    session_id: int,
    tenant_id: int,
) -> tuple[Course, AttendanceSession, list[StudentEffectiveAttendance]]:
    """Resolve unified effective attendance status for all students in a session's class."""
    # 1. Fetch session and course
    sess_res = await db.execute(
        select(AttendanceSession, Course)
        .join(Course, Course.id == AttendanceSession.course_id)
        .where(
            AttendanceSession.id == session_id,
            AttendanceSession.tenant_id == tenant_id,
        )
    )
    sess_row = sess_res.first()
    if not sess_row:
        return None, None, []
    session, course = sess_row

    # 2. Fetch enrolled students for this course (both currently active, and historical who have logs/corrections)
    enrolled_res = await db.execute(
        select(User)
        .join(ClassEnrollment, ClassEnrollment.student_id == User.id)
        .where(
            ClassEnrollment.course_id == course.id,
            ClassEnrollment.tenant_id == tenant_id,
            ClassEnrollment.active.is_(True),
        )
    )
    active_students = list(enrolled_res.scalars().all())
    student_map = {u.id: u for u in active_students}

    # 3. Fetch attendance logs for this session
    logs_res = await db.execute(
        select(AttendanceLog).where(
            AttendanceLog.session_id == session.id,
            AttendanceLog.tenant_id == tenant_id,
        )
    )
    logs = list(logs_res.scalars().all())
    logs_by_student: dict[int, AttendanceLog] = {l.student_id: l for l in logs}

    # 4. Fetch overrides for reasons
    overrides_res = await db.execute(
        select(Override).where(
            Override.session_id == session.id,
            Override.tenant_id == tenant_id,
        )
    )
    overrides = list(overrides_res.scalars().all())
    override_by_student: dict[int, Override] = {o.student_id: o for o in overrides}

    # 5. Fetch all corrections for this session (ordered by id.asc so latest wins in dict assignment)
    corrections_res = await db.execute(
        select(AttendanceCorrection).where(
            AttendanceCorrection.session_id == session.id,
            AttendanceCorrection.tenant_id == tenant_id,
        ).order_by(AttendanceCorrection.id.asc())
    )
    corrections = list(corrections_res.scalars().all())
    corrections_by_student: dict[int, AttendanceCorrection] = {c.student_id: c for c in corrections}

    # 6. Ensure any student in logs or corrections is also in student_map (in case membership changed)
    extra_student_ids = (set(logs_by_student.keys()) | set(corrections_by_student.keys())) - set(student_map.keys())
    if extra_student_ids:
        extra_users_res = await db.execute(
            select(User).where(
                User.id.in_(extra_student_ids),
                User.tenant_id == tenant_id,
            )
        )
        for u in extra_users_res.scalars().all():
            student_map[u.id] = u

    # 7. Compute unified effective status for each student
    results: list[StudentEffectiveAttendance] = []
    for st_id, user in student_map.items():
        corr = corrections_by_student.get(st_id)
        log = logs_by_student.get(st_id)
        ov = override_by_student.get(st_id)

        if corr is not None:
            # Latest correction wins
            status = corr.status  # "present" or "absent"
            source = "correction"
            reason = corr.reason
            correction_id = corr.id
            corrected_at = corr.created_at
            marked_at = corr.created_at if status == "present" else (log.marked_at if log else None)
        elif log is not None:
            status = "present"
            source = log.source
            reason = ov.reason if ov else None
            correction_id = None
            corrected_at = None
            marked_at = log.marked_at
        else:
            status = "absent"
            source = None
            reason = None
            correction_id = None
            corrected_at = None
            marked_at = None

        results.append(
            StudentEffectiveAttendance(
                student_id=user.id,
                name=user.name,
                full_name=user.name,
                roll_no=user.roll_no,
                status=status,
                source=source,
                reason=reason,
                marked_at=marked_at,
                corrected_at=corrected_at,
                correction_id=correction_id,
            )
        )

    results.sort(key=lambda s: (s.roll_no or s.name))
    return course, session, results


async def get_student_unified_attendance_metrics(
    db: AsyncSession,
    student_id: int,
    tenant_id: int,
) -> dict[str, Any]:
    """Calculate student attendance percentage and history using unified effective status."""
    # 1. Get actively enrolled courses
    enroll_res = await db.execute(
        select(Course)
        .join(ClassEnrollment, ClassEnrollment.course_id == Course.id)
        .where(
            ClassEnrollment.student_id == student_id,
            ClassEnrollment.tenant_id == tenant_id,
            ClassEnrollment.active.is_(True),
        )
    )
    courses = list(enroll_res.scalars().all())
    course_map = {c.id: c for c in courses}
    course_ids = list(course_map.keys())

    if not course_ids:
        return {
            "total_classes": 0,
            "classes_attended": 0,
            "classes_missed": 0,
            "attendance_percentage": 100.0,
            "records": [],
        }

    # 2. Get all conducted sessions in these courses
    sess_res = await db.execute(
        select(AttendanceSession).where(
            AttendanceSession.course_id.in_(course_ids),
            AttendanceSession.tenant_id == tenant_id,
        ).order_by(AttendanceSession.started_at.desc())
    )
    sessions = list(sess_res.scalars().all())
    session_ids = [s.id for s in sessions]

    if not session_ids:
        return {
            "total_classes": 0,
            "classes_attended": 0,
            "classes_missed": 0,
            "attendance_percentage": 100.0,
            "records": [],
        }

    # 3. Fetch all attendance logs for this student in these sessions
    logs_res = await db.execute(
        select(AttendanceLog).where(
            AttendanceLog.student_id == student_id,
            AttendanceLog.session_id.in_(session_ids),
            AttendanceLog.tenant_id == tenant_id,
        )
    )
    logs_by_session: dict[int, AttendanceLog] = {l.session_id: l for l in logs_res.scalars().all()}

    # 4. Fetch all corrections for this student in these sessions (ordered by id.asc so latest wins)
    corr_res = await db.execute(
        select(AttendanceCorrection).where(
            AttendanceCorrection.student_id == student_id,
            AttendanceCorrection.session_id.in_(session_ids),
            AttendanceCorrection.tenant_id == tenant_id,
        ).order_by(AttendanceCorrection.id.asc())
    )
    corrections_by_session: dict[int, AttendanceCorrection] = {c.session_id: c for c in corr_res.scalars().all()}

    # 5. Resolve effective attendance for each session
    total_classes = len(sessions)
    attended_count = 0
    records = []

    for sess in sessions:
        course = course_map.get(sess.course_id)
        course_name = course.name if course else f"Course #{sess.course_id}"
        course_code = course.code if course else ""

        corr = corrections_by_session.get(sess.id)
        log = logs_by_session.get(sess.id)

        if corr is not None:
            effective_status = corr.status
            source = "correction"
            marked_time = corr.created_at
        elif log is not None:
            effective_status = "present"
            source = log.source
            marked_time = log.marked_at
        else:
            effective_status = "absent"
            source = None
            marked_time = sess.started_at

        if effective_status == "present":
            attended_count += 1

        # Format record
        records.append({
            "id": f"{sess.id}_{student_id}",
            "session_id": sess.id,
            "subject": course_name,
            "code": course_code,
            "date": marked_time.strftime("%d %b %Y"),
            "time": marked_time.strftime("%I:%M %p"),
            "status": effective_status.capitalize(),
            "source": source or "absent",
            "reason": corr.reason if corr else None,
        })

    missed_count = max(0, total_classes - attended_count)
    percentage = round((attended_count / total_classes) * 100, 1) if total_classes > 0 else 100.0

    return {
        "total_classes": total_classes,
        "classes_attended": attended_count,
        "classes_missed": missed_count,
        "attendance_percentage": percentage,
        "records": records,
    }
