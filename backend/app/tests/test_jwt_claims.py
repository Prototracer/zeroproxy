import jwt
import time

from app.config import JWT_SECRET, JWT_ALGORITHM
from app.core.security import decode_access_token


def test_token_missing_jti_is_rejected():
    payload = {
        "sub": "4",
        "role": "student",
        "iat": 1792152000,
        "exp": 1792155600,
        # Deliberately missing "jti"
    }

    token = jwt.encode(
        payload,
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )

    assert decode_access_token(token) is None

def test_token_missing_role_is_rejected():
    payload = {
        "sub": "4",
        "iat": 1792152000,
        "exp": 1792155600,
        "jti": "test-token-id",
    }

    token = jwt.encode(
        payload,
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )

    assert decode_access_token(token) is None


def test_token_with_all_required_claims_is_accepted():
   now = int(time.time())

   payload = {
    "sub": "4",
    "role": "student",
    "typ": "access",
    "iat": now - 60,       # Issued 60 seconds ago
    "exp": now + 3600,     # Expires in 1 hour
    "jti": "test-token-id",
      }

   token = jwt.encode(
        payload,
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )
   assert decode_access_token(token) is not None