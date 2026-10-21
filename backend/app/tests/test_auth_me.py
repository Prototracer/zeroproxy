from fastapi.testclient import TestClient
from app.main import app
from datetime import datetime, timezone
from app.core.security import create_access_token, decode_access_token
from app.stores.memory import token_denylist

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