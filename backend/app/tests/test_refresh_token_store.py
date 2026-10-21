
from datetime import datetime, timedelta, timezone

from app.stores.memory import MemoryRefreshTokenStore


def test_stored_token_can_be_consumed_once():
    store = MemoryRefreshTokenStore()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)

    store.store("refresh-1", 42, expires_at)

    assert store.consume("refresh-1", 42) is True
    assert store.consume("refresh-1", 42) is False


def test_unknown_token_cannot_be_consumed():
    store = MemoryRefreshTokenStore()

    assert store.consume("unknown", 42) is False


def test_expired_token_cannot_be_consumed():
    store = MemoryRefreshTokenStore()
    expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)

    store.store("refresh-1", 42, expires_at)

    assert store.consume("refresh-1", 42) is False


def test_token_cannot_be_consumed_by_another_user():
    store = MemoryRefreshTokenStore()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)

    store.store("refresh-1", 42, expires_at)

    assert store.consume("refresh-1", 99) is False
    assert store.consume("refresh-1", 42) is True
