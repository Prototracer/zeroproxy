import re
from datetime import datetime, timezone
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
    Response,
    status,
)
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import (
    ALLOWED_EMAIL_DOMAIN,
    REFRESH_TOKEN_EXPIRE_DAYS,
    ROLL_NO_PATTERN,
)
from app.core.deps import (
    bearer_scheme,
    get_current_user,
)
from app.core.password_policy import is_common_password
from app.core.rate_limiter import limiter
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_access_token,
    decode_refresh_token,
    hash_password,
    verify_password,
)
from app.db import get_db
from app.models.user import User
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    RegisterRequest,
    UserResponse,
)
from app.stores.memory import refresh_token_store, token_denylist

class MemoryTokenDenylist:
    def __init__(self) -> None:
        self._revoked_tokens: dict[str, datetime] = {}

    def revoke(self, jti: str, expires_at: datetime) -> None:
        self._revoked_tokens[jti] = expires_at

    def is_revoked(self, jti: str) -> bool:
        expires_at = self._revoked_tokens.get(jti)

        if expires_at is None:
            return False

        if datetime.now(timezone.utc) >= expires_at:
            del self._revoked_tokens[jti]
            return False

        return True


router = APIRouter(prefix="/auth", tags=["Authentication"])

GENERIC_REGISTER_ERROR = (
    "Could not register with those details. If you already have an account, log in or contact your faculty."
)


@router.get("/me")
async def get_me(
    current_user: User = Depends(get_current_user)
):
    return {
        "id": current_user.id,
        "name": current_user.name,
        "full_name": current_user.name,
        "email": current_user.email,
        "roll_no": current_user.roll_no,
        "role": current_user.role,
        "status": current_user.status,
        "must_change_password": current_user.must_change_password,
    }

@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired access token",
        )
    jti = payload["jti"]
    exp = payload["exp"]
    expires_at = datetime.fromtimestamp(exp, tz=timezone.utc)
    token_denylist.revoke(jti, expires_at)

    refresh_token = request.cookies.get("refresh_token")
    if refresh_token:
        refresh_payload = decode_refresh_token(refresh_token)
        if refresh_payload is not None:
            refresh_token_store.consume(
                jti=refresh_payload["jti"],
                user_id=current_user.id,
            )

    response.delete_cookie(
        key="refresh_token",
        path="/auth",
        secure=True,
        httponly=True,
        samesite="lax",
    )

    return {"message": "Successfully logged out"}

@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("5/minute")
async def register(
    request: Request,
    body: RegisterRequest,
    db: AsyncSession = Depends(get_db),
):
    # 1. Full name validation
    full_name = (body.full_name or body.name or "").strip()
    if len(full_name) < 2 or len(full_name) > 255:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Full name must be between 2 and 255 characters",
        )

    # 2. Roll number validation
    roll_no = (body.roll_no or "").strip().upper()
    if not roll_no or not re.match(ROLL_NO_PATTERN, roll_no):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Roll number must be 3 to 30 characters from [A-Z0-9-_/]",
        )

    # 3. Password validation: >= 10 chars and not common
    if len(body.password) < 10:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 10 characters long",
        )
    if is_common_password(body.password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This password is too common. Please choose a stronger password.",
        )

    # 4. Email domain check
    email = body.email.strip().lower()
    if ALLOWED_EMAIL_DOMAIN:
        allowed_domains = [d.strip().lower() for d in ALLOWED_EMAIL_DOMAIN.split(",") if d.strip()]
        email_domain = email.split("@")[-1] if "@" in email else ""
        if allowed_domains and email_domain not in allowed_domains:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Email must belong to an approved institute domain: {', '.join(allowed_domains)}",
            )

    # 5. Duplicate check with single generic error message
    existing = await db.execute(
        select(User.id).where(
            or_(
                func.lower(User.email) == email,
                func.lower(User.roll_no) == roll_no.lower(),
            )
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=GENERIC_REGISTER_ERROR,
        )

    # 6. Always student role, pending status, ignores client role
    user = User(
        name=full_name,
        email=email,
        roll_no=roll_no,
        password_hash=hash_password(body.password),
        role="student",
        status="pending",
        tenant_id=1,
        must_change_password=False,
    )

    db.add(user)

    try:
        await db.commit()
        await db.refresh(user)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=GENERIC_REGISTER_ERROR,
        )

    return user



@router.post("/refresh")
async def refresh_session(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token missing",
        )

    payload = decode_refresh_token(refresh_token)

    if payload is None:
        response.delete_cookie(
            key="refresh_token",
            path="/auth",
            secure=True,
            httponly=True,
            samesite="lax",
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

    subject = payload.get("sub")

    if not isinstance(subject, str) or not subject.isdigit():
        response.delete_cookie(
            key="refresh_token",
            path="/auth",
            secure=True,
            httponly=True,
            samesite="lax",
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

    user_id = int(subject)
    result = await db.execute(
        select(User).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()

    if (
        user is None
        or user.status in ("inactive", "disabled")
        or (user.role != "student" and user.status != "active")
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    consumed = refresh_token_store.consume(
        jti=payload["jti"],
        user_id=user.id,
    )

    if not consumed:
        response.delete_cookie(
            key="refresh_token",
            path="/auth",
            secure=True,
            httponly=True,
            samesite="lax",
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token expired, revoked, or already used",
        )

    access_token = create_access_token(
        user_id=user.id,
        role=user.role,
    )

    new_refresh_token = create_refresh_token(
        user_id=user.id,
        role=user.role,
    )

    new_payload = decode_refresh_token(new_refresh_token)

    if new_payload is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not create refresh token",
        )

    expires_at = datetime.fromtimestamp(
        new_payload["exp"],
        tz=timezone.utc,
    )

    refresh_token_store.store(
        jti=new_payload["jti"],
        user_id=user.id,
        expires_at=expires_at,
    )


    response.set_cookie(
        key="refresh_token",
        value=new_refresh_token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        path="/auth",
    )

    return {
        "access_token": access_token,
        "accessToken": access_token,
        "token": access_token,
        "token_type": "bearer",
        "role": getattr(user, "role", "student"),
        "user": {
            "id": getattr(user, "id", None),
            "name": getattr(user, "name", ""),
            "email": getattr(user, "email", ""),
            "roll_no": getattr(user, "roll_no", ""),
            "role": getattr(user, "role", "student"),
            "status": getattr(user, "status", "active"),
            "must_change_password": getattr(user, "must_change_password", False),
        },
    }


@router.post("/login")
@limiter.limit("5/minute")
async def login(
    request: Request,
    response: Response,
    credentials: LoginRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).where(User.email == credentials.email)
    )
    user = result.scalar_one_or_none()

    if user is None or not verify_password(
        credentials.password,
        user.password_hash,
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if user.status in ("inactive", "disabled"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )

    if user.role != "student" and user.status != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )

    access_token = create_access_token(
        user_id=user.id,
        role=user.role,
    )

    refresh_token = create_refresh_token(
        user_id=user.id,
        role=user.role,
    )

    refresh_payload = decode_refresh_token(refresh_token)

    # Defensive check before storing the refresh token.
    if refresh_payload is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not create refresh token",
        )

    expires_at = datetime.fromtimestamp(
        refresh_payload["exp"],
        tz=timezone.utc,
    )

    refresh_token_store.store(
        jti=refresh_payload["jti"],
        user_id=user.id,
        expires_at=expires_at,
    )

    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        path="/auth",
    )

    return {
        "access_token": access_token,
        "accessToken": access_token,
        "token": access_token,
        "token_type": "bearer",
        "role": user.role,
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "roll_no": user.roll_no,
            "role": user.role,
            "status": user.status,
            "must_change_password": user.must_change_password,
        },
    }


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Change password when must_change_password or on user request (handbook §7)."""
    if not verify_password(body.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password does not match",
        )

    if body.new_password == body.current_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password cannot be the same as current password",
        )

    if is_common_password(body.new_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This password is too common. Please choose a stronger password.",
        )

    current_user.password_hash = hash_password(body.new_password)
    current_user.must_change_password = False

    await db.commit()
    await db.refresh(current_user)

    return {"message": "Password changed successfully"}