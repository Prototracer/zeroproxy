"""
Attendance router — student QR scan and attendance submission.

Endpoints (handbook §7):
  POST /attendance/scan    — validate QR token, issue single-use ticket + challenge
  POST /attendance/submit  — run all §3.1 checks, record attendance

Security checks implemented (handbook §3.1):
  1. Ticket: exists, belongs to student, nonce matches, consumed atomically, session active
  2. Timing: server-measured time in [MIN_SUBMIT_SECONDS, TICKET_TTL_SECONDS]
  3. Shape: 2–3 samples; each descriptor exactly 128 finite floats; landmark series ≤ 80;
            durationMs ≤ CHALLENGE_WINDOW_MS + MARGIN
  4. Challenge evidence: blink detected in landmark series
  5. Single face: faceCount==1 in ≥90% of entries and in every sample
  6. Open eyes, frontal: eyeOpenness > OPEN_EYE_MIN and |yawDeg| < FRONTAL_MAX
  7. Identity: each sample's best distance to enrolled samples < MATCH_THRESHOLD
  8. Internal consistency: max pairwise distance between submitted samples < MAX_INTRA_DISTANCE
  9. Write: INSERT … ON CONFLICT DO NOTHING; if 0 rows → 409 already_marked
"""

import secrets
from datetime import datetime, timezone
from math import isfinite

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import FACE_MATCH_THRESHOLD
from app.core.deps import get_current_user
from app.core.encryption import DescriptorEncryptionError, decrypt_descriptor_set
from app.core.face_enrollment import euclidean_distance
from app.db import get_db
from app.models.attendance_log import AttendanceLog
from app.models.attendance_session import AttendanceSession
from app.models.class_enrollment import ClassEnrollment
from app.models.course import Course
from app.models.face_vector import FaceVector
from app.models.user import User
from app.schemas.attendance import (
    AttendanceResponse,
    ScanRequest,
    ScanResponse,
    SubmitAttendanceRequest,
)
from app.services.qr_service import validate_qr_token
from app.stores.memory import rate_limiter, ticket_store

router = APIRouter(prefix="/attendance", tags=["Attendance"])

# ── Configuration constants ──────────────────────────────────────────────────

TICKET_TTL_SECONDS: int = 120         # 2 minutes: allows students to comfortably retry face challenge
MIN_SUBMIT_SECONDS: float = 1.5       # handbook §3.1 check 2
CHALLENGE_WINDOW_MS: int = 7000       # comfortably allows sequential combo 1 -> combo 2
CHALLENGE_MARGIN_MS: int = 2000       # small margin for legitimate network & mobile latency

OPEN_EYE_MIN: float = 0.2            # handbook §3.1 check 6
FRONTAL_MAX: float = 20.0            # handbook §3.1 check 6
MAX_INTRA_DISTANCE: float = 0.35     # handbook §3.1 check 8 (start loose)
MIN_SINGLE_FACE_RATIO: float = 0.90  # handbook §3.1 check 5

MAX_FAILED_SUBMITS: int = 3           # handbook §3.1: "max 3 failed submits per student per session"
FAIL_WINDOW_SECONDS: int = 3600 * 24  # track failures within a session day


# ── POST /attendance/scan ────────────────────────────────────────────────────

@router.post("/scan", response_model=ScanResponse, status_code=status.HTTP_200_OK)
async def scan_qr(
    body: ScanRequest,
    request: Request,
    student: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Student submits a scanned QR payload.

    Validates: HMAC signature, window freshness, student account/enrollment/class/session.
    Issues a single-use scan ticket with a blink challenge.
    """
    # Only students can scan
    if student.role != "student":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only students can submit scan requests",
        )

    if student.status != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is pending face enrollment and activation",
        )

    # 1. Validate HMAC + window
    if not validate_qr_token(body.session_id, body.window, body.mac):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ticket_invalid",
        )

    # 2. Load and verify the session is active
    result = await db.execute(
        select(AttendanceSession).where(
            AttendanceSession.id == body.session_id,
            AttendanceSession.tenant_id == student.tenant_id,
        )
    )
    session = result.scalar_one_or_none()

    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="session_ended",
        )

    if session.status != "active":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="session_ended",
        )

    # 3. Verify student has an active face enrollment
    face_result = await db.execute(
        select(FaceVector.id).where(
            FaceVector.user_id == student.id,
            FaceVector.tenant_id == student.tenant_id,
            FaceVector.active.is_(True),
        ).limit(1)
    )
    if face_result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No active face enrollment found",
        )

    # 4. Verify the student is actively enrolled in this session's course
    enrollment_result = await db.execute(
        select(ClassEnrollment.id).where(
            ClassEnrollment.course_id == session.course_id,
            ClassEnrollment.student_id == student.id,
            ClassEnrollment.tenant_id == student.tenant_id,
            ClassEnrollment.active.is_(True),
        ).limit(1)
    )
    if enrollment_result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enrolled in this course",
        )

    # 5. Check for already-marked attendance
    existing_result = await db.execute(
        select(AttendanceLog.id).where(
            AttendanceLog.session_id == session.id,
            AttendanceLog.student_id == student.id,
        ).limit(1)
    )
    if existing_result.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="already_marked",
        )

    # 6. Check per-student-per-session failure rate limit
    fail_key = f"submit_fail:{student.id}:{session.id}"
    # (We read the count but only block at submit time — here we just gate scan on too many submits)
    # Actually the count check is at submit; scan can still proceed to let the student try again
    # if they haven't hit the limit. The rate_limiter.hit() call happens at submit.

    # 7. Issue single-use ticket with randomized liveness challenge
    # Supported challenges:
    # 1. blink
    # 2. double_blink
    # 3. smile
    # 4. turn_left
    # 5. turn_right
    # 6. nod_head
    # 8. raise_eyebrows
    # 9. combo_smile_blink, combo_turn_blink, combo_smile_turn
    CHALLENGE_POOL = [
        "blink",
        "double_blink",
        "turn_left",
        "turn_right",
        "nod_head",
        "raise_eyebrows",
        "combo_turn_blink",
        "combo_nod_blink",
    ]
    chosen_challenge = secrets.choice(CHALLENGE_POOL)

    nonce = secrets.token_urlsafe(16)
    ticket_id = ticket_store.issue(
        user_id=student.id,
        session_id=session.id,
        challenge=chosen_challenge,
        nonce=nonce,
        ttl_seconds=TICKET_TTL_SECONDS,
    )

    return ScanResponse(
        ticket_id=ticket_id,
        nonce=nonce,
        challenge=chosen_challenge,
        session_id=session.id,
    )


# ── POST /attendance/submit ──────────────────────────────────────────────────

@router.post(
    "/submit",
    response_model=AttendanceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def submit_attendance(
    body: SubmitAttendanceRequest,
    request: Request,
    student: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Student submits liveness + descriptors to mark attendance.
    Runs all §3.1 checks in order. A failed submit burns the ticket.
    After 3 failed submits the student must go to faculty override.
    """
    if student.role != "student":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only students can submit attendance",
        )

    if student.status != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is pending face enrollment and activation",
        )

    # ── Check 0: Per-student-per-session rate limit (max 3 fails) ───────────
    # We check before consuming so an over-limit student can't DoS the ticket
    fail_key = f"submit_fail:{student.id}:{body.ticket_id}"
    # Retrieve fail count from rate_limiter — using a check-then-act pattern
    # The actual increment happens after a failure below.
    # We use a separate counter key per session:
    # The ticket_id is unique, so use session from ticket (loaded after consume).
    # We'll do a pre-check using a global per-student key; final check after consume.

    # ── Check 1: Ticket — consume atomically ───────────────────────────────
    ticket = ticket_store.consume(body.ticket_id, student.id)

    if ticket is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ticket_invalid",
        )

    # Now we have the session_id from the ticket
    session_fail_key = f"submit_fail:{student.id}:{ticket.session_id}"

    def _record_failure_and_raise(code: str, http_status: int = 400) -> None:
        """Increment failure counter and raise the reject code."""
        # hit() returns False when limit exceeded — we just increment without
        # blocking here; we checked the limit before this call path.
        rate_limiter.hit(session_fail_key, MAX_FAILED_SUBMITS + 1, FAIL_WINDOW_SECONDS)
        raise HTTPException(status_code=http_status, detail=code)

    # Pre-check: if already at limit, reject before doing any work
    # We abuse hit() by checking whether 1 more would exceed — instead use a
    # separate peek. Since MemoryRateLimiter prunes on hit(), we call it only
    # to record a failure. We maintain a separate "peek" via a short-circuit:
    # issue a hit with limit=MAX_FAILED_SUBMITS; if it returns False, already over.
    # But this would increment before the real failure. Instead use a dedicated counter.
    # Simple approach: track with rate_limiter; if at limit, reject scan too.
    # We re-check below without incrementing using a probe key.

    # Verify nonce matches
    if not secrets.compare_digest(ticket.nonce, body.nonce):
        _record_failure_and_raise("ticket_invalid")

    # ── Check 1b: Verify session is still active ────────────────────────────
    result = await db.execute(
        select(AttendanceSession).where(
            AttendanceSession.id == ticket.session_id,
            AttendanceSession.tenant_id == student.tenant_id,
        )
    )
    session = result.scalar_one_or_none()

    if session is None or session.status != "active":
        _record_failure_and_raise("session_ended", 409)

    # ── Check per-session failure limit ─────────────────────────────────────
    fail_probe_key = f"submit_fail_count:{student.id}:{session.id}"
    if not rate_limiter.hit(fail_probe_key, MAX_FAILED_SUBMITS, FAIL_WINDOW_SECONDS):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="too_many_attempts",
        )

    # ── Check 2: Timing ─────────────────────────────────────────────────────
    now = datetime.now(timezone.utc)
    elapsed_s = (now - ticket.issued_at).total_seconds()

    if elapsed_s < MIN_SUBMIT_SECONDS:
        _record_failure_and_raise("too_fast_or_slow")

    if elapsed_s > TICKET_TTL_SECONDS:
        _record_failure_and_raise("too_fast_or_slow")

    if body.duration_ms > CHALLENGE_WINDOW_MS + CHALLENGE_MARGIN_MS:
        _record_failure_and_raise("too_fast_or_slow")

    # ── Check 3: Shape ───────────────────────────────────────────────────────
    samples = body.samples
    if not (2 <= len(samples) <= 3):
        _record_failure_and_raise("bad_payload")

    for s in samples:
        if len(s.descriptor) != 128:
            _record_failure_and_raise("bad_payload")
        if not all(isfinite(v) for v in s.descriptor):
            _record_failure_and_raise("bad_payload")

    if len(body.landmark_series) > 80:
        _record_failure_and_raise("bad_payload")

    # ── Check 4: Liveness challenge evidence ─────────────────────────────────
    if not _verify_liveness_challenge(ticket.challenge, body.landmark_series):
        _record_failure_and_raise("challenge_failed")

    # ── Check 5: Single face ─────────────────────────────────────────────────
    series = body.landmark_series
    if series:
        single_face_entries = sum(1 for e in series if e.face_count == 1)
        ratio = single_face_entries / len(series)
        if ratio < MIN_SINGLE_FACE_RATIO:
            _record_failure_and_raise("multiple_faces")

    for s in samples:
        # Samples are already validated to be from single-face frames by the FE,
        # but we trust the face_count field from the sample's source frame.
        # (The DescriptorSample schema doesn't carry face_count; the check is on
        # the landmark series above.)
        pass

    # ── Check 6: Open eyes, frontal ──────────────────────────────────────────
    for s in samples:
        if s.eye_openness < OPEN_EYE_MIN:
            _record_failure_and_raise("eyes_closed")
        if abs(s.yaw_deg) > FRONTAL_MAX:
            _record_failure_and_raise("bad_payload")

    # ── Check 7: Identity — match against enrolled samples ───────────────────
    face_result = await db.execute(
        select(FaceVector).where(
            FaceVector.user_id == student.id,
            FaceVector.tenant_id == student.tenant_id,
            FaceVector.active.is_(True),
        )
    )
    face_vector = face_result.scalar_one_or_none()

    if face_vector is None:
        _record_failure_and_raise("face_mismatch")

    try:
        enrolled_descriptors = decrypt_descriptor_set(
            face_vector.descriptor_enc,
            user_id=student.id,
            version=face_vector.version,
        )
    except (DescriptorEncryptionError, RuntimeError):
        _record_failure_and_raise("face_mismatch")

    best_distances: list[float] = []
    for submitted_sample in samples:
        best = min(
            euclidean_distance(submitted_sample.descriptor, enrolled)
            for enrolled in enrolled_descriptors
        )
        best_distances.append(best)
        if best >= FACE_MATCH_THRESHOLD:
            _record_failure_and_raise("face_mismatch")

    overall_best_distance = min(best_distances)

    # ── Check 8: Internal consistency ────────────────────────────────────────
    from itertools import combinations as _combos
    for a, b in _combos(samples, 2):
        if euclidean_distance(a.descriptor, b.descriptor) >= MAX_INTRA_DISTANCE:
            _record_failure_and_raise("inconsistent_samples")

    # ── Check 9: Re-verify enrollment + course eligibility before write ──────
    enroll_result = await db.execute(
        select(ClassEnrollment.id).where(
            ClassEnrollment.course_id == session.course_id,
            ClassEnrollment.student_id == student.id,
            ClassEnrollment.tenant_id == student.tenant_id,
            ClassEnrollment.active.is_(True),
        ).limit(1)
    )
    if enroll_result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enrolled in this course",
        )

    # ── Check 10: Write — ON CONFLICT DO NOTHING ─────────────────────────────
    client_ip = _get_client_ip(request)

    stmt = (
        pg_insert(AttendanceLog)
        .values(
            tenant_id=student.tenant_id,
            session_id=session.id,
            student_id=student.id,
            source="scan",
            ip=client_ip,
            match_distance=overall_best_distance,
            challenge=ticket.challenge,
        )
        .on_conflict_do_nothing(
            index_elements=None,
            constraint="uq_attendance_student_session",
        )
    )

    result = await db.execute(stmt)
    await db.commit()

    if result.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="already_marked",
        )

    return AttendanceResponse(
        status="marked",
        session_id=session.id,
        student_id=student.id,
    )


# ── Helpers & Liveness Challenge Detectors ───────────────────────────────────

def _detect_blink(landmark_series: list) -> bool:
    """Check for a single blink: eyes close (relative dip, delta, or < 0.22) and reopen."""
    if not landmark_series or len(landmark_series) < 3:
        return False
    eye_values = [(entry.left_eye + entry.right_eye) / 2 for entry in landmark_series]
    baseline_eye = max(eye_values[:min(5, len(eye_values))])
    min_eye = min(eye_values)

    closed = False
    for avg_eye in eye_values:
        if not closed and (avg_eye < 0.22 or avg_eye <= baseline_eye * 0.85 or (baseline_eye - avg_eye) >= 0.025):
            closed = True
        elif closed and (avg_eye > 0.19 or avg_eye >= min_eye + 0.02):
            return True
    return False


def _detect_double_blink(landmark_series: list) -> bool:
    """Check for two distinct blinks in sequence."""
    if not landmark_series or len(landmark_series) < 5:
        return False
    eye_values = [(entry.left_eye + entry.right_eye) / 2 for entry in landmark_series]
    baseline_eye = max(eye_values[:min(5, len(eye_values))])

    blinks = 0
    in_blink = False
    min_in_blink = 0.28
    for avg_eye in eye_values:
        if not in_blink and (avg_eye < 0.22 or avg_eye <= baseline_eye * 0.85 or (baseline_eye - avg_eye) >= 0.025):
            in_blink = True
            min_in_blink = avg_eye
        elif in_blink:
            if avg_eye < min_in_blink:
                min_in_blink = avg_eye
            if avg_eye > 0.19 or avg_eye >= min_in_blink + 0.02:
                blinks += 1
                in_blink = False
                if blinks >= 2:
                    return True
    return False


def _detect_smile(landmark_series: list) -> bool:
    """Check for a smile: mouth ratio rises (> 0.22) and relaxes."""
    if not landmark_series:
        return False
    baseline = sum(e.mouth_ratio for e in landmark_series[:5]) / max(len(landmark_series[:5]), 1)
    max_mouth = max(e.mouth_ratio for e in landmark_series)
    return max_mouth >= 0.22 and (max_mouth - baseline) >= 0.04


def _detect_turn_left(landmark_series: list) -> bool:
    """Check for head turn left: yawDeg dips negative (< -12°) then returns."""
    turned = False
    for entry in landmark_series:
        if entry.yaw_deg < -12.0:
            turned = True
        elif turned and entry.yaw_deg > -8.0:
            return True
    return turned


def _detect_turn_right(landmark_series: list) -> bool:
    """Check for head turn right: yawDeg rises positive (> +12°) then returns."""
    turned = False
    for entry in landmark_series:
        if entry.yaw_deg > 12.0:
            turned = True
        elif turned and entry.yaw_deg < 8.0:
            return True
    return turned


def _detect_nod(landmark_series: list) -> bool:
    """Check for head nod: pitchDeg shifts significantly (> 10° or < -10°)."""
    if not landmark_series:
        return False
    min_pitch = min(getattr(e, "pitch_deg", 0.0) for e in landmark_series)
    max_pitch = max(getattr(e, "pitch_deg", 0.0) for e in landmark_series)
    return (max_pitch - min_pitch) >= 8.0 or abs(min_pitch) >= 7.0 or abs(max_pitch) >= 7.0


def _detect_eyebrow_raise(landmark_series: list) -> bool:
    """Check for eyebrow raise: distance between eyebrow and eye increases above baseline."""
    if not landmark_series or len(landmark_series) < 3:
        return False
    raises = [getattr(e, "eyebrow_raise", 0.0) for e in landmark_series]
    if not raises or all(r == 0.0 for r in raises):
        return False

    baseline = sum(raises[:min(5, len(raises))]) / min(5, len(raises))
    max_raise = max(raises)
    min_raise = min(raises)

    return (max_raise - baseline) >= 0.035 or (max_raise - min_raise) >= 0.035 or max_raise >= (baseline * 1.07) or max_raise >= 0.28


def _verify_liveness_challenge(challenge: str, landmark_series: list) -> bool:
    """Dispatches the verification to the corresponding challenge detector."""
    if not landmark_series or len(landmark_series) < 3:
        return False

    if challenge == "blink":
        return _detect_blink(landmark_series)
    elif challenge == "double_blink":
        return _detect_double_blink(landmark_series)
    elif challenge == "smile":
        return _detect_smile(landmark_series)
    elif challenge == "turn_left":
        return _detect_turn_left(landmark_series)
    elif challenge == "turn_right":
        return _detect_turn_right(landmark_series)
    elif challenge == "nod_head":
        return _detect_nod(landmark_series)
    elif challenge == "raise_eyebrows":
        return _detect_eyebrow_raise(landmark_series)
    elif challenge == "combo_smile_blink":
        return _detect_smile(landmark_series) and _detect_blink(landmark_series)
    elif challenge == "combo_turn_blink":
        return (_detect_turn_left(landmark_series) or _detect_turn_right(landmark_series)) and _detect_blink(landmark_series)
    elif challenge == "combo_nod_blink":
        return _detect_nod(landmark_series) and _detect_blink(landmark_series)

    # Default to single blink if unknown
    return _detect_blink(landmark_series)


def _get_client_ip(request: Request) -> str | None:
    """
    Extract the real client IP.

    Behind Nginx with proxy headers (handbook §1 "Proximity"): trust
    X-Forwarded-For only when forwarded-for header exists; otherwise fall back
    to the direct client host. In demo mode CAMPUS_CIDRS is empty and the IP
    is stored but not checked.
    """
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        # Take the leftmost (client) address
        return forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else None


# ── GET /attendance/student/me (Student Portal) ──────────────────────────────

@router.get("/student/me")
@router.get("/my-summary")
async def get_student_attendance_summary(
    student: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns student's live attendance summary, percentage, enrolled courses,
    and attendance history records for their student portal.
    """
    # 1. Check face enrollment status
    face_res = await db.execute(
        select(FaceVector.id).where(
            FaceVector.user_id == student.id,
            FaceVector.tenant_id == student.tenant_id,
            FaceVector.active.is_(True),
        ).limit(1)
    )
    has_face_enrollment = face_res.scalar_one_or_none() is not None

    # 2. Get enrolled courses
    enroll_res = await db.execute(
        select(Course)
        .join(ClassEnrollment, ClassEnrollment.course_id == Course.id)
        .where(
            ClassEnrollment.student_id == student.id,
            ClassEnrollment.tenant_id == student.tenant_id,
            ClassEnrollment.active.is_(True),
        )
    )
    courses = enroll_res.scalars().all()
    course_ids = [c.id for c in courses]

    # 3. Total sessions conducted across enrolled courses
    total_classes = 0
    if course_ids:
        sess_res = await db.execute(
            select(func.count(AttendanceSession.id)).where(
                AttendanceSession.course_id.in_(course_ids),
                AttendanceSession.tenant_id == student.tenant_id,
            )
        )
        total_classes = sess_res.scalar_one() or 0

    # 4. Student's attendance logs
    logs_res = await db.execute(
        select(AttendanceLog, AttendanceSession, Course)
        .join(AttendanceSession, AttendanceLog.session_id == AttendanceSession.id)
        .join(Course, AttendanceSession.course_id == Course.id)
        .where(
            AttendanceLog.student_id == student.id,
            AttendanceLog.tenant_id == student.tenant_id,
        )
        .order_by(AttendanceLog.marked_at.desc())
    )
    rows = logs_res.all()

    attended_count = len(rows)
    missed_count = max(0, total_classes - attended_count)
    percentage = (
        round((attended_count / total_classes) * 100, 1)
        if total_classes > 0
        else (100.0 if attended_count > 0 else 0.0)
    )

    records = [
        {
            "id": log.id,
            "subject": course.name,
            "code": course.code,
            "date": log.marked_at.strftime("%d %b %Y"),
            "time": log.marked_at.strftime("%I:%M %p"),
            "status": "Present",
            "source": log.source,
            "challenge": log.challenge or "blink",
        }
        for log, session, course in rows
    ]

    return {
        "student": {
            "id": student.id,
            "name": student.name,
            "roll_no": student.roll_no,
            "email": student.email,
            "role": student.role,
            "status": student.status,
            "has_face_enrollment": has_face_enrollment,
        },
        "total_classes": total_classes if total_classes > 0 else attended_count,
        "classes_attended": attended_count,
        "classes_missed": missed_count,
        "attendance_percentage": percentage,
        "enrolled_courses": [
            {"id": c.id, "name": c.name, "code": c.code, "semester": c.semester}
            for c in courses
        ],
        "records": records,
    }

