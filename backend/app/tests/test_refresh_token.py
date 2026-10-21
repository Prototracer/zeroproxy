import jwt
from datetime import datetime, timedelta, timezone

from app.config import JWT_SECRET, JWT_ALGORITHM
from app.core.security import (
    create_refresh_token,
    decode_refresh_token,
    decode_access_token,
    create_access_token,
)


def test_refresh_token_is_created_and_decoded():
    token = create_refresh_token(user_id=1, role="student")

    payload = decode_refresh_token(token)

    assert payload is not None
    assert payload["sub"] == "1"
    assert payload["role"] == "student"
    assert payload["typ"] == "refresh"


def test_refresh_token_cannot_be_used_as_access_token():
    token = create_refresh_token(user_id=1, role="student")

    assert decode_access_token(token) is None


def test_access_token_cannot_be_used_as_refresh_token():
    token = create_access_token(user_id=1, role="student")

    assert decode_refresh_token(token) is None


def test_expired_refresh_token_is_rejected():
    now = datetime.now(timezone.utc)

    payload = {
        "sub": "1",
        "role": "student",
        "typ": "refresh",
        "iat": now - timedelta(days=8),
        "exp": now - timedelta(days=1),
        "jti": "expired-refresh-test",
    }

    token = jwt.encode(
        payload,
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )

    assert decode_refresh_token(token) is None


def test_invalid_refresh_token_is_rejected():
    assert decode_refresh_token("not-a-valid-token") is None