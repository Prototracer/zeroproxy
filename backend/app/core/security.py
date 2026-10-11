from argon2 import PasswordHasher
from argon2.exceptions import (
    InvalidHashError,
    VerificationError,
    VerifyMismatchError,
    )
from datetime import datetime,timedelta,timezone
import secrets
import jwt
from app.config import(JWT_SECRET,
                       JWT_ALGORITHM,
                       ACCESS_TOKEN_EXPIRE_MINUTES,
                       )
password_hasher=PasswordHasher()

def hash_password(password: str)-> str:
    return password_hasher.hash(password)

def verify_password(password: str,password_hash: str)-> bool:
    try:
        return password_hasher.verify(password_hash,password)
    except (VerifyMismatchError,VerificationError,InvalidHashError):
        return False

def create_access_token(user_id: int,role: str)->str:
    now=datetime.now(timezone.utc)

    payload={
        "sub": str(user_id),
        "role": role,
        "iat": now,
        "exp": now+timedelta(
            minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
        "jti": secrets.token_urlsafe(16),
    }

    token=jwt.encode(
        payload,
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )

    return token

def decode_access_token(token: str)->dict | None:
        try:
            payload=jwt.decode(
                token,
                JWT_SECRET,
                algorithms=[JWT_ALGORITHM],
            )
            return payload
        except jwt.InvalidTokenError:
            return None