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
