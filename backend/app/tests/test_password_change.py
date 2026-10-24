from unittest.mock import AsyncMock, MagicMock
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.deps import get_current_user
from app.core.security import hash_password
from app.db import get_db
from app.models.user import User


@pytest.fixture
def user_client():
    pwd_hash = hash_password("ValidPassword123!")
    user = User(
        id=20,
        tenant_id=1,
        roll_no="STU001",
        email="student@example.com",
        name="Test Student",
        password_hash=pwd_hash,
        role="student",
        status="active",
        must_change_password=True,
    )

    async def fake_current_user():
        return user

    app.dependency_overrides[get_current_user] = fake_current_user

    db = MagicMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    async def fake_get_db():
        yield db

    app.dependency_overrides[get_db] = fake_get_db

    with TestClient(app) as test_client:
        yield test_client, db, user

    app.dependency_overrides.clear()


def test_student_can_change_password(user_client):
    test_client, db, user = user_client

    response = test_client.post(
        "/auth/change-password",
        json={
            "current_password": "ValidPassword123!",
            "new_password": "AUniqueNewPassword987!",
        },
    )

    assert response.status_code == 200
    assert response.json()["message"] == "Password changed successfully"
    assert user.must_change_password is False
    db.commit.assert_awaited_once()


def test_rejects_wrong_current_password(user_client):
    test_client, _, _ = user_client

    response = test_client.post(
        "/auth/change-password",
        json={
            "current_password": "WrongPassword123!",
            "new_password": "AUniqueNewPassword987!",
        },
    )

    assert response.status_code == 400


def test_rejects_common_new_password(user_client):
    test_client, _, _ = user_client

    response = test_client.post(
        "/auth/change-password",
        json={
            "current_password": "ValidPassword123!",
            "new_password": "password123",
        },
    )

    assert response.status_code == 400
