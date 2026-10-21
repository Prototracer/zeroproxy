from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

from fastapi.testclient import TestClient

from app.main import app
from app.db import get_db
from app.core.security import create_access_token, create_refresh_token, decode_refresh_token
from app.stores.memory import refresh_token_store, token_denylist


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


def test_logout_revokes_access_token_and_clears_cookie():
    user = FakeUser()
    app.dependency_overrides[get_db] = make_db_override(user)
    access_token = create_access_token(user_id=user.id, role=user.role)

    try:
        with TestClient(app) as client:
            client.cookies.set("access_token", access_token)
            client.cookies.set("refresh_token", "invalid-token")

            response = client.post(
                "/auth/logout",
                headers={"Authorization": f"Bearer {access_token}"},
            )

        assert response.status_code == 200
        assert response.json()["message"] == "Successfully logged out"

        from app.core.security import decode_access_token
        payload = decode_access_token(access_token)
        assert payload is not None
        assert token_denylist.is_revoked(payload["jti"])

        set_cookie = response.headers.get("set-cookie", "").lower()
        assert "refresh_token=" in set_cookie
        assert "max-age=0" in set_cookie or "expires=" in set_cookie
    finally:
        app.dependency_overrides.clear()


def test_logout_consumes_valid_refresh_token():
    user = FakeUser()
    app.dependency_overrides[get_db] = make_db_override(user)

    refresh_token = create_refresh_token(user_id=user.id, role=user.role)
    payload = decode_refresh_token(refresh_token)
    assert payload is not None

    refresh_token_store.store(
        jti=payload["jti"],
        user_id=user.id,
        expires_at=datetime.fromtimestamp(payload["exp"], tz=timezone.utc),
    )

    try:
        with TestClient(app) as client:
            client.cookies.set("refresh_token", refresh_token)
            response = client.post(
                "/auth/logout",
                headers={
                    "Authorization": f"Bearer "
                    f"{create_access_token(user_id=user.id, role=user.role)}"
                },
            )

        assert response.status_code == 200
        assert refresh_token_store.consume(
            jti=payload["jti"],
            user_id=user.id,
        ) is False
    finally:
        app.dependency_overrides.clear()


def test_logout_without_refresh_cookie_still_succeeds():
    user = FakeUser()
    app.dependency_overrides[get_db] = make_db_override(user)

    try:
        with TestClient(app) as client:
            response = client.post(
                "/auth/logout",
                headers={
                    "Authorization": f"Bearer "
                    f"{create_access_token(user_id=user.id, role=user.role)}"
                },
            )

        assert response.status_code == 200
    finally:
        app.dependency_overrides.clear()


def test_logout_without_access_token_returns_401():
    try:
        with TestClient(app) as client:
            response = client.post("/auth/logout")

        assert response.status_code == 401
    finally:
        app.dependency_overrides.clear()


def test_refresh_token_cannot_be_used_after_logout():
    user = FakeUser()
    app.dependency_overrides[get_db] = make_db_override(user)

    access_token = create_access_token(
        user_id=user.id,
        role=user.role,
    )
    refresh_token = create_refresh_token(
        user_id=user.id,
        role=user.role,
    )

    payload = decode_refresh_token(refresh_token)
    assert payload is not None

    refresh_token_store.store(
        jti=payload["jti"],
        user_id=user.id,
        expires_at=datetime.fromtimestamp(
            payload["exp"],
            tz=timezone.utc,
        ),
    )

    try:
        with TestClient(app) as client:
            # First, log out using both tokens.
            client.cookies.set("refresh_token", refresh_token)

            logout_response = client.post(
                "/auth/logout",
                headers={
                    "Authorization": f"Bearer {access_token}"
                },
            )

            assert logout_response.status_code == 200

            # Then, attempt to reuse the original refresh token.
            client.cookies.set("refresh_token", refresh_token)

            refresh_response = client.post("/auth/refresh")

            assert refresh_response.status_code == 401

    finally:
        app.dependency_overrides.clear()
