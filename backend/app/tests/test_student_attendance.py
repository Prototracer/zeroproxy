from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.deps import get_current_user
from app.db import get_db
from app.models.attendance_log import AttendanceLog
from app.models.attendance_session import AttendanceSession
from app.models.course import Course
from app.models.user import User


@pytest.fixture
def student_client():
    student = User(
        id=20,
        tenant_id=1,
        roll_no="STU001",
        email="student@example.com",
        name="Test Student",
        password_hash="hashed",
        role="student",
        status="active",
        must_change_password=False,
    )

    async def fake_current_user():
        return student

    app.dependency_overrides[get_current_user] = fake_current_user

    db = MagicMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    async def fake_get_db():
        yield db

    app.dependency_overrides[get_db] = fake_get_db

    with TestClient(app) as test_client:
        yield test_client, db, student

    app.dependency_overrides.clear()


def test_get_student_attendance_summary(student_client):
    test_client, db, student = student_client

    # 1. Face vector check (enrolled)
    mock_face = MagicMock()
    mock_face.scalar_one_or_none.return_value = 1

    # 2. Enrolled courses
    course = Course(
        id=1,
        tenant_id=1,
        name="Algorithms",
        code="CS301",
        semester="Semester 3",
        faculty_id=10,
    )
    mock_courses = MagicMock()
    mock_courses.scalars.return_value.all.return_value = [course]

    # 3. Total sessions
    mock_total_sess = MagicMock()
    mock_total_sess.scalar_one.return_value = 10

    # 4. Logs
    session = AttendanceSession(
        id=1,
        tenant_id=1,
        course_id=1,
        faculty_id=10,
        status="ended",
    )
    log = AttendanceLog(
        id=101,
        tenant_id=1,
        session_id=1,
        student_id=20,
        marked_at=datetime.now(timezone.utc),
        source="scan",
    )
    mock_logs = MagicMock()
    mock_logs.all.return_value = [(log, session, course)]

    db.execute.side_effect = [
        mock_face,
        mock_courses,
        mock_total_sess,
        mock_logs,
    ]

    response = test_client.get("/attendance/student/me")
    assert response.status_code == 200
    data = response.json()
    assert data["student"]["name"] == "Test Student"
    assert data["student"]["has_face_enrollment"] is True
    assert data["total_classes"] == 10
    assert data["classes_attended"] == 1
    assert data["classes_missed"] == 9
    assert data["attendance_percentage"] == 10.0
    assert len(data["records"]) == 1
    assert data["records"][0]["subject"] == "Algorithms"
