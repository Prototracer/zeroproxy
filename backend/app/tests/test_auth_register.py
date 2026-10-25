from unittest.mock import AsyncMock, MagicMock
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.db import get_db
from app.models.user import User


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

    # 1. email check query
    mock_email_res = MagicMock()
    mock_email_res.scalar_one_or_none.return_value = None

    # 2. roll_no check query
    mock_roll_res = MagicMock()
    mock_roll_res.scalar_one_or_none.return_value = None

    db.execute.side_effect = [mock_email_res, mock_roll_res]

    # When db.refresh is called, mock sets the id on user
    def fake_refresh(instance):
        instance.id = 101

    db.refresh.side_effect = fake_refresh

    response = client.post(
        "/auth/register",
        json={
            "name": "Jane Student",
            "email": "jane@example.com",
            "roll_no": "25BCS001",
            "password": "StrongPassword123!",
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["role"] == "student"
    assert data["status"] == "pending"

    # Verify User object passed to db.add
    added_user = db.add.call_args[0][0]
    assert isinstance(added_user, User)
    assert added_user.role == "student"
    assert added_user.status == "pending"
    assert added_user.tenant_id == 1


def test_register_ignores_client_role_faculty(auth_client):
    client, db = auth_client

    mock_email_res = MagicMock()
    mock_email_res.scalar_one_or_none.return_value = None

    mock_roll_res = MagicMock()
    mock_roll_res.scalar_one_or_none.return_value = None

    db.execute.side_effect = [mock_email_res, mock_roll_res]

    response = client.post(
        "/auth/register",
        json={
            "name": "Attacker Trying Faculty",
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

    mock_email_res = MagicMock()
    mock_email_res.scalar_one_or_none.return_value = None

    mock_roll_res = MagicMock()
    mock_roll_res.scalar_one_or_none.return_value = None

    db.execute.side_effect = [mock_email_res, mock_roll_res]

    response = client.post(
        "/auth/register",
        json={
            "name": "Attacker Trying Admin",
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
