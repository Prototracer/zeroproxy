
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

from fastapi.testclient import TestClient

from app.main import app
from app.db import get_db
from app.models.user import User
from app.core.security import create_refresh_token, decode_refresh_token
from app.stores.memory import refresh_token_store


class FakeUser:
    def __init__(self, user_id=1, role="student", status="active"):
        self.id = user_id
        self.role = role
        self.status = status


def make_db_override(user):
    result = MagicMock()
    result.scalar_one_or_none.return_value = user

    db = MagicMock()
    db.execute = AsyncMock(return_value=result)

    async def override_get_db():
        yield db

    return override_get_db


def test_refresh_without_cookie_returns_401():
    app.dependency_overrides[get_db] = make_db_override(FakeUser())

    try:
        with TestClient(app) as client:
            response = client.post("/auth/refresh")

        assert response.status_code == 401
        assert response.json()["detail"] == "Refresh token missing"
    finally:
        app.dependency_overrides.clear()


def test_refresh_with_invalid_token_returns_401():
    app.dependency_overrides[get_db] = make_db_override(FakeUser())

    try:
        with TestClient(app) as client:
            client.cookies.set("refresh_token", "invalid-token")
            response = client.post("/auth/refresh")

        assert response.status_code == 401
        assert response.json()["detail"] == "Invalid or expired refresh token"
    finally:
        app.dependency_overrides.clear()


def test_refresh_with_valid_token_rotates_refresh_token():
    user = FakeUser(user_id=1)
    app.dependency_overrides[get_db] = make_db_override(user)

    old_token = create_refresh_token(user_id=1, role="student")
    old_payload = decode_refresh_token(old_token)
    assert old_payload is not None

    refresh_token_store.store(
        jti=old_payload["jti"],
        user_id=1,
        expires_at=datetime.fromtimestamp(
            old_payload["exp"], tz=timezone.utc
        ),
    )

    try:
        with TestClient(app) as client:
            client.cookies.set("refresh_token", old_token)
            response = client.post("/auth/refresh")

        assert response.status_code == 200
        body = response.json()
        assert body["token_type"] == "bearer"
        assert body["access_token"]

        new_cookie = response.headers.get("set-cookie")
        assert new_cookie is not None
        assert "refresh_token=" in new_cookie
        assert "httponly" in new_cookie.lower()
        assert "secure" in new_cookie.lower()

        new_token = response.cookies.get("refresh_token")
        assert new_token
        assert new_token != old_token

        # The old refresh token must no longer be consumable.
        assert refresh_token_store.consume(
            jti=old_payload["jti"],
            user_id=1,
        ) is False

    finally:
        app.dependency_overrides.clear()


def test_refresh_rejects_inactive_user():
    user = FakeUser(user_id=1, status="inactive")
    app.dependency_overrides[get_db] = make_db_override(user)

    old_token = create_refresh_token(user_id=1, role="student")
    old_payload = decode_refresh_token(old_token)
    assert old_payload is not None

    refresh_token_store.store(
        jti=old_payload["jti"],
        user_id=1,
        expires_at=datetime.fromtimestamp(
            old_payload["exp"], tz=timezone.utc
        ),
    )

    try:
        with TestClient(app) as client:
            client.cookies.set("refresh_token", old_token)
            response = client.post("/auth/refresh")

        assert response.status_code == 401
        assert response.json()["detail"] == "User not found or inactive"
    finally:
        app.dependency_overrides.clear()


def test_refresh_rejects_malformed_sub(monkeypatch):
    from app.routers import auth

    # Simulate a decoded refresh token with an invalid subject.
    monkeypatch.setattr(
        auth,
        "decode_refresh_token",
        lambda token: {"sub": "not-a-number"},
    )

    try:
        with TestClient(app) as client:
            client.cookies.set("refresh_token", "test-token")
            response = client.post("/auth/refresh")

        assert response.status_code == 401
    finally:
        app.dependency_overrides.clear()
