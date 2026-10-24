import ast
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
import pytest
from fastapi.testclient import TestClient

from app.core.deps import get_current_user, get_db
from app.core.encryption import encrypt_descriptor_set
from app.main import app
from app.models.attendance_session import AttendanceSession
from app.models.class_enrollment import ClassEnrollment
from app.models.course import Course
from app.models.face_vector import FaceVector
from app.models.join_request import JoinRequest
from app.models.user import User


# ── Fixtures & Helpers ────────────────────────────────────────────────────────

@pytest.fixture
def test_data():
    faculty_a = User(
        id=10,
        tenant_id=1,
        roll_no="FAC001",
        email="faculty.a@example.com",
        name="Faculty Alpha",
        password_hash="hash",
        role="faculty",
        status="active",
        must_change_password=False,
    )
    faculty_b = User(
        id=11,
        tenant_id=1,
        roll_no="FAC002",
        email="faculty.b@example.com",
        name="Faculty Beta",
        password_hash="hash",
        role="faculty",
        status="active",
        must_change_password=False,
    )
    student_pending = User(
        id=20,
        tenant_id=1,
        roll_no="STU001",
        email="student.pending@example.com",
        name="Student Pending",
        password_hash="hash",
        role="student",
        status="pending",
        must_change_password=False,
    )
    student_active_no_class = User(
        id=21,
        tenant_id=1,
        roll_no="STU002",
        email="student.active@example.com",
        name="Student Active",
        password_hash="hash",
        role="student",
        status="active",
        must_change_password=False,
    )
    class_a = Course(
        id=101,
        tenant_id=1,
        name="Computer Science 101",
        code="CS101",
        semester="Sem 1",
        faculty_id=10,
    )
    class_b = Course(
        id=102,
        tenant_id=1,
        name="Data Structures 102",
        code="DS102",
        semester="Sem 2",
        faculty_id=11,
    )
    return {
        "faculty_a": faculty_a,
        "faculty_b": faculty_b,
        "student_pending": student_pending,
        "student_active_no_class": student_active_no_class,
        "class_a": class_a,
        "class_b": class_b,
    }


def make_client_with_user(user, db_mock):
    async def fake_current_user():
        return user

    async def fake_get_db():
        yield db_mock

    app.dependency_overrides[get_current_user] = fake_current_user
    app.dependency_overrides[get_db] = fake_get_db
    return TestClient(app)


# ── Acceptance Test 1: Student cannot call any faculty endpoint (403) ─────────

def test_student_cannot_call_any_faculty_endpoint(test_data):
    db_mock = MagicMock()
    client = make_client_with_user(test_data["student_pending"], db_mock)

    endpoints = [
        ("GET", "/faculty/join-requests", None),
        ("POST", "/faculty/join-requests/1/approve", {"class_id": 101}),
        ("POST", "/faculty/join-requests/1/reject", {"reason": "no"}),
        ("GET", "/faculty/pending", None),
        ("GET", "/faculty/classes", None),
        ("POST", "/faculty/enroll/20", {"descriptors": [[0.1] * 128] * 3, "consent": True}),
        ("POST", "/faculty/students/20/reset-password", {"new_password": "NewPassword123!"}),
    ]

    for method, path, json_data in endpoints:
        if method == "GET":
            res = client.get(path)
        else:
            res = client.post(path, json=json_data)
        assert res.status_code == 403, f"{method} {path} should return 403 for student but returned {res.status_code}"

    app.dependency_overrides.clear()


# ── Acceptance Test 2: Faculty A cannot access out-of-scope student (404) ─────

def test_faculty_a_cannot_access_out_of_scope_student_404(test_data):
    db_mock = MagicMock()
    db_mock.execute = AsyncMock()
    db_mock.commit = AsyncMock()

    client = make_client_with_user(test_data["faculty_a"], db_mock)

    # 1. Reset password: student not in faculty's classes -> 404
    # db returns student for user lookup, but None for class query
    mock_student = MagicMock()
    mock_student.scalar_one_or_none.return_value = test_data["student_pending"]
    mock_no_class = MagicMock()
    mock_no_class.scalar_one_or_none.return_value = None
    db_mock.execute.side_effect = [mock_student, mock_no_class]

    res = client.post(
        f"/faculty/students/{test_data['student_pending'].id}/reset-password",
        json={"new_password": "NewPassword123!"},
    )
    assert res.status_code == 404

    # 2. Face enrollment: student not in scope (no approved join request & no class) -> 404
    db_mock.execute.side_effect = [mock_student, mock_no_class, mock_no_class]
    res = client.post(
        f"/faculty/enroll/{test_data['student_pending'].id}",
        json={"descriptors": [[0.1] * 128] * 3, "consent": True},
    )
    assert res.status_code == 404

    # 3. Override: student not in session's class -> 404
    session = AttendanceSession(
        id=50,
        tenant_id=1,
        course_id=test_data["class_a"].id,
        faculty_id=test_data["faculty_a"].id,
        status="active",
    )
    mock_session = MagicMock()
    mock_session.scalar_one_or_none.return_value = session
    db_mock.execute.side_effect = [mock_session, mock_student, mock_no_class]

    res = client.post(
        "/sessions/50/override",
        json={"student_id": test_data["student_pending"].id, "reason": "hackathon"},
    )
    assert res.status_code == 404

    app.dependency_overrides.clear()


# ── Acceptance Test 3: Faculty A cannot approve into class of Faculty B ───────

def test_faculty_a_cannot_approve_into_class_of_faculty_b(test_data):
    db_mock = MagicMock()
    db_mock.execute = AsyncMock()

    client = make_client_with_user(test_data["faculty_a"], db_mock)

    # Class check returns None because class_b belongs to faculty_b, not faculty_a
    mock_class_res = MagicMock()
    mock_class_res.scalar_one_or_none.return_value = None
    db_mock.execute.return_value = mock_class_res

    res = client.post(
        "/faculty/join-requests/1/approve",
        json={"class_id": test_data["class_b"].id},
    )
    assert res.status_code == 400
    assert "not found or does not belong to you" in res.json()["detail"].lower()

    app.dependency_overrides.clear()


# ── Acceptance Test 4: Join request to non-faculty vs valid faculty email ──────

def test_join_request_neutral_reply_for_non_faculty_and_faculty(test_data):
    db_mock = MagicMock()
    db_mock.execute = AsyncMock()
    db_mock.commit = AsyncMock()

    client = make_client_with_user(test_data["student_pending"], db_mock)

    # Case 1: non-existent email
    mock_count = MagicMock()
    mock_count.scalar.return_value = 0
    mock_not_found = MagicMock()
    mock_not_found.scalar_one_or_none.return_value = None
    db_mock.execute.side_effect = [mock_count, mock_not_found]

    res_fake = client.post(
        "/student/join-requests",
        json={"faculty_email": "nonexistent@example.com"},
    )
    assert res_fake.status_code == 200
    fake_body = res_fake.json()

    # Case 2: valid faculty email
    mock_faculty = MagicMock()
    mock_faculty.scalar_one_or_none.return_value = test_data["faculty_a"]
    mock_no_pending = MagicMock()
    mock_no_pending.scalar_one_or_none.return_value = None
    db_mock.execute.side_effect = [mock_count, mock_faculty, mock_no_pending]

    res_real = client.post(
        "/student/join-requests",
        json={"faculty_email": test_data["faculty_a"].email},
    )
    assert res_real.status_code == 200
    real_body = res_real.json()

    # Neutral response format must be identical
    assert fake_body == real_body
    assert fake_body["status"] == "submitted"
    assert "submitted" in fake_body["message"].lower()

    app.dependency_overrides.clear()


# ── Acceptance Test 5: Rejection of duplicate pending & 6th pending request ───

def test_duplicate_pending_and_max_5_pending_requests_rejected(test_data):
    db_mock = MagicMock()
    db_mock.execute = AsyncMock()

    client = make_client_with_user(test_data["student_pending"], db_mock)

    # 1. Duplicate pending request for same (student, faculty) -> 409
    mock_count = MagicMock()
    mock_count.scalar.return_value = 1
    mock_faculty = MagicMock()
    mock_faculty.scalar_one_or_none.return_value = test_data["faculty_a"]
    mock_has_pending = MagicMock()
    mock_has_pending.scalar_one_or_none.return_value = 99
    db_mock.execute.side_effect = [mock_count, mock_faculty, mock_has_pending]

    res_dup = client.post(
        "/student/join-requests",
        json={"faculty_email": test_data["faculty_a"].email},
    )
    assert res_dup.status_code == 409
    assert "already exists" in res_dup.json()["detail"].lower()

    # 2. 6th pending request for same student -> 400
    mock_count_5 = MagicMock()
    mock_count_5.scalar.return_value = 5
    db_mock.execute.side_effect = [mock_count_5]

    res_6th = client.post(
        "/student/join-requests",
        json={"faculty_email": test_data["faculty_b"].email},
    )
    assert res_6th.status_code == 400
    assert "maximum 5" in res_6th.json()["detail"].lower()

    app.dependency_overrides.clear()


# ── Acceptance Test 6: Approval adds to class_enrollments and leaves pending ──

def test_approving_request_adds_to_class_and_leaves_user_pending(test_data):
    db_mock = MagicMock()
    db_mock.execute = AsyncMock()
    db_mock.commit = AsyncMock()

    added_objects = []
    db_mock.add = lambda obj: added_objects.append(obj)

    client = make_client_with_user(test_data["faculty_a"], db_mock)

    join_req = JoinRequest(
        id=42,
        tenant_id=1,
        student_id=test_data["student_pending"].id,
        faculty_id=test_data["faculty_a"].id,
        status="pending",
    )

    mock_course = MagicMock()
    mock_course.scalar_one_or_none.return_value = test_data["class_a"]
    mock_jr = MagicMock()
    mock_jr.scalar_one_or_none.return_value = join_req
    mock_no_class_enrollment = MagicMock()
    mock_no_class_enrollment.scalar_one_or_none.return_value = None

    db_mock.execute.side_effect = [mock_course, mock_jr, mock_no_class_enrollment]

    res = client.post(
        "/faculty/join-requests/42/approve",
        json={"class_id": test_data["class_a"].id},
    )
    assert res.status_code == 200
    assert join_req.status == "approved"
    assert join_req.class_id == test_data["class_a"].id
    # Critical invariant: user status remains pending
    assert test_data["student_pending"].status == "pending"

    # ClassEnrollment must be inserted
    enrollments_added = [obj for obj in added_objects if isinstance(obj, ClassEnrollment)]
    assert len(enrollments_added) == 1
    assert enrollments_added[0].student_id == test_data["student_pending"].id
    assert enrollments_added[0].course_id == test_data["class_a"].id

    app.dependency_overrides.clear()


# ── Acceptance Test 7: Only face enrollment activates student ─────────────────

@pytest.mark.anyio
async def test_only_successful_face_enrollment_makes_student_active(test_data):
    from app.services.face_enrollment_service import (
        EnrollmentDataError,
        enroll_student,
    )

    db_mock = MagicMock()
    db_mock.execute = AsyncMock()
    db_mock.commit = AsyncMock()
    db_mock.rollback = AsyncMock()
    db_mock.refresh = AsyncMock()

    student = User(
        id=30,
        tenant_id=1,
        roll_no="STU030",
        email="stu30@example.com",
        name="Student 30",
        password_hash="hash",
        role="student",
        status="pending",
    )

    # 1. Failed enrollment with consent=False leaves student pending
    with pytest.raises(EnrollmentDataError):
        await enroll_student(
            db_mock,
            faculty=test_data["faculty_a"],
            student_id=student.id,
            descriptors=[[0.05] * 128] * 3,
            consent=False,
        )
    assert student.status == "pending"

    # 2. Successful enrollment activates student
    mock_student_res = MagicMock()
    mock_student_res.scalar_one_or_none.return_value = student
    mock_active_vectors = MagicMock()
    mock_active_vectors.scalars.return_value.all.return_value = []
    mock_max_version = MagicMock()
    mock_max_version.scalar_one_or_none.return_value = 0
    mock_old_vectors = MagicMock()
    mock_old_vectors.scalars.return_value.all.return_value = []

    db_mock.execute.side_effect = [
        mock_student_res,
        mock_active_vectors,
        mock_max_version,
        mock_old_vectors,
    ]

    await enroll_student(
        db_mock,
        faculty=test_data["faculty_a"],
        student_id=student.id,
        descriptors=[[0.05] * 128] * 3,
        consent=True,
    )
    assert student.status == "active"


# ── Acceptance Test 8: Pending cannot scan; active in no class cannot scan ────

def test_pending_student_and_active_student_in_no_class_cannot_scan(test_data):
    db_mock = MagicMock()
    db_mock.execute = AsyncMock()

    # 1. Pending student cannot scan -> 403
    client_pending = make_client_with_user(test_data["student_pending"], db_mock)
    res_pending = client_pending.post(
        "/attendance/scan",
        json={"session_id": 1, "window": 100, "mac": "dummy_mac"},
    )
    assert res_pending.status_code == 403
    app.dependency_overrides.clear()

    # 2. Active student in no class cannot scan -> 403
    from app.services.qr_service import generate_qr_payload

    # Valid QR payload for active session
    session = AttendanceSession(
        id=77,
        tenant_id=1,
        course_id=test_data["class_a"].id,
        faculty_id=test_data["faculty_a"].id,
        status="active",
    )
    qr = generate_qr_payload(session.id)

    client_active = make_client_with_user(test_data["student_active_no_class"], db_mock)

    mock_session = MagicMock()
    mock_session.scalar_one_or_none.return_value = session
    mock_face = MagicMock()
    mock_face.scalar_one_or_none.return_value = 1  # has face vector
    mock_no_class = MagicMock()
    mock_no_class.scalar_one_or_none.return_value = None  # not in class

    db_mock.execute.side_effect = [mock_session, mock_face, mock_no_class]

    res_active = client_active.post(
        "/attendance/scan",
        json={"session_id": qr["session_id"], "window": qr["window"], "mac": qr["mac"]},
    )
    assert res_active.status_code == 403
    assert "not enrolled in this course" in res_active.json()["detail"].lower()
    app.dependency_overrides.clear()


# ── Acceptance Test 9: No API response contains a face descriptor ─────────────

def test_no_api_response_contains_face_descriptor(test_data):
    db_mock = MagicMock()
    db_mock.execute = AsyncMock()
    db_mock.commit = AsyncMock()

    client = make_client_with_user(test_data["faculty_a"], db_mock)

    # Check /faculty/pending
    mock_pending = MagicMock()
    mock_pending.scalars.return_value.all.return_value = [test_data["student_pending"]]
    db_mock.execute.return_value = mock_pending

    res = client.get("/faculty/pending")
    assert res.status_code == 200
    text_content = res.text
    assert "descriptor" not in text_content.lower()

    # Check /faculty/join-requests
    jr = JoinRequest(
        id=1,
        tenant_id=1,
        student_id=20,
        faculty_id=10,
        status="pending",
        created_at=datetime.now(timezone.utc),
    )
    mock_jr = MagicMock()
    mock_jr.all.return_value = [(jr, "Student Pending", "STU001", "student@example.com")]
    db_mock.execute.return_value = mock_jr

    res_jr = client.get("/faculty/join-requests")
    assert res_jr.status_code == 200
    assert "descriptor" not in res_jr.text.lower()

    app.dependency_overrides.clear()


# ── Acceptance Test 10: Code AST check — only enroll_student sets 'active' ────

def test_ast_check_only_face_enrollment_service_sets_status_active():
    """Verify that only face_enrollment_service sets users.status = 'active'."""
    backend_app_dir = Path(__file__).resolve().parent.parent

    violations = []

    for py_file in backend_app_dir.rglob("*.py"):
        # Skip tests themselves
        if "tests" in py_file.parts:
            continue

        source = py_file.read_text(encoding="utf-8")
        try:
            tree = ast.parse(source, filename=str(py_file))
        except SyntaxError:
            continue

        for node in ast.walk(tree):
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    # Check target.attr == "status"
                    if isinstance(target, ast.Attribute) and target.attr == "status":
                        # Check value is constant "active"
                        if isinstance(node.value, ast.Constant) and node.value.value == "active":
                            # Only face_enrollment_service is allowed
                            if py_file.name != "face_enrollment_service.py":
                                violations.append((str(py_file), node.lineno))

    assert not violations, (
        f"Violations of single-activation path found in: {violations}. "
        "Only face_enrollment_service.py may set status = 'active'!"
    )


# ── Acceptance Test 11: Join via Course Join Code (dynamic enable/disable) ────

def test_join_via_course_code_and_toggle(test_data):
    db_mock = MagicMock()
    db_mock.execute = AsyncMock()
    db_mock.commit = AsyncMock()

    test_course = test_data["class_a"]
    test_course.join_code = "K9X2M4"
    test_course.join_code_enabled = True

    # 1. Successful join via valid enabled join_code
    mock_count = MagicMock()
    mock_count.scalar.return_value = 0
    mock_course_res = MagicMock()
    mock_course_res.scalar_one_or_none.return_value = test_course
    mock_no_enrollment = MagicMock()
    mock_no_enrollment.scalar_one_or_none.return_value = None
    mock_no_existing_jr = MagicMock()
    mock_no_existing_jr.scalar_one_or_none.return_value = None

    db_mock.execute.side_effect = [
        mock_count,
        mock_course_res,
        mock_no_enrollment,
        mock_no_existing_jr,
    ]

    client_student = make_client_with_user(test_data["student_pending"], db_mock)
    res = client_student.post("/student/join-requests", json={"join_code": "k9x2m4"})
    assert res.status_code == 200
    assert "submitted" in res.json()["status"].lower()

    # 2. Rejection when join_code is disabled by faculty
    test_course.join_code_enabled = False
    db_mock.execute.side_effect = [mock_count, mock_course_res]
    res_disabled = client_student.post("/student/join-requests", json={"join_code": "K9X2M4"})
    assert res_disabled.status_code == 400
    assert "disabled" in res_disabled.json()["detail"].lower()

    # 3. Faculty toggles join code
    client_faculty = make_client_with_user(test_data["faculty_a"], db_mock)
    db_mock.execute.side_effect = [mock_course_res]
    res_toggle = client_faculty.post(f"/faculty/courses/{test_course.id}/toggle-join-code")
    assert res_toggle.status_code == 200
    assert res_toggle.json()["join_code_enabled"] is True

    # 4. Faculty regenerates join code
    mock_check_unique = MagicMock()
    mock_check_unique.scalar_one_or_none.return_value = None
    db_mock.execute.side_effect = [mock_course_res, mock_check_unique]
    res_regen = client_faculty.post(f"/faculty/courses/{test_course.id}/regenerate-join-code")
    assert res_regen.status_code == 200
    assert len(res_regen.json()["join_code"]) == 6

    app.dependency_overrides.clear()

