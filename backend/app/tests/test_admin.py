from unittest.mock import AsyncMock, MagicMock
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.deps import get_current_user
from app.db import get_db
from app.models.face_vector import FaceVector
from app.models.user import User


@pytest.fixture
def admin_client():
    admin = User(
        id=99,
        tenant_id=1,
        roll_no="ADM001",
        email="admin@example.com",
        name="Admin User",
        password_hash="hashed",
        role="admin",
        status="active",
    )

    async def fake_current_user():
        return admin

    app.dependency_overrides[get_current_user] = fake_current_user

    db = MagicMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    async def fake_get_db():
        yield db

    app.dependency_overrides[get_db] = fake_get_db

    with TestClient(app) as test_client:
        yield test_client, db, admin

    app.dependency_overrides.clear()


def test_admin_can_delete_face_data_dpdp(admin_client):
    test_client, db, admin = admin_client

    student = User(
        id=20,
        tenant_id=1,
        roll_no="STU001",
        email="student@example.com",
        name="Test Student",
        password_hash="hashed",
        role="student",
        status="active",
    )

    vector = FaceVector(
        id=1,
        tenant_id=1,
        user_id=20,
        descriptor_enc=b"encrypted",
        version=1,
        active=True,
        approved_by=10,
    )

    mock_student = MagicMock()
    mock_student.scalar_one_or_none.return_value = student

    mock_vectors = MagicMock()
    mock_vectors.scalars.return_value.all.return_value = [vector]

    db.execute.side_effect = [mock_student, mock_vectors]

    response = test_client.delete("/admin/students/20/face")

    assert response.status_code == 200
    assert vector.active is False
    assert student.status == "pending"
    db.commit.assert_awaited_once()


def test_non_admin_cannot_delete_face_data():
    faculty = User(
        id=10,
        tenant_id=1,
        roll_no="FAC001",
        email="faculty@example.com",
        name="Faculty User",
        password_hash="hashed",
        role="faculty",
        status="active",
    )

    async def fake_current_user():
        return faculty

    app.dependency_overrides[get_current_user] = fake_current_user

    with TestClient(app) as test_client:
        response = test_client.delete("/admin/students/20/face")

    app.dependency_overrides.clear()
    assert response.status_code == 403


def test_admin_can_view_override_reports(admin_client):
    test_client, db, admin = admin_client

    mock_row = MagicMock()
    mock_row.faculty_id = 10
    mock_row.faculty_name = "Prof Smith"
    mock_row.faculty_email = "smith@example.com"
    mock_row.override_count = 3

    mock_result = MagicMock()
    mock_result.all.return_value = [mock_row]

    db.execute.return_value = mock_result

    response = test_client.get("/reports/overrides")

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["faculty_name"] == "Prof Smith"
    assert data[0]["override_count"] == 3
