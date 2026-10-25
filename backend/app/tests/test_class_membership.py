from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.deps import get_current_user
from app.db import get_db
from app.models.audit import AuditEvent
from app.models.class_enrollment import ClassEnrollment
from app.models.course import Course
from app.models.user import User


@pytest.fixture
def student_user():
    return User(
        id=10,
        tenant_id=1,
        roll_no="25BCS010",
        email="student@college.edu",
        name="Alice Student",
        role="student",
        status="active",
        password_hash="hashed",
    )


@pytest.fixture
def faculty_user():
    return User(
        id=20,
        tenant_id=1,
        roll_no="FAC020",
        email="prof@college.edu",
        name="Prof. Smith",
        role="faculty",
        status="active",
        password_hash="hashed",
    )


@pytest.fixture
def test_course():
    return Course(
        id=101,
        tenant_id=1,
        faculty_id=20,
        name="Data Structures",
        code="CS201",
        semester="Semester 3",
        join_code="DS101X",
        join_code_enabled=True,
    )


# ── Student Leave Class Tests ───────────────────────────────────────────────

def test_student_list_enrolled_classes(student_user, test_course):
    enrollment = ClassEnrollment(
        id=1,
        tenant_id=1,
        course_id=101,
        student_id=10,
        active=True,
        enrolled_at=datetime.now(timezone.utc),
    )

    faculty = User(
        id=20,
        name="Prof. Smith",
        email="prof@college.edu",
    )

    db = MagicMock()
    db.execute = AsyncMock()
    mock_res = MagicMock()
    mock_res.all.return_value = [(test_course, enrollment, faculty)]
    db.execute.return_value = mock_res

    async def fake_get_db():
        yield db

    async def fake_current_user():
        return student_user

    app.dependency_overrides[get_db] = fake_get_db
    app.dependency_overrides[get_current_user] = fake_current_user

    with TestClient(app) as client:
        response = client.get("/student/classes")

    app.dependency_overrides.clear()

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["id"] == 101
    assert data[0]["name"] == "Data Structures"
    assert data[0]["code"] == "CS201"
    assert data[0]["faculty_name"] == "Prof. Smith"
    assert data[0]["active"] is True


def test_student_can_leave_class(student_user):
    enrollment = ClassEnrollment(
        id=1,
        tenant_id=1,
        course_id=101,
        student_id=10,
        active=True,
        enrolled_at=datetime.now(timezone.utc),
    )

    db = MagicMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()
    db.add = MagicMock()

    mock_res = MagicMock()
    mock_res.scalar_one_or_none.return_value = enrollment
    db.execute.return_value = mock_res

    async def fake_get_db():
        yield db

    async def fake_current_user():
        return student_user

    app.dependency_overrides[get_db] = fake_get_db
    app.dependency_overrides[get_current_user] = fake_current_user

    with TestClient(app) as client:
        response = client.post(
            "/student/classes/101/leave",
            json={"reason": "Dropping elective"},
        )

    app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["status"] == "left"
    assert enrollment.active is False
    assert enrollment.ended_by == "student"
    assert enrollment.reason == "Dropping elective"
    assert enrollment.left_at is not None

    # Verify audit event added
    added_audit = db.add.call_args[0][0]
    assert isinstance(added_audit, AuditEvent)
    assert added_audit.action == "class_leave"
    assert added_audit.actor_id == 10
    db.commit.assert_awaited_once()


def test_student_leave_class_not_enrolled(student_user):
    db = MagicMock()
    db.execute = AsyncMock()
    mock_res = MagicMock()
    mock_res.scalar_one_or_none.return_value = None
    db.execute.return_value = mock_res

    async def fake_get_db():
        yield db

    async def fake_current_user():
        return student_user

    app.dependency_overrides[get_db] = fake_get_db
    app.dependency_overrides[get_current_user] = fake_current_user

    with TestClient(app) as client:
        response = client.post(
            "/student/classes/999/leave",
            json={},
        )

    app.dependency_overrides.clear()

    assert response.status_code == 404


# ── Faculty Class Roster, Remove & Restore Tests ─────────────────────────────

def test_faculty_list_class_students(faculty_user, test_course, student_user):
    active_enr = ClassEnrollment(
        id=1,
        tenant_id=1,
        course_id=101,
        student_id=10,
        active=True,
        enrolled_at=datetime.now(timezone.utc),
    )

    removed_student = User(
        id=11,
        tenant_id=1,
        roll_no="25BCS011",
        email="bob@college.edu",
        name="Bob Removed",
        role="student",
        status="active",
    )
    removed_enr = ClassEnrollment(
        id=2,
        tenant_id=1,
        course_id=101,
        student_id=11,
        active=False,
        enrolled_at=datetime.now(timezone.utc),
        left_at=datetime.now(timezone.utc),
        ended_by="faculty",
        reason="Excessive unexcused absences",
    )

    db = MagicMock()
    db.execute = AsyncMock()

    mock_course_res = MagicMock()
    mock_course_res.scalar_one_or_none.return_value = test_course

    mock_students_res = MagicMock()
    mock_students_res.all.return_value = [
        (active_enr, student_user),
        (removed_enr, removed_student),
    ]

    db.execute.side_effect = [mock_course_res, mock_students_res]

    async def fake_get_db():
        yield db

    async def fake_current_user():
        return faculty_user

    app.dependency_overrides[get_db] = fake_get_db
    app.dependency_overrides[get_current_user] = fake_current_user

    with TestClient(app) as client:
        response = client.get("/faculty/classes/101/students")

    app.dependency_overrides.clear()

    assert response.status_code == 200
    data = response.json()
    assert data["class_id"] == 101
    assert len(data["active_students"]) == 1
    assert data["active_students"][0]["student_id"] == 10
    assert data["active_students"][0]["name"] == "Alice Student"

    assert len(data["removed_students"]) == 1
    assert data["removed_students"][0]["student_id"] == 11
    assert data["removed_students"][0]["ended_by"] == "faculty"
    assert data["removed_students"][0]["reason"] == "Excessive unexcused absences"


def test_faculty_remove_student_from_class(faculty_user, test_course):
    active_enr = ClassEnrollment(
        id=1,
        tenant_id=1,
        course_id=101,
        student_id=10,
        active=True,
        enrolled_at=datetime.now(timezone.utc),
    )

    db = MagicMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()
    db.add = MagicMock()

    mock_course_res = MagicMock()
    mock_course_res.scalar_one_or_none.return_value = test_course

    mock_enr_res = MagicMock()
    mock_enr_res.scalar_one_or_none.return_value = active_enr

    db.execute.side_effect = [mock_course_res, mock_enr_res]

    async def fake_get_db():
        yield db

    async def fake_current_user():
        return faculty_user

    app.dependency_overrides[get_db] = fake_get_db
    app.dependency_overrides[get_current_user] = fake_current_user

    with TestClient(app) as client:
        response = client.post(
            "/faculty/classes/101/students/10/remove",
            json={"reason": "Discontinued program"},
        )

    app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["status"] == "removed"
    assert active_enr.active is False
    assert active_enr.ended_by == "faculty"
    assert active_enr.reason == "Discontinued program"
    assert active_enr.left_at is not None

    added_audit = db.add.call_args[0][0]
    assert isinstance(added_audit, AuditEvent)
    assert added_audit.action == "student_removed_from_class"
    assert added_audit.actor_id == 20
    db.commit.assert_awaited_once()


def test_faculty_remove_student_requires_reason(faculty_user, test_course):
    db = MagicMock()

    async def fake_get_db():
        yield db

    async def fake_current_user():
        return faculty_user

    app.dependency_overrides[get_db] = fake_get_db
    app.dependency_overrides[get_current_user] = fake_current_user

    with TestClient(app) as client:
        response = client.post(
            "/faculty/classes/101/students/10/remove",
            json={"reason": "   "},
        )

    app.dependency_overrides.clear()

    assert response.status_code == 422 or response.status_code == 400


def test_removed_student_cannot_rejoin_via_join_code(student_user, test_course):
    db = MagicMock()
    db.execute = AsyncMock()

    # 1. pending join requests count check
    mock_pending_res = MagicMock()
    mock_pending_res.scalar.return_value = 0

    # 2. course lookup by join code
    mock_course_res = MagicMock()
    mock_course_res.scalar_one_or_none.return_value = test_course

    # 3. membership check (ended_by == 'faculty')
    mock_membership = ClassEnrollment(
        id=5,
        tenant_id=1,
        course_id=101,
        student_id=10,
        active=False,
        ended_by="faculty",
        reason="Removed by instructor",
    )
    mock_mem_res = MagicMock()
    mock_mem_res.scalar_one_or_none.return_value = mock_membership

    db.execute.side_effect = [
        mock_pending_res,
        mock_course_res,
        mock_mem_res,
    ]

    async def fake_get_db():
        yield db

    async def fake_current_user():
        return student_user

    app.dependency_overrides[get_db] = fake_get_db
    app.dependency_overrides[get_current_user] = fake_current_user

    with TestClient(app) as client:
        response = client.post(
            "/student/join-requests",
            json={"join_code": "DS101X"},
        )

    app.dependency_overrides.clear()

    assert response.status_code == 403
    assert "removed" in response.json()["detail"].lower()
    assert "cannot rejoin via code" in response.json()["detail"].lower()


def test_faculty_restore_student_to_class(faculty_user, test_course, student_user):
    db = MagicMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()
    db.add = MagicMock()

    # 1. course check
    mock_course_res = MagicMock()
    mock_course_res.scalar_one_or_none.return_value = test_course

    # 2. active enrollment check (None -> not active)
    mock_active_res = MagicMock()
    mock_active_res.scalar_one_or_none.return_value = None

    # 3. user check (student exists)
    mock_user_res = MagicMock()
    mock_user_res.scalar_one_or_none.return_value = student_user

    db.execute.side_effect = [
        mock_course_res,
        mock_active_res,
        mock_user_res,
    ]

    async def fake_get_db():
        yield db

    async def fake_current_user():
        return faculty_user

    app.dependency_overrides[get_db] = fake_get_db
    app.dependency_overrides[get_current_user] = fake_current_user

    with TestClient(app) as client:
        response = client.post("/faculty/classes/101/students/10/restore")

    app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["status"] == "restored"

    # Verify new active enrollment added
    added_objs = [call[0][0] for call in db.add.call_args_list]
    enrollments = [obj for obj in added_objs if isinstance(obj, ClassEnrollment)]
    assert len(enrollments) == 1
    assert enrollments[0].student_id == 10
    assert enrollments[0].course_id == 101
    assert enrollments[0].active is True

    # Verify audit event added
    audits = [obj for obj in added_objs if isinstance(obj, AuditEvent)]
    assert len(audits) == 1
    assert audits[0].action == "student_restored_to_class"
    assert audits[0].actor_id == 20
    db.commit.assert_awaited_once()
