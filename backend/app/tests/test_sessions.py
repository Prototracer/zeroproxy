"""
Tests for session management endpoints — POST /sessions, POST /sessions/{id}/end,
GET /sessions/{id}/qr, GET /sessions/{id}/live.

Covers handbook §8.1 requirements:
  - Role: a student calling faculty endpoints gets 403
  - Role: faculty B cannot read faculty A's session QR
  - Session creation and ending lifecycle
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.core.deps import get_current_user
from app.db import get_db
from app.main import app
from app.models.attendance_session import AttendanceSession
from app.models.course import Course
from app.models.user import User


def make_faculty(user_id=10, tenant_id=1):
    return User(
        id=user_id,
        tenant_id=tenant_id,
        roll_no=f"FAC{user_id:03d}",
        email=f"faculty{user_id}@example.com",
        name=f"Faculty {user_id}",
        password_hash="hashed",
        role="faculty",
        status="active",
        must_change_password=False,
    )


def make_student(user_id=20, tenant_id=1):
    return User(
        id=user_id,
        tenant_id=tenant_id,
        roll_no=f"STU{user_id:03d}",
        email=f"student{user_id}@example.com",
        name=f"Student {user_id}",
        password_hash="hashed",
        role="student",
        status="active",
        must_change_password=False,
    )


def make_session(session_id=1, course_id=5, faculty_id=10, status="active", tenant_id=1):
    from datetime import datetime, timezone
    s = AttendanceSession(
        id=session_id,
        tenant_id=tenant_id,
        course_id=course_id,
        faculty_id=faculty_id,
        status=status,
    )
    s.started_at = datetime.now(timezone.utc)
    s.ended_at = None
    return s


@pytest.fixture
def faculty_client():
    faculty = make_faculty()
    db = MagicMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.add = MagicMock()

    async def fake_user():
        return faculty

    async def fake_db():
        yield db

    app.dependency_overrides[get_current_user] = fake_user
    app.dependency_overrides[get_db] = fake_db

    with TestClient(app) as client:
        yield client, db, faculty

    app.dependency_overrides.clear()


@pytest.fixture
def student_client():
    student = make_student()
    db = MagicMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.add = MagicMock()

    async def fake_user():
        return student

    async def fake_db():
        yield db

    app.dependency_overrides[get_current_user] = fake_user
    app.dependency_overrides[get_db] = fake_db

    with TestClient(app) as client:
        yield client, db, student

    app.dependency_overrides.clear()


# ── POST /sessions ────────────────────────────────────────────────────────────

class TestCreateSession:
    def test_faculty_can_create_session_for_own_course(self, faculty_client):
        client, db, faculty = faculty_client
        course = Course(id=5, tenant_id=1, name="OS", code="CS301", semester="S1", faculty_id=faculty.id)
        session = make_session()

        # First execute call returns course; second is session add (via refresh)
        course_result = MagicMock()
        course_result.scalar_one_or_none.return_value = course
        db.execute.return_value = course_result

        from datetime import datetime, timezone
        def _fake_refresh(obj, *a, **kw):
            obj.id = 1
            obj.ended_at = None
            obj.started_at = datetime.now(timezone.utc)
        db.refresh = AsyncMock(side_effect=_fake_refresh)

        response = client.post("/sessions", json={"course_id": 5})
        assert response.status_code == 201

    def test_student_cannot_create_session(self, student_client):
        """Student calling POST /sessions gets 403 (handbook §8.1 Roles)."""
        client, db, _ = student_client
        response = client.post("/sessions", json={"course_id": 5})
        assert response.status_code == 403

    def test_faculty_cannot_create_session_for_another_facultys_course(self, faculty_client):
        """Course not found or wrong faculty returns 403."""
        client, db, faculty = faculty_client
        result = MagicMock()
        result.scalar_one_or_none.return_value = None  # Course not found for this faculty
        db.execute.return_value = result

        response = client.post("/sessions", json={"course_id": 99})
        assert response.status_code == 403


# ── POST /sessions/{id}/end ──────────────────────────────────────────────────

class TestEndSession:
    def test_faculty_can_end_own_active_session(self, faculty_client):
        client, db, faculty = faculty_client
        session = make_session(faculty_id=faculty.id)

        result = MagicMock()
        result.scalar_one_or_none.return_value = session
        db.execute.return_value = result
        db.refresh = AsyncMock()

        response = client.post("/sessions/1/end")
        assert response.status_code == 200
        assert session.status == "ended"

    def test_ending_already_ended_session_returns_409(self, faculty_client):
        client, db, faculty = faculty_client
        session = make_session(faculty_id=faculty.id, status="ended")

        result = MagicMock()
        result.scalar_one_or_none.return_value = session
        db.execute.return_value = result

        response = client.post("/sessions/1/end")
        assert response.status_code == 409

    def test_faculty_cannot_end_another_facultys_session(self, faculty_client):
        client, db, faculty = faculty_client
        # Session owned by faculty ID 99 (not current faculty ID 10)
        session = make_session(faculty_id=99)

        result = MagicMock()
        result.scalar_one_or_none.return_value = session
        db.execute.return_value = result

        response = client.post("/sessions/1/end")
        assert response.status_code == 403


# ── GET /sessions/{id}/qr ────────────────────────────────────────────────────

class TestGetQR:
    def test_owner_can_get_qr_for_active_session(self, faculty_client):
        client, db, faculty = faculty_client
        session = make_session(faculty_id=faculty.id)

        result = MagicMock()
        result.scalar_one_or_none.return_value = session
        db.execute.return_value = result

        response = client.get("/sessions/1/qr")
        assert response.status_code == 200
        data = response.json()
        assert "mac" in data
        assert "session_id" in data
        assert "expires_in_ms" in data

    def test_qr_for_ended_session_returns_409(self, faculty_client):
        client, db, faculty = faculty_client
        session = make_session(faculty_id=faculty.id, status="ended")

        result = MagicMock()
        result.scalar_one_or_none.return_value = session
        db.execute.return_value = result

        response = client.get("/sessions/1/qr")
        assert response.status_code == 409

    def test_another_faculty_cannot_get_qr(self, faculty_client):
        """Faculty B cannot read faculty A's QR (handbook §8.1 Roles)."""
        client, db, faculty = faculty_client
        # Session owned by faculty 99, not current faculty (10)
        session = make_session(faculty_id=99)

        result = MagicMock()
        result.scalar_one_or_none.return_value = session
        db.execute.return_value = result

        response = client.get("/sessions/1/qr")
        assert response.status_code == 403

    def test_student_cannot_get_qr(self, student_client):
        """Student calling GET /sessions/{id}/qr gets 403."""
        client, db, _ = student_client
        response = client.get("/sessions/1/qr")
        assert response.status_code == 403
