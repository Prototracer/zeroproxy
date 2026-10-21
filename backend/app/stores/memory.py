
from datetime import datetime, timezone
from app.stores.base import TokenDenylist
from threading import Lock

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

token_denylist = MemoryTokenDenylist()
refresh_token_store = MemoryRefreshTokenStore()
