from fastapi.testclient import TestClient
from app.main import app
from datetime import datetime, timezone
from app.core.security import create_access_token, decode_access_token
from app.stores.memory import token_denylist
from app.core.deps import get_current_user
from app.models.user import User


def test_me_with_invalid_bearer_token_returns_401():
    with TestClient(app) as client:
        response = client.get(
            "/auth/me",
            headers={"Authorization": "Bearer invalid-token"},
        )

    assert response.status_code == 401


def test_me_with_revoked_access_token_returns_401():
    access_token = create_access_token(
        user_id=1,
        role="student",
    )

    payload = decode_access_token(access_token)
    assert payload is not None

    expires_at = datetime.fromtimestamp(
        payload["exp"],
        tz=timezone.utc,
    )

    token_denylist.revoke(
        payload["jti"],
        expires_at,
    )

    with TestClient(app) as client:
        response = client.get(
            "/auth/me",
            headers={"Authorization": f"Bearer {access_token}"},
        )

    assert response.status_code == 401
    assert response.json()["detail"] == "Token has been revoked"


def test_me_returns_full_name_and_user_profile():
    user = User(
        id=42,
        name="Ada Lovelace",
        email="ada@college.edu",
        roll_no="25BCS042",
        role="student",
        status="active",
        must_change_password=False,
    )

    async def fake_current_user():
        return user

    app.dependency_overrides[get_current_user] = fake_current_user

    with TestClient(app) as client:
        response = client.get(
            "/auth/me",
            headers={"Authorization": "Bearer fake-token"},
        )

    app.dependency_overrides.clear()

    assert response.status_code == 200
    data = response.json()
    assert data["full_name"] == "Ada Lovelace"
    assert data["name"] == "Ada Lovelace"
    assert data["roll_no"] == "25BCS042"
    assert data["email"] == "ada@college.edu"
    assert data["role"] == "student"
    assert data["status"] == "active"
    assert data["must_change_password"] is False