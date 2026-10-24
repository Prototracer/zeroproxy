from unittest.mock import AsyncMock, MagicMock
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.deps import get_current_user
from app.db import get_db
from app.models.course import Course
from app.models.user import User


@pytest.fixture
def client():
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
    db.flush = AsyncMock()
    db.commit = AsyncMock()

    async def fake_refresh(obj):
        if getattr(obj, "id", None) is None:
            obj.id = 1

    db.refresh = AsyncMock(side_effect=fake_refresh)

    async def fake_get_db():
        yield db

    app.dependency_overrides[get_db] = fake_get_db

    with TestClient(app) as test_client:
        yield test_client, db, faculty

    app.dependency_overrides.clear()


def test_list_faculty_classes(client):
    test_client, db, faculty = client

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

    mock_count = MagicMock()
    mock_count.scalar_one.return_value = 5

    mock_session = MagicMock()
    mock_session.scalar_one_or_none.return_value = None

    db.execute.side_effect = [mock_courses, mock_count, mock_session]

    response = test_client.get("/faculty/classes")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["code"] == "CS301"
    assert data[0]["student_count"] == 5
    assert data[0]["session"] == "No active session"


def test_create_faculty_class(client):
    test_client, db, faculty = client

    mock_code_check = MagicMock()
    mock_code_check.scalar_one_or_none.return_value = None

    db.execute.return_value = mock_code_check

    response = test_client.post(
        "/faculty/classes",
        json={
            "name": "Distributed Systems",
            "code": "CS401",
            "semester": "Semester 4",
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["code"] == "CS401"
    assert data["student_count"] == 0
    db.commit.assert_awaited()


def test_create_duplicate_class_code_rejected(client):
    test_client, db, faculty = client

    mock_code_check = MagicMock()
    mock_code_check.scalar_one_or_none.return_value = 1  # already exists

    db.execute.return_value = mock_code_check

    response = test_client.post(
        "/faculty/classes",
        json={
            "name": "Algorithms",
            "code": "CS301",
            "semester": "Semester 3",
        },
    )

    assert response.status_code == 409
