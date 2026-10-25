"""
In-memory implementations of all store interfaces.

Using threading.Lock for atomic consume() so a replayed ticket is rejected
even if two requests arrive simultaneously (single Uvicorn worker; handbook §1 "State").
Redis can replace each class in one file when needed.
"""

import secrets
from datetime import datetime, timezone
from threading import Lock

from app.stores.base import Ticket


# ── Token denylist ──────────────────────────────────────────────────────────

class MemoryTokenDenylist:
    def __init__(self) -> None:
        self._revoked_tokens: dict[str, datetime] = {}
        self._lock = Lock()

    def revoke(self, jti: str, expires_at: datetime) -> None:
        with self._lock:
            self._revoked_tokens[jti] = expires_at

    def is_revoked(self, jti: str) -> bool:
        with self._lock:
            expires_at = self._revoked_tokens.get(jti)

            if expires_at is None:
                return False

            if datetime.now(timezone.utc) >= expires_at:
                del self._revoked_tokens[jti]
                return False

            return True


# ── Refresh-token store ──────────────────────────────────────────────────────

class MemoryRefreshTokenStore:
    def __init__(self) -> None:
        self._active_tokens: dict[str, tuple[int, datetime]] = {}
        self._lock = Lock()

    def store(
        self,
        jti: str,
        user_id: int,
        expires_at: datetime,
    ) -> None:
        with self._lock:
            self._active_tokens[jti] = (user_id, expires_at)

    def consume(self, jti: str, user_id: int) -> bool:
        with self._lock:
            entry = self._active_tokens.get(jti)

            if entry is None:
                return False

            stored_user_id, expires_at = entry

            if datetime.now(timezone.utc) >= expires_at:
                del self._active_tokens[jti]
                return False

            if stored_user_id != user_id:
                return False

            del self._active_tokens[jti]
            return True

    def revoke_all_for_user(self, user_id: int) -> int:
        with self._lock:
            to_del = [jti for jti, (uid, _) in self._active_tokens.items() if uid == user_id]
            for jti in to_del:
                del self._active_tokens[jti]
            return len(to_del)



# ── Scan-ticket store ────────────────────────────────────────────────────────

class MemoryTicketStore:
    """
    Stores single-use, account-bound scan tickets.

    consume() is atomic under a lock — two simultaneous requests with the
    same ticket_id will have exactly one succeed.
    """

    def __init__(self) -> None:
        self._tickets: dict[str, Ticket] = {}
        self._lock = Lock()

    def issue(
        self,
        user_id: int,
        session_id: int,
        challenge: str,
        nonce: str,
        ttl_seconds: int,
    ) -> str:
        ticket_id = secrets.token_urlsafe(32)
        now = datetime.now(timezone.utc)
        from datetime import timedelta
        ticket = Ticket(
            ticket_id=ticket_id,
            user_id=user_id,
            session_id=session_id,
            challenge=challenge,
            nonce=nonce,
            issued_at=now,
            expires_at=now + timedelta(seconds=ttl_seconds),
        )
        with self._lock:
            self._tickets[ticket_id] = ticket
        return ticket_id

    def consume(self, ticket_id: str, user_id: int) -> Ticket | None:
        with self._lock:
            ticket = self._tickets.get(ticket_id)

            if ticket is None:
                return None

            # Always delete first — single use regardless of outcome
            del self._tickets[ticket_id]

            if datetime.now(timezone.utc) >= ticket.expires_at:
                return None

            if ticket.user_id != user_id:
                return None

            return ticket


# ── Rate limiter ─────────────────────────────────────────────────────────────

class MemoryRateLimiter:
    """
    Sliding-window rate limiter.

    hit(key, limit, window_s) → True if the request is allowed.

    Stores a list of timestamps per key; prunes expired ones on each call.
    Good enough for a single Uvicorn worker; replace with Redis for multi-worker.
    """

    def __init__(self) -> None:
        self._windows: dict[str, list[datetime]] = {}
        self._lock = Lock()

    def hit(self, key: str, limit: int, window_s: int) -> bool:
        from datetime import timedelta
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(seconds=window_s)

        with self._lock:
            timestamps = self._windows.get(key, [])
            # Prune expired
            timestamps = [t for t in timestamps if t > cutoff]

            if len(timestamps) >= limit:
                self._windows[key] = timestamps
                return False

            timestamps.append(now)
            self._windows[key] = timestamps
            return True


# ── Module-level singletons ──────────────────────────────────────────────────

token_denylist = MemoryTokenDenylist()
refresh_token_store = MemoryRefreshTokenStore()
ticket_store = MemoryTicketStore()
rate_limiter = MemoryRateLimiter()
