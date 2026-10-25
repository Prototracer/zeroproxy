from unittest.mock import AsyncMock, MagicMock
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.db import get_db
from app.core.rate_limiter import limiter
from app.models.user import User


@pytest.fixture(autouse=True)
def reset_rate_limit():
    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture
def auth_client():
    db = MagicMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.add = MagicMock()

    def fake_refresh(instance):
        if hasattr(instance, "id") and instance.id is None:
            instance.id = 101

    db.refresh.side_effect = fake_refresh

    async def fake_get_db():
        yield db

    app.dependency_overrides[get_db] = fake_get_db

    with TestClient(app) as test_client:
        yield test_client, db

    app.dependency_overrides.clear()


def test_register_creates_student_status_pending(auth_client):
    client, db = auth_client

    mock_res = MagicMock()
    mock_res.scalar_one_or_none.return_value = None
    db.execute.return_value = mock_res

    response = client.post(
        "/auth/register",
        json={
            "full_name": "Jane Student",
            "email": "jane@example.com",
            "roll_no": "25BCS001",
            "password": "StrongPassword123!",
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["role"] == "student"
    assert data["status"] == "pending"
    assert data["full_name"] == "Jane Student"
    assert data["roll_no"] == "25BCS001"

    added_user = db.add.call_args[0][0]
    assert isinstance(added_user, User)
    assert added_user.role == "student"
    assert added_user.status == "pending"
    assert added_user.name == "Jane Student"
    assert added_user.roll_no == "25BCS001"
    assert added_user.tenant_id == 1


def test_register_ignores_client_role_faculty(auth_client):
    client, db = auth_client

    mock_res = MagicMock()
    mock_res.scalar_one_or_none.return_value = None
    db.execute.return_value = mock_res

    response = client.post(
        "/auth/register",
        json={
            "full_name": "Attacker Trying Faculty",
            "roll_no": "25BCS002",
            "email": "attacker@example.com",
            "password": "StrongPassword123!",
            "role": "faculty",
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["role"] == "student"
    assert data["status"] == "pending"

    added_user = db.add.call_args[0][0]
    assert added_user.role == "student"
    assert added_user.status == "pending"


def test_register_ignores_client_role_admin(auth_client):
    client, db = auth_client

    mock_res = MagicMock()
    mock_res.scalar_one_or_none.return_value = None
    db.execute.return_value = mock_res

    response = client.post(
        "/auth/register",
        json={
            "full_name": "Attacker Trying Admin",
            "roll_no": "25BCS003",
            "email": "admin_attempt@example.com",
            "password": "StrongPassword123!",
            "role": "admin",
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["role"] == "student"
    assert data["status"] == "pending"

    added_user = db.add.call_args[0][0]
    assert added_user.role == "student"
    assert added_user.status == "pending"


def test_register_duplicate_email_returns_generic_error(auth_client):
    client, db = auth_client

    mock_res = MagicMock()
    mock_res.scalar_one_or_none.return_value = 1
    db.execute.return_value = mock_res

    response = client.post(
        "/auth/register",
        json={
            "full_name": "Duplicate User",
            "roll_no": "25BCS004",
            "email": "duplicate@example.com",
            "password": "StrongPassword123!",
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Could not register with those details. If you already have an account, log in or contact your faculty."


def test_register_duplicate_roll_no_returns_generic_error(auth_client):
    client, db = auth_client

    mock_res = MagicMock()
    mock_res.scalar_one_or_none.return_value = 2
    db.execute.return_value = mock_res

    response = client.post(
        "/auth/register",
        json={
            "full_name": "Duplicate Roll",
            "roll_no": "25bcs005",  # Lowercase to test case-insensitive match
            "email": "newuser@example.com",
            "password": "StrongPassword123!",
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Could not register with those details. If you already have an account, log in or contact your faculty."


def test_register_short_password_rejected(auth_client):
    client, db = auth_client

    response = client.post(
        "/auth/register",
        json={
            "full_name": "Short Pass",
            "roll_no": "25BCS006",
            "email": "short@example.com",
            "password": "short",
        },
    )

    assert response.status_code == 422


def test_register_common_password_rejected(auth_client):
    client, db = auth_client

    response = client.post(
        "/auth/register",
        json={
            "full_name": "Common Pass",
            "roll_no": "25BCS007",
            "email": "common@example.com",
            "password": "password12345",
        },
    )

    assert response.status_code == 400
    assert "common" in response.json()["detail"].lower()


def test_register_invalid_roll_no_pattern_rejected(auth_client):
    client, db = auth_client

    response = client.post(
        "/auth/register",
        json={
            "full_name": "Invalid Roll",
            "roll_no": "AB",  # < 3 chars
            "email": "inv@example.com",
            "password": "StrongPassword123!",
        },
    )

    assert response.status_code == 400
    assert "roll number must be" in response.json()["detail"].lower()
