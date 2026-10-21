
from datetime import datetime
from typing import Protocol


class TokenDenylist(Protocol):
    def revoke(self, jti: str, expires_at: datetime) -> None:
        """Mark a token as revoked until its expiration."""
        ...

    def is_revoked(self, jti: str) -> bool:
        """Return True if the token has been revoked."""
        ...


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
