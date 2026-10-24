"""
Store interfaces for ZeroProxy.

Written as Protocols so Redis implementations can replace these later
by dropping in a new module — no changes to callers needed (handbook §1 decision "State").
"""

from datetime import datetime
from dataclasses import dataclass
from typing import Protocol


# ── Token denylist ──────────────────────────────────────────────────────────

class TokenDenylist(Protocol):
    def revoke(self, jti: str, expires_at: datetime) -> None:
        """Mark a token as revoked until its expiration."""
        ...

    def is_revoked(self, jti: str) -> bool:
        """Return True if the token has been revoked."""
        ...


# ── Refresh-token store ──────────────────────────────────────────────────────

class RefreshTokenStore(Protocol):
    def store(
        self,
        jti: str,
        user_id: int,
        expires_at: datetime,
    ) -> None:
        ...

    def consume(self, jti: str, user_id: int) -> bool:
        ...


# ── Scan-ticket store ────────────────────────────────────────────────────────

@dataclass
class Ticket:
    ticket_id: str
    user_id: int
    session_id: int
    challenge: str
    nonce: str
    issued_at: datetime
    expires_at: datetime


class TicketStore(Protocol):
    """
    Single-use, account-bound scan tickets (handbook §1 "Token timing").

    issue()   — creates and stores a ticket, returns its id.
    consume() — atomically burns the ticket and returns it, or None if
                invalid/expired/wrong user.
    """

    def issue(
        self,
        user_id: int,
        session_id: int,
        challenge: str,
        nonce: str,
        ttl_seconds: int,
    ) -> str:
        """Return ticket_id."""
        ...

    def consume(self, ticket_id: str, user_id: int) -> Ticket | None:
        """Atomically consume and return the ticket, or None."""
        ...


# ── Rate limiter ─────────────────────────────────────────────────────────────

class RateLimiter(Protocol):
    """
    Generic sliding-window rate limiter.

    hit() increments the counter for `key` and returns True if the
    request is within the limit, False if it exceeds it.
    """

    def hit(self, key: str, limit: int, window_s: int) -> bool:
        ...
