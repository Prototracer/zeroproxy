from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.deps import get_current_user
from app.db import get_db
from app.models.attendance_session import AttendanceSession
from app.models.class_enrollment import ClassEnrollment
from app.models.user import User


@pytest.fixture
def faculty_client():
    faculty = User(
        id=10,
        tenant_id=1,
        roll_no="FAC001",
        email="faculty@example.com",
        name="Test Faculty",
        password_hash="hashed",
        role="faculty",
        status="active",
    )

    async def fake_current_user():
        return faculty

    app.dependency_overrides[get_current_user] = fake_current_user

    db = MagicMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    async def fake_get_db():
        yield db

    app.dependency_overrides[get_db] = fake_get_db

    with TestClient(app) as test_client:
        yield test_client, db, faculty

    app.dependency_overrides.clear()


def test_faculty_can_override_attendance(faculty_client):
    test_client, db, faculty = faculty_client

    session = AttendanceSession(
        id=1,
        tenant_id=1,
        course_id=5,
        faculty_id=10,
        status="active",
        started_at=datetime.now(timezone.utc),
    )

    student = User(
        id=20,
        tenant_id=1,
        roll_no="STU001",
        email="student@example.com",
        name="Student One",
        password_hash="hashed",
        role="student",
        status="active",
    )

    mock_session = MagicMock()
    mock_session.scalar_one_or_none.return_value = session

    mock_student = MagicMock()
    mock_student.scalar_one_or_none.return_value = student

    mock_enrollment = MagicMock()
    mock_enrollment.scalar_one_or_none.return_value = 1  # enrolled

    mock_existing_log = MagicMock()
    mock_existing_log.scalar_one_or_none.return_value = None  # not marked yet

    db.execute.side_effect = [
        mock_session,
        mock_student,
        mock_enrollment,
        mock_existing_log,
    ]

    response = test_client.post(
        "/sessions/1/override",
        json={
            "student_id": 20,
            "reason": "Medical leave verified with doctor note",
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["status"] == "marked"
    assert data["source"] == "override"
    assert data["student_id"] == 20
    db.commit.assert_awaited_once()


def test_override_allowed_after_session_ended(faculty_client):
    test_client, db, faculty = faculty_client

    ended_session = AttendanceSession(
        id=1,
        tenant_id=1,
        course_id=5,
        faculty_id=10,
        status="ended",
        started_at=datetime.now(timezone.utc),
        ended_at=datetime.now(timezone.utc),
    )

    student = User(
        id=20,
        tenant_id=1,
        roll_no="STU001",
        email="student@example.com",
        name="Student One",
        password_hash="hashed",
        role="student",
        status="active",
    )

    mock_session = MagicMock()
    mock_session.scalar_one_or_none.return_value = ended_session

    mock_student = MagicMock()
    mock_student.scalar_one_or_none.return_value = student

    mock_enrollment = MagicMock()
    mock_enrollment.scalar_one_or_none.return_value = 1

    mock_existing_log = MagicMock()
    mock_existing_log.scalar_one_or_none.return_value = None

    db.execute.side_effect = [
        mock_session,
        mock_student,
        mock_enrollment,
        mock_existing_log,
    ]

    response = test_client.post(
        "/sessions/1/override",
        json={
            "student_id": 20,
            "reason": "Late duty on official college event",
        },
    )

    assert response.status_code == 201
    assert response.json()["source"] == "override"


def test_override_rejects_already_marked(faculty_client):
    test_client, db, faculty = faculty_client

    session = AttendanceSession(
        id=1,
        tenant_id=1,
        course_id=5,
        faculty_id=10,
        status="active",
        started_at=datetime.now(timezone.utc),
    )

    student = User(
        id=20,
        tenant_id=1,
        roll_no="STU001",
        email="student@example.com",
        name="Student One",
        password_hash="hashed",
        role="student",
        status="active",
    )

    mock_session = MagicMock()
    mock_session.scalar_one_or_none.return_value = session

    mock_student = MagicMock()
    mock_student.scalar_one_or_none.return_value = student

    mock_enrollment = MagicMock()
    mock_enrollment.scalar_one_or_none.return_value = 1

    mock_existing_log = MagicMock()
    mock_existing_log.scalar_one_or_none.return_value = 99  # already marked

    db.execute.side_effect = [
        mock_session,
        mock_student,
        mock_enrollment,
        mock_existing_log,
    ]

    response = test_client.post(
        "/sessions/1/override",
        json={
            "student_id": 20,
            "reason": "Attempting duplicate override",
        },
    )

    assert response.status_code == 409


def test_override_rejects_student_not_in_class(faculty_client):
    test_client, db, faculty = faculty_client

    session = AttendanceSession(
        id=1,
        tenant_id=1,
        course_id=5,
        faculty_id=10,
        status="active",
        started_at=datetime.now(timezone.utc),
    )

    student = User(
        id=20,
        tenant_id=1,
        roll_no="STU001",
        email="student@example.com",
        name="Student One",
        password_hash="hashed",
        role="student",
        status="active",
    )

    mock_session = MagicMock()
    mock_session.scalar_one_or_none.return_value = session

    mock_student = MagicMock()
    mock_student.scalar_one_or_none.return_value = student

    mock_enrollment = MagicMock()
    mock_enrollment.scalar_one_or_none.return_value = None  # Not enrolled in this course

    db.execute.side_effect = [
        mock_session,
        mock_student,
        mock_enrollment,
    ]

    response = test_client.post(
        "/sessions/1/override",
        json={
            "student_id": 20,
            "reason": "medical",
        },
    )

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_override_bulk_success_with_mixed_already_marked(faculty_client):
    test_client, db, faculty = faculty_client

    session = AttendanceSession(
        id=1,
        tenant_id=1,
        course_id=5,
        faculty_id=10,
        status="active",
        started_at=datetime.now(timezone.utc),
    )

    mock_session = MagicMock()
    mock_session.scalar_one_or_none.return_value = session

    mock_users = MagicMock()
    mock_users.scalars.return_value.all.return_value = [20, 21, 22]

    mock_enrollments = MagicMock()
    mock_enrollments.scalars.return_value.all.return_value = [20, 21, 22]

    mock_existing_logs = MagicMock()
    mock_existing_logs.scalars.return_value.all.return_value = [20]  # 20 already marked

    db.execute.side_effect = [
        mock_session,
        mock_users,
        mock_enrollments,
        mock_existing_logs,
    ]

    response = test_client.post(
        "/sessions/1/override",
        json={
            "student_ids": [20, 21, 22],
            "reason": "sports",
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["marked"] == [21, 22]
    assert data["already_marked"] == [20]
    assert data["marked_count"] == 2
    assert data["already_marked_count"] == 1
    # Check that AttendanceLog, Override, and AuditEvent were added for 21 and 22
    assert db.add.call_count >= 6  # 2 logs + 2 overrides + 2 audits
    db.commit.assert_awaited_once()


def test_override_rejects_51_students(faculty_client):
    test_client, db, faculty = faculty_client

    # 51 students violates max_length=50
    fifty_one_ids = list(range(1, 52))
    response = test_client.post(
        "/sessions/1/override",
        json={
            "student_ids": fifty_one_ids,
            "reason": "hackathon",
        },
    )

    assert response.status_code == 422


def test_override_deduplicates_duplicate_ids(faculty_client):
    test_client, db, faculty = faculty_client

    session = AttendanceSession(
        id=1,
        tenant_id=1,
        course_id=5,
        faculty_id=10,
        status="active",
        started_at=datetime.now(timezone.utc),
    )

    mock_session = MagicMock()
    mock_session.scalar_one_or_none.return_value = session

    mock_users = MagicMock()
    mock_users.scalars.return_value.all.return_value = [20, 21]

    mock_enrollments = MagicMock()
    mock_enrollments.scalars.return_value.all.return_value = [20, 21]

    mock_existing_logs = MagicMock()
    mock_existing_logs.scalars.return_value.all.return_value = []

    db.execute.side_effect = [
        mock_session,
        mock_users,
        mock_enrollments,
        mock_existing_logs,
    ]

    # Send duplicates [20, 20, 21, 21]
    response = test_client.post(
        "/sessions/1/override",
        json={
            "student_ids": [20, 20, 21, 21],
            "reason": "hackathon",
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["marked"] == [20, 21]
    assert data["marked_count"] == 2


def test_override_requires_note_when_reason_is_other(faculty_client):
    test_client, db, faculty = faculty_client

    session = AttendanceSession(
        id=1,
        tenant_id=1,
        course_id=5,
        faculty_id=10,
        status="active",
        started_at=datetime.now(timezone.utc),
    )

    student = User(
        id=20,
        tenant_id=1,
        roll_no="STU001",
        email="student@example.com",
        name="Student One",
        password_hash="hashed",
        role="student",
        status="active",
    )

    mock_session = MagicMock()
    mock_session.scalar_one_or_none.return_value = session

    mock_student = MagicMock()
    mock_student.scalar_one_or_none.return_value = student

    mock_enrollment = MagicMock()
    mock_enrollment.scalar_one_or_none.return_value = 1

    mock_existing_log = MagicMock()
    mock_existing_log.scalar_one_or_none.return_value = None

    db.execute.side_effect = [
        mock_session,
        mock_student,
        mock_enrollment,
        mock_existing_log,
    ]

    # Without note -> 422
    response = test_client.post(
        "/sessions/1/override",
        json={
            "student_id": 20,
            "reason": "other",
        },
    )
    assert response.status_code == 422

    # With non-empty note -> 201
    db.execute.side_effect = [
        mock_session,
        mock_student,
        mock_enrollment,
        mock_existing_log,
    ]
    response_ok = test_client.post(
        "/sessions/1/override",
        json={
            "student_id": 20,
            "reason": "other",
            "note": "Family emergency confirmed by advisor",
        },
    )
    assert response_ok.status_code == 201
    assert response_ok.json()["reason"] == "other"


def test_override_out_of_scope_faculty_returns_404(faculty_client):
    test_client, db, faculty = faculty_client

    # Session belongs to faculty 99, current faculty is 10
    session_other = AttendanceSession(
        id=1,
        tenant_id=1,
        course_id=5,
        faculty_id=99,
        status="active",
        started_at=datetime.now(timezone.utc),
    )

    mock_session = MagicMock()
    mock_session.scalar_one_or_none.return_value = session_other

    db.execute.side_effect = [mock_session]

    response = test_client.post(
        "/sessions/1/override",
        json={
            "student_id": 20,
            "reason": "medical",
        },
    )

    assert response.status_code == 404

