from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from app.models.user import User
from scripts.seed_faculty import create_or_enable_staff_user, generate_strong_password


def test_generate_strong_password_length_and_entropy():
    pw1 = generate_strong_password(16)
    pw2 = generate_strong_password(16)
    assert len(pw1) == 16
    assert len(pw2) == 16
    assert pw1 != pw2


@pytest.mark.anyio
async def test_create_or_enable_staff_user_new():
    mock_db = MagicMock()
    mock_db.execute = AsyncMock()
    mock_db.commit = AsyncMock()
    mock_db.rollback = AsyncMock()
    mock_db.add = MagicMock()

    mock_res = MagicMock()
    mock_res.scalar_one_or_none.return_value = None
    mock_db.execute.return_value = mock_res

    class MockSessionContext:
        async def __aenter__(self):
            return mock_db
        async def __aexit__(self, exc_type, exc_val, exc_tb):
            pass

    with patch("scripts.seed_faculty.SessionLocal", return_value=MockSessionContext()):
        ok = await create_or_enable_staff_user(
            name="Dr. Alan Turing",
            email="turing@college.edu",
            roll_no="FAC_TURING",
            password="StrongPassword123!",
            role="faculty",
        )

    assert ok is True
    mock_db.add.assert_called_once()
    added_user = mock_db.add.call_args[0][0]
    assert isinstance(added_user, User)
    assert added_user.name == "Dr. Alan Turing"
    assert added_user.email == "turing@college.edu"
    assert added_user.roll_no == "FAC_TURING"
    assert added_user.role == "faculty"
    assert added_user.status == "active"
    assert added_user.must_change_password is True
    mock_db.commit.assert_awaited_once()


@pytest.mark.anyio
async def test_create_or_enable_staff_user_rejects_common_password():
    ok = await create_or_enable_staff_user(
        name="Test User",
        email="test@college.edu",
        roll_no="FAC_TEST",
        password="password12345",
        role="faculty",
    )
    assert ok is False
