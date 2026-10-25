"""
Tests for Attendance Corrections (Phase 3).
Covers:
  - Session unified effective attendance resolution (present, absent)
  - Append-only corrections (absent -> present, present -> absent)
  - Latest correction wins
  - Mandatory reason validation
  - Faculty scoping & ownership
  - Student summary reflects unified attendance
  - Class session listing
"""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.deps import get_current_user
from app.db import get_db
from app.models.attendance_correction import AttendanceCorrection
from app.models.attendance_log import AttendanceLog
from app.models.attendance_session import AttendanceSession
from app.models.audit import AuditEvent
from app.models.class_enrollment import ClassEnrollment
from app.models.course import Course
from app.models.user import User


@pytest.fixture
def faculty_user():
    return User(
        id=20,
        tenant_id=1,
        roll_no="FAC020",
        email="prof.smith@college.edu",
        name="Prof. Smith",
        role="faculty",
        status="active",
        password_hash="hashed",
    )


@pytest.fixture
def other_faculty_user():
    return User(
        id=21,
        tenant_id=1,
        roll_no="FAC021",
        email="prof.jones@college.edu",
        name="Prof. Jones",
        role="faculty",
        status="active",
        password_hash="hashed",
    )


@pytest.fixture
def test_course():
    return Course(
        id=101,
        tenant_id=1,
        faculty_id=20,
        name="Database Systems",
        code="CS301",
        semester="Semester 5",
        join_code="DB301X",
        join_code_enabled=True,
    )


@pytest.fixture
def student_alice():
    return User(
        id=11,
        tenant_id=1,
        roll_no="25BCS011",
        email="alice@college.edu",
        name="Alice Kumar",
        role="student",
        status="active",
        password_hash="hashed",
    )


@pytest.fixture
def student_bob():
    return User(
        id=12,
        tenant_id=1,
        roll_no="25BCS012",
        email="bob@college.edu",
        name="Bob Sharma",
        role="student",
        status="active",
        password_hash="hashed",
    )


@pytest.fixture
def test_session(test_course):
    return AttendanceSession(
        id=501,
        tenant_id=1,
        course_id=test_course.id,
        faculty_id=20,
        started_at=datetime(2026, 10, 20, 10, 0, tzinfo=timezone.utc),
        ended_at=datetime(2026, 10, 20, 11, 0, tzinfo=timezone.utc),
        status="ended",
    )


def test_get_session_unified_attendance_default_statuses(
    faculty_user, test_course, test_session, student_alice, student_bob
):
    """Alice has AttendanceLog -> present. Bob has no log -> absent."""
    app.dependency_overrides[get_current_user] = lambda: faculty_user
    db = MagicMock()
    db.execute = AsyncMock()

    # 1. Ownership check: session query
    mock_sess_check = MagicMock()
    mock_sess_check.scalar_one_or_none.return_value = test_session

    # In resolve_session_effective_attendance:
    # 2. session & course join
    mock_sc = MagicMock()
    mock_sc.first.return_value = (test_session, test_course)

    # 3. active students
    mock_active = MagicMock()
    mock_active.scalars.return_value.all.return_value = [student_alice, student_bob]

    # 4. logs: Alice is present
    alice_log = AttendanceLog(
        id=901,
        tenant_id=1,
        session_id=test_session.id,
        student_id=student_alice.id,
        marked_at=datetime(2026, 10, 20, 10, 5, tzinfo=timezone.utc),
        source="scan",
    )
    mock_logs = MagicMock()
    mock_logs.scalars.return_value.all.return_value = [alice_log]

    # 5. overrides
    mock_overrides = MagicMock()
    mock_overrides.scalars.return_value.all.return_value = []

    # 6. corrections
    mock_corrections = MagicMock()
    mock_corrections.scalars.return_value.all.return_value = []

    db.execute.side_effect = [
        mock_sess_check,
        mock_sc,
        mock_active,
        mock_logs,
        mock_overrides,
        mock_corrections,
    ]

    async def fake_get_db():
        yield db

    app.dependency_overrides[get_db] = fake_get_db

    with TestClient(app) as client:
        res = client.get(f"/faculty/sessions/{test_session.id}/attendance")
        assert res.status_code == 200
        data = res.json()
        assert data["session_id"] == 501
        assert data["class_name"] == "Database Systems"
        assert data["total_students"] == 2
        assert data["present_count"] == 1
        assert data["absent_count"] == 1

        students_by_id = {s["student_id"]: s for s in data["students"]}
        assert students_by_id[student_alice.id]["status"] == "present"
        assert students_by_id[student_alice.id]["source"] == "scan"

        assert students_by_id[student_bob.id]["status"] == "absent"
        assert students_by_id[student_bob.id]["source"] is None

    app.dependency_overrides.clear()


def test_create_attendance_correction_absent_to_present(
    faculty_user, test_session, student_bob
):
    """Correct Bob from absent to present with valid reason."""
    app.dependency_overrides[get_current_user] = lambda: faculty_user
    db = MagicMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()
    async def fake_refresh(obj):
        if getattr(obj, "id", None) is None:
            obj.id = 1

    db.refresh = AsyncMock(side_effect=fake_refresh)

    # 1. session ownership check
    mock_sess = MagicMock()
    mock_sess.scalar_one_or_none.return_value = test_session

    # 2. student lookup
    mock_student = MagicMock()
    mock_student.scalar_one_or_none.return_value = student_bob

    db.execute.side_effect = [mock_sess, mock_student]

    async def fake_get_db():
        yield db

    app.dependency_overrides[get_db] = fake_get_db

    with TestClient(app) as client:
        payload = {
            "student_id": student_bob.id,
            "status": "present",
            "reason": "Submitted valid medical leave certificate",
        }
        res = client.post(f"/faculty/sessions/{test_session.id}/corrections", json=payload)
        assert res.status_code == 201
        data = res.json()
        assert data["session_id"] == test_session.id
        assert data["student_id"] == student_bob.id
        assert data["status"] == "present"
        assert data["reason"] == "Submitted valid medical leave certificate"

        # Verify AttendanceCorrection added
        added_objs = [call.args[0] for call in db.add.call_args_list]
        corrections = [o for o in added_objs if isinstance(o, AttendanceCorrection)]
        assert len(corrections) == 1
        assert corrections[0].status == "present"
        assert corrections[0].student_id == student_bob.id

        # Verify AuditEvent added
        audits = [o for o in added_objs if isinstance(o, AuditEvent)]
        assert len(audits) == 1
        assert audits[0].action == "attendance_corrected"

    app.dependency_overrides.clear()


def test_create_attendance_correction_present_to_absent(
    faculty_user, test_session, student_alice
):
    """Correct Alice from present to absent with valid reason."""
    app.dependency_overrides[get_current_user] = lambda: faculty_user
    db = MagicMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()
    async def fake_refresh(obj):
        if getattr(obj, "id", None) is None:
            obj.id = 1

    db.refresh = AsyncMock(side_effect=fake_refresh)

    mock_sess = MagicMock()
    mock_sess.scalar_one_or_none.return_value = test_session

    mock_student = MagicMock()
    mock_student.scalar_one_or_none.return_value = student_alice

    db.execute.side_effect = [mock_sess, mock_student]

    async def fake_get_db():
        yield db

    app.dependency_overrides[get_db] = fake_get_db

    with TestClient(app) as client:
        payload = {
            "student_id": student_alice.id,
            "status": "absent",
            "reason": "Left laboratory session without instructor permission",
        }
        res = client.post(f"/faculty/sessions/{test_session.id}/corrections", json=payload)
        assert res.status_code == 201
        data = res.json()
        assert data["status"] == "absent"
        assert data["student_id"] == student_alice.id

    app.dependency_overrides.clear()


def test_correction_reason_validation(faculty_user, test_session, student_bob):
    """Correction reason must be at least 3 characters."""
    app.dependency_overrides[get_current_user] = lambda: faculty_user
    db = MagicMock()
    db.execute = AsyncMock()

    mock_sess = MagicMock()
    mock_sess.scalar_one_or_none.return_value = test_session

    db.execute.side_effect = [mock_sess]

    async def fake_get_db():
        yield db

    app.dependency_overrides[get_db] = fake_get_db

    with TestClient(app) as client:
        # 1. Too short
        res1 = client.post(
            f"/faculty/sessions/{test_session.id}/corrections",
            json={"student_id": student_bob.id, "status": "present", "reason": "ok"},
        )
        assert res1.status_code == 422

        # 2. Whitespace only
        res2 = client.post(
            f"/faculty/sessions/{test_session.id}/corrections",
            json={"student_id": student_bob.id, "status": "present", "reason": "   "},
        )
        assert res2.status_code == 422

    app.dependency_overrides.clear()


def test_correction_non_owner_forbidden(other_faculty_user, test_session, student_bob):
    """Faculty who doesn't own the session cannot correct it."""
    app.dependency_overrides[get_current_user] = lambda: other_faculty_user
    db = MagicMock()
    db.execute = AsyncMock()

    mock_sess = MagicMock()
    mock_sess.scalar_one_or_none.return_value = None  # Scoped query returns None for non-owner

    db.execute.side_effect = [mock_sess]

    async def fake_get_db():
        yield db

    app.dependency_overrides[get_db] = fake_get_db

    with TestClient(app) as client:
        res = client.post(
            f"/faculty/sessions/{test_session.id}/corrections",
            json={"student_id": student_bob.id, "status": "present", "reason": "Valid reason here"},
        )
        assert res.status_code == 404

    app.dependency_overrides.clear()


def test_latest_correction_wins(
    faculty_user, test_course, test_session, student_alice
):
    """If multiple corrections exist for a student, the latest one wins."""
    app.dependency_overrides[get_current_user] = lambda: faculty_user
    db = MagicMock()
    db.execute = AsyncMock()

    mock_sess_check = MagicMock()
    mock_sess_check.scalar_one_or_none.return_value = test_session

    mock_sc = MagicMock()
    mock_sc.first.return_value = (test_session, test_course)

    mock_active = MagicMock()
    mock_active.scalars.return_value.all.return_value = [student_alice]

    # Alice has original attendance log (present)
    alice_log = AttendanceLog(
        id=901,
        tenant_id=1,
        session_id=test_session.id,
        student_id=student_alice.id,
        marked_at=datetime(2026, 10, 20, 10, 5, tzinfo=timezone.utc),
        source="scan",
    )
    mock_logs = MagicMock()
    mock_logs.scalars.return_value.all.return_value = [alice_log]

    mock_overrides = MagicMock()
    mock_overrides.scalars.return_value.all.return_value = []

    # First correction marked Alice absent; Second correction marked Alice present again
    corr1 = AttendanceCorrection(
        id=1,
        tenant_id=1,
        session_id=test_session.id,
        student_id=student_alice.id,
        faculty_id=20,
        status="absent",
        reason="Left early",
        created_at=datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc),
    )
    corr2 = AttendanceCorrection(
        id=2,
        tenant_id=1,
        session_id=test_session.id,
        student_id=student_alice.id,
        faculty_id=20,
        status="present",
        reason="Mistake resolved by HOD approval",
        created_at=datetime(2026, 10, 20, 14, 0, tzinfo=timezone.utc),
    )
    mock_corrections = MagicMock()
    # Order by id.asc as in the service
    mock_corrections.scalars.return_value.all.return_value = [corr1, corr2]

    db.execute.side_effect = [
        mock_sess_check,
        mock_sc,
        mock_active,
        mock_logs,
        mock_overrides,
        mock_corrections,
    ]

    async def fake_get_db():
        yield db

    app.dependency_overrides[get_db] = fake_get_db

    with TestClient(app) as client:
        res = client.get(f"/sessions/{test_session.id}/attendance")
        assert res.status_code == 200
        data = res.json()
        assert data["present_count"] == 1
        assert data["absent_count"] == 0
        alice_data = data["students"][0]
        # Latest correction was corr2 (present)
        assert alice_data["status"] == "present"
        assert alice_data["source"] == "correction"
        assert alice_data["reason"] == "Mistake resolved by HOD approval"
        assert alice_data["correction_id"] == 2

    app.dependency_overrides.clear()


def test_list_class_sessions(faculty_user, test_course, test_session, student_alice):
    """Faculty can list all sessions of a class with turnout counts."""
    app.dependency_overrides[get_current_user] = lambda: faculty_user
    db = MagicMock()
    db.execute = AsyncMock()

    mock_course = MagicMock()
    mock_course.scalar_one_or_none.return_value = test_course

    mock_st_cnt = MagicMock()
    mock_st_cnt.scalar_one.return_value = 1

    mock_sess_list = MagicMock()
    mock_sess_list.scalars.return_value.all.return_value = [test_session]

    # For resolve_session_effective_attendance loop
    mock_sc = MagicMock()
    mock_sc.first.return_value = (test_session, test_course)

    mock_active = MagicMock()
    mock_active.scalars.return_value.all.return_value = [student_alice]

    alice_log = AttendanceLog(
        id=901,
        tenant_id=1,
        session_id=test_session.id,
        student_id=student_alice.id,
        marked_at=datetime(2026, 10, 20, 10, 5, tzinfo=timezone.utc),
        source="scan",
    )
    mock_logs = MagicMock()
    mock_logs.scalars.return_value.all.return_value = [alice_log]

    mock_ov = MagicMock()
    mock_ov.scalars.return_value.all.return_value = []

    mock_corr = MagicMock()
    mock_corr.scalars.return_value.all.return_value = []

    db.execute.side_effect = [
        mock_course,
        mock_st_cnt,
        mock_sess_list,
        mock_sc,
        mock_active,
        mock_logs,
        mock_ov,
        mock_corr,
    ]

    async def fake_get_db():
        yield db

    app.dependency_overrides[get_db] = fake_get_db

    with TestClient(app) as client:
        res = client.get(f"/faculty/classes/{test_course.id}/sessions")
        assert res.status_code == 200
        data = res.json()
        assert len(data) == 1
        assert data[0]["id"] == test_session.id
        assert data[0]["present_count"] == 1
        assert data[0]["total_students"] == 1

    app.dependency_overrides.clear()
