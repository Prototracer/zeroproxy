from unittest.mock import AsyncMock, MagicMock
from fastapi.testclient import TestClient

from app.main import app
from app.db import get_db
from app.core.security import create_access_token
from app.models.user import User


class FakeUser:
    def __init__(
        self,
        user_id=1,
        role="faculty",
        status="active",
        tenant_id=1,
    ):
        self.id = user_id
        self.role = role
        self.status = status
        self.tenant_id = tenant_id


def make_db_override(auth_user, endpoint_result=None):
    auth_result = MagicMock()
    auth_result.scalar_one_or_none.return_value = auth_user

    query_result = MagicMock()
    query_result.scalar_one_or_none.return_value = endpoint_result
    query_result.scalars.return_value.all.return_value = (
        [endpoint_result] if endpoint_result is not None else []
    )

    db = MagicMock()
    db.execute = AsyncMock(side_effect=[auth_result, query_result])
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    async def override_get_db():
        yield db

    return override_get_db, db


def make_student():
    return User(
        id=2,
        tenant_id=1,
        name="Test Student",
        email="student@example.com",
        roll_no="ROLL002",
        password_hash="not-a-real-password-hash",
        role="student",
        status="pending",
        must_change_password=False,
    )


def test_student_cannot_list_pending_students():
    student_user = FakeUser(user_id=10, role="student")
    override, _ = make_db_override(student_user)
    app.dependency_overrides[get_db] = override
    token = create_access_token(
        user_id=student_user.id,
        role=student_user.role,
    )

    try:
        with TestClient(app) as client:
            response = client.get(
                "/faculty/students/pending",
                headers={"Authorization": f"Bearer {token}"},
            )

        assert response.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_faculty_can_list_pending_students():
    faculty_user = FakeUser()
    pending_student = make_student()
    override, _ = make_db_override(faculty_user, pending_student)
    app.dependency_overrides[get_db] = override
    token = create_access_token(
        user_id=faculty_user.id,
        role=faculty_user.role,
    )

    try:
        with TestClient(app) as client:
            response = client.get(
                "/faculty/students/pending",
                headers={"Authorization": f"Bearer {token}"},
            )

        assert response.status_code == 200
        assert len(response.json()) == 1
        assert response.json()[0]["id"] == 2
        assert response.json()[0]["status"] == "pending"
        assert "password_hash" not in response.json()[0]
    finally:
        app.dependency_overrides.clear()


def test_faculty_can_approve_pending_student():
    faculty_user = FakeUser()
    student = make_student()
    override, db = make_db_override(faculty_user, student)
    app.dependency_overrides[get_db] = override
    token = create_access_token(
        user_id=faculty_user.id,
        role=faculty_user.role,
    )

    try:
        with TestClient(app) as client:
            response = client.post(
                "/faculty/students/2/approve",
                headers={"Authorization": f"Bearer {token}"},
            )

        assert response.status_code == 200
        assert response.json()["status"] == "active"
        assert student.status == "active"
        db.commit.assert_awaited_once()
    finally:
        app.dependency_overrides.clear()


def test_approving_missing_student_returns_404():
    faculty_user = FakeUser()
    override, _ = make_db_override(faculty_user, None)
    app.dependency_overrides[get_db] = override
    token = create_access_token(
        user_id=faculty_user.id,
        role=faculty_user.role,
    )

    try:
        with TestClient(app) as client:
            response = client.post(
                "/faculty/students/999/approve",
                headers={"Authorization": f"Bearer {token}"},
            )

        assert response.status_code == 404
    finally:
        app.dependency_overrides.clear()