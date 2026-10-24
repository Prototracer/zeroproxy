from unittest.mock import AsyncMock, MagicMock
from app.core.deps import get_current_user
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.deps import require_role
from app.db import get_db
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
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    async def fake_get_db():
        yield db

    app.dependency_overrides[get_db] = fake_get_db

    with TestClient(app) as test_client:
        yield test_client, db, faculty

    app.dependency_overrides.clear()


def make_student(status="pending"):
    return User(
        id=20,
        tenant_id=1,
        roll_no="STU001",
        email="student@example.com",
        name="Test Student",
        password_hash="hashed",
        role="student",
        status=status,
        must_change_password=False,
    )


def test_faculty_can_list_pending_students(client):
    test_client, db, _ = client
    student = make_student()

    query_result = MagicMock()
    query_result.scalars.return_value.all.return_value = [student]
    db.execute.return_value = query_result

    response = test_client.get("/faculty/students/pending")

    assert response.status_code == 200
    assert len(response.json()) == 1
    assert response.json()[0]["roll_no"] == "STU001"


def test_faculty_can_approve_pending_student(client):
    test_client, db, _ = client
    student = make_student()

    query_result = MagicMock()
    query_result.scalar_one_or_none.return_value = student
    db.execute.return_value = query_result

    response = test_client.post("/faculty/students/20/approve")

    assert response.status_code == 200
    # Approval does NOT activate student; only face enrollment does
    assert student.status == "pending"
    db.commit.assert_awaited_once()


def test_approving_missing_student_returns_404(client):
    test_client, db, _ = client

    query_result = MagicMock()
    query_result.scalar_one_or_none.return_value = None
    db.execute.return_value = query_result

    response = test_client.post("/faculty/students/999/approve")

    assert response.status_code == 404


def test_in_person_password_reset(client):
    test_client, db, _ = client
    student = make_student(status="active")

    query_result = MagicMock()
    query_result.scalar_one_or_none.return_value = student
    db.execute.return_value = query_result

    response = test_client.post(
        "/faculty/students/20/reset-password",
        json={"new_password": "NewResetPassword123!"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["message"] == "Password reset successfully"
    assert data["temporary_password"] == "NewResetPassword123!"
    assert student.must_change_password is True
    db.commit.assert_awaited_once()


def test_faculty_enroll_student_requires_consent(client):
    test_client, _, _ = client
    descriptors = [[0.05] * 128 for _ in range(3)]

    # Consent False should fail validation (pydantic requires consent=True)
    response = test_client.post(
        "/faculty/students/20/enroll",
        json={
            "descriptors": descriptors,
            "consent": False,
        },
    )

    assert response.status_code == 422

