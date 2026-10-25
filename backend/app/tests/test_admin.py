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


def test_admin_can_list_users_and_never_passwords(admin_client):
    test_client, db, admin = admin_client

    user1 = User(
        id=1,
        tenant_id=1,
        roll_no="STU001",
        email="stu1@example.com",
        name="Student One",
        password_hash="secret_hash_value",
        role="student",
        status="active",
    )

    mock_count = MagicMock()
    mock_count.scalar_one.return_value = 1

    mock_users = MagicMock()
    mock_users.scalars.return_value.all.return_value = [user1]

    mock_face_ids = MagicMock()
    mock_face_ids.scalars.return_value.all.return_value = [1]

    db.execute.side_effect = [mock_count, mock_users, mock_face_ids]

    response = test_client.get("/admin/users?role=student")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 1
    assert len(data["users"]) == 1
    assert data["users"][0]["name"] == "Student One"
    assert data["users"][0]["has_face_vector"] is True

    # Critical security assertion: passwords and hashes never leaked
    raw_text = response.text.lower()
    assert "password_hash" not in raw_text
    assert "secret_hash_value" not in raw_text


def test_admin_can_create_faculty_account(admin_client):
    test_client, db, admin = admin_client

    mock_existing = MagicMock()
    mock_existing.scalar_one_or_none.return_value = None  # no duplicate

    db.execute.return_value = mock_existing

    from datetime import datetime, timezone
    def _fake_refresh(obj):
        obj.id = 50
        obj.created_at = datetime.now(timezone.utc)
    db.refresh.side_effect = _fake_refresh

    response = test_client.post(
        "/admin/faculty",
        json={
            "name": "Dr. Alan Turing",
            "email": "turing@university.edu",
            "roll_no": "FAC042",
            "password": "InitialTempPassword123!",
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["role"] == "faculty"
    assert data["must_change_password"] is True
    assert data["name"] == "Dr. Alan Turing"
    db.commit.assert_awaited()


def test_create_faculty_rejects_duplicate(admin_client):
    test_client, db, admin = admin_client

    mock_existing = MagicMock()
    mock_existing.scalar_one_or_none.return_value = User(id=5, tenant_id=1, roll_no="FAC042", email="turing@university.edu", name="Existing", password_hash="h", role="faculty", status="active")

    db.execute.return_value = mock_existing

    response = test_client.post(
        "/admin/faculty",
        json={
            "name": "Dr. Alan Turing",
            "email": "turing@university.edu",
            "roll_no": "FAC042",
            "password": "InitialTempPassword123!",
        },
    )

    assert response.status_code == 409


def test_admin_can_update_user_status_and_suspend(admin_client):
    test_client, db, admin = admin_client

    user = User(
        id=20,
        tenant_id=1,
        roll_no="STU001",
        email="stu1@example.com",
        name="Student One",
        password_hash="h",
        role="student",
        status="active",
    )

    mock_user = MagicMock()
    mock_user.scalar_one_or_none.return_value = user
    db.execute.return_value = mock_user

    response = test_client.post(
        "/admin/users/20/status",
        json={"status": "suspended"},
    )

    assert response.status_code == 200
    assert user.status == "suspended"
    db.commit.assert_awaited()


def test_admin_cannot_suspend_themselves(admin_client):
    test_client, db, admin = admin_client

    # admin.id is 99
    response = test_client.post(
        "/admin/users/99/status",
        json={"status": "suspended"},
    )

    assert response.status_code == 400


def test_admin_can_reset_password(admin_client):
    test_client, db, admin = admin_client

    user = User(
        id=20,
        tenant_id=1,
        roll_no="STU001",
        email="stu1@example.com",
        name="Student One",
        password_hash="old_hash",
        role="student",
        status="active",
    )

    mock_user = MagicMock()
    mock_user.scalar_one_or_none.return_value = user
    db.execute.return_value = mock_user

    response = test_client.post(
        "/admin/users/20/reset-password",
        json={"temporary_password": "NewTempPassword999!"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["must_change_password"] is True
    assert data["temporary_password"] == "NewTempPassword999!"
    assert user.must_change_password is True
    assert user.password_hash != "old_hash"


def test_admin_can_reset_student_face_enrollment(admin_client):
    test_client, db, admin = admin_client

    student = User(
        id=20,
        tenant_id=1,
        roll_no="STU001",
        email="student@example.com",
        name="Student One",
        password_hash="h",
        role="student",
        status="active",
    )

    vector = FaceVector(
        id=1,
        tenant_id=1,
        user_id=20,
        descriptor_enc=b"enc",
        version=1,
        active=True,
    )

    mock_student = MagicMock()
    mock_student.scalar_one_or_none.return_value = student

    mock_vectors = MagicMock()
    mock_vectors.scalars.return_value.all.return_value = [vector]

    db.execute.side_effect = [mock_student, mock_vectors]

    response = test_client.post("/admin/users/20/reset-face")

    assert response.status_code == 200
    assert student.status == "pending"
    assert vector.active is False
    db.commit.assert_awaited()


def test_admin_can_view_audit_logs(admin_client):
    from app.models.audit import AuditEvent
    from datetime import datetime, timezone

    test_client, db, admin = admin_client

    event = AuditEvent(
        id=1,
        tenant_id=1,
        actor_id=admin.id,
        action="faculty_created",
        target="user:50",
        meta={"name": "Dr. Turing"},
        created_at=datetime.now(timezone.utc),
    )

    mock_res = MagicMock()
    mock_res.all.return_value = [(event, "Admin User", "admin@example.com")]
    db.execute.return_value = mock_res

    response = test_client.get("/admin/audit")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["action"] == "faculty_created"
    assert data[0]["actor_name"] == "Admin User"


def test_admin_can_correct_user_details(admin_client):
    test_client, db, admin = admin_client

    target_user = User(
        id=15,
        tenant_id=1,
        roll_no="25BCS015",
        email="old_email@example.com",
        name="Old Name",
        password_hash="hashed",
        role="student",
        status="active",
    )

    mock_target = MagicMock()
    mock_target.scalar_one_or_none.return_value = target_user

    # for duplicate check: None means no conflicting roll_no
    mock_dup = MagicMock()
    mock_dup.scalar_one_or_none.return_value = None

    # for face vector check
    mock_face = MagicMock()
    mock_face.scalar_one_or_none.return_value = None

    db.execute.side_effect = [mock_target, mock_dup, mock_face]

    response = test_client.patch(
        "/admin/users/15",
        json={
            "full_name": "Corrected Name",
            "roll_no": "25BCS999",
            "reason": "Typo during registration attested by student office",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["full_name"] == "Corrected Name"
    assert data["roll_no"] == "25BCS999"
    assert target_user.name == "Corrected Name"
    assert target_user.roll_no == "25BCS999"
    db.commit.assert_awaited()


def test_admin_correct_user_details_requires_reason(admin_client):
    test_client, db, admin = admin_client

    response = test_client.patch(
        "/admin/users/15",
        json={
            "full_name": "New Name",
            "reason": "   ",  # whitespace only
        },
    )

    assert response.status_code == 400



