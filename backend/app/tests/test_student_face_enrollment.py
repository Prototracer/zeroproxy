from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.deps import get_current_user
from app.db import get_db
from app.models.user import User


@pytest.fixture
def student_client():
    student = User(
        id=25,
        tenant_id=1,
        roll_no="STU999",
        email="pending_student@example.com",
        name="Self Enrolling Student",
        password_hash="hashed",
        role="student",
        status="pending",
        must_change_password=False,
    )

    async def fake_current_user():
        return student

    app.dependency_overrides[get_current_user] = fake_current_user

    db = MagicMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.add = MagicMock()

    async def fake_get_db():
        yield db

    app.dependency_overrides[get_db] = fake_get_db

    with TestClient(app) as test_client:
        yield test_client, db, student

    app.dependency_overrides.clear()


def test_student_enroll_face_requires_consent(student_client):
    client, db, student = student_client
    response = client.post(
        "/student/enroll",
        json={
            "descriptors": [[0.1] * 128] * 3,
            "consent": False,
        },
    )
    assert response.status_code == 422


def test_student_enroll_face_success(student_client):
    client, db, student = student_client

    # 1. Fetch student in tenant
    mock_student_res = MagicMock()
    mock_student_res.scalar_one_or_none.return_value = student

    # 2. Existing active enrollments check (no duplicates)
    mock_active_res = MagicMock()
    mock_active_res.scalars.return_value.all.return_value = []

    # 3. Max version query
    mock_ver_res = MagicMock()
    mock_ver_res.scalar_one_or_none.return_value = 0

    # 4. Old active enrollments to deactivate
    mock_old_res = MagicMock()
    mock_old_res.scalars.return_value.all.return_value = []

    # 5. Scalar one for returned user
    mock_user_return = MagicMock()
    mock_user_return.scalar_one.return_value = student

    db.execute.side_effect = [
        mock_student_res,
        mock_active_res,
        mock_ver_res,
        mock_old_res,
        mock_user_return,
    ]

    response = client.post(
        "/student/enroll",
        json={
            "descriptors": [[0.05 + i * 0.001] * 128 for i in range(3)],
            "consent": True,
        },
    )

    assert response.status_code == 200
    assert response.json()["id"] == student.id
    assert student.status == "active"
