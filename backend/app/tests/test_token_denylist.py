
from datetime import datetime, timedelta, timezone

from app.stores.memory import MemoryTokenDenylist


def test_new_token_is_not_revoked():
    store = MemoryTokenDenylist()

    assert store.is_revoked("token-1") is False


def test_revoked_token_is_detected():
    store = MemoryTokenDenylist()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)

    store.revoke("token-1", expires_at)

    assert store.is_revoked("token-1") is True


def test_expired_revocation_is_removed():
    store = MemoryTokenDenylist()
    expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)

    store.revoke("token-1", expires_at)

    assert store.is_revoked("token-1") is False
    assert "token-1" not in store._revoked_tokens
