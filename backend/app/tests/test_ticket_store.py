"""
Tests for MemoryTicketStore — single-use, account-bound scan tickets.

Covers handbook §8.1 "Tickets" requirements:
  - Reused ticket rejected
  - Another student's ticket rejected
  - Expired ticket rejected
  - Ticket used after the session ended (session check is in the router; here we test store)
"""

import time
from datetime import datetime, timedelta, timezone

import pytest

from app.stores.memory import MemoryTicketStore


USER_1 = 1
USER_2 = 2
SESSION_1 = 10


@pytest.fixture
def store():
    return MemoryTicketStore()


class TestTicketIssue:
    def test_issue_returns_string_ticket_id(self, store):
        tid = store.issue(USER_1, SESSION_1, "blink", "nonce123", ttl_seconds=30)
        assert isinstance(tid, str)
        assert len(tid) > 0

    def test_two_issues_produce_different_ids(self, store):
        t1 = store.issue(USER_1, SESSION_1, "blink", "n1", ttl_seconds=30)
        t2 = store.issue(USER_1, SESSION_1, "blink", "n2", ttl_seconds=30)
        assert t1 != t2


class TestTicketConsume:
    def test_valid_ticket_is_consumed_and_returned(self, store):
        tid = store.issue(USER_1, SESSION_1, "blink", "nonce", ttl_seconds=30)
        ticket = store.consume(tid, USER_1)
        assert ticket is not None
        assert ticket.user_id == USER_1
        assert ticket.session_id == SESSION_1
        assert ticket.challenge == "blink"
        assert ticket.nonce == "nonce"

    def test_ticket_is_single_use(self, store):
        """Reused ticket must be rejected (handbook §8.1 "Tickets")."""
        tid = store.issue(USER_1, SESSION_1, "blink", "n", ttl_seconds=30)
        store.consume(tid, USER_1)          # First use: succeeds
        result = store.consume(tid, USER_1) # Second use: rejected
        assert result is None

    def test_another_users_ticket_is_rejected(self, store):
        """A ticket issued to user 1 cannot be consumed by user 2 (handbook §8.1)."""
        tid = store.issue(USER_1, SESSION_1, "blink", "n", ttl_seconds=30)
        result = store.consume(tid, USER_2)
        assert result is None

    def test_expired_ticket_is_rejected(self, store):
        """A ticket past its TTL must not be consumed (handbook §8.1)."""
        tid = store.issue(USER_1, SESSION_1, "blink", "n", ttl_seconds=0)
        # TTL=0 means expires_at == issued_at, so it's immediately expired
        result = store.consume(tid, USER_1)
        assert result is None

    def test_nonexistent_ticket_returns_none(self, store):
        result = store.consume("no-such-ticket", USER_1)
        assert result is None

    def test_ticket_deleted_even_when_wrong_user(self, store):
        """After a wrong-user rejection, the ticket is still deleted (single use)."""
        tid = store.issue(USER_1, SESSION_1, "blink", "n", ttl_seconds=30)
        store.consume(tid, USER_2)         # Wrong user — should delete ticket
        result = store.consume(tid, USER_1) # Now the real user: also rejected
        assert result is None

    def test_issued_at_and_expires_at_are_set(self, store):
        tid = store.issue(USER_1, SESSION_1, "blink", "n", ttl_seconds=30)
        ticket = store.consume(tid, USER_1)
        assert ticket.issued_at <= datetime.now(timezone.utc)
        assert ticket.expires_at > ticket.issued_at


class TestRateLimiter:
    """Basic tests for MemoryRateLimiter."""

    def test_allows_requests_under_limit(self):
        from app.stores.memory import MemoryRateLimiter
        limiter = MemoryRateLimiter()
        for _ in range(3):
            assert limiter.hit("key", 3, 60) is True

    def test_blocks_requests_over_limit(self):
        from app.stores.memory import MemoryRateLimiter
        limiter = MemoryRateLimiter()
        for _ in range(3):
            limiter.hit("key", 3, 60)
        assert limiter.hit("key", 3, 60) is False

    def test_different_keys_are_independent(self):
        from app.stores.memory import MemoryRateLimiter
        limiter = MemoryRateLimiter()
        for _ in range(3):
            limiter.hit("key_a", 3, 60)
        assert limiter.hit("key_b", 3, 60) is True
