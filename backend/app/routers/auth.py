from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.security import verify_password,create_access_token
from app.schemas.auth import LoginRequest
from app.core.deps import get_current_user
from app.core.security import hash_password
from app.db import get_db
from app.models.user import User
from app.schemas.auth import RegisterRequest, UserResponse

router=APIRouter(prefix="/auth",tags=["Authentication"])

@router.get("/me")
async def get_me(
    current_user: User=Depends(get_current_user)
    ):
    return {
        "id":current_user.id,
        "name":current_user.name,
        "email":current_user.email,
        "roll_no":current_user.roll_no,
        "role": current_user.role,
        "status": current_user.status,
        "must_change_password": current_user.must_change_password,
    }

@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register(
    request: RegisterRequest,
    db: AsyncSession = Depends(get_db),
):
    # Check whether the email is already registered.
    result = await db.execute(
        select(User).where(User.email == request.email)
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email is already registered",
        )

    # Check whether the roll number is already registered.
    result = await db.execute(
        select(User).where(User.roll_no == request.roll_no)
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Roll number is already registered",
        )

    # Create a student account with a hashed password.
    user = User(
        name=request.name,
        email=request.email,
        roll_no=request.roll_no,
        password_hash=hash_password(request.password),
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
            detail="Email or roll number is already registered",
        )

    return user


@router.post("/login")
async def login(
    request: LoginRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).where(User.email == request.email)
    )
    user = result.scalar_one_or_none()

    # Use the same response for unknown email and wrong password.
    if user is None or not verify_password(
        request.password,
        user.password_hash,
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if user.status != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )

    access_token = create_access_token(
        user_id=user.id,
        role=user.role,
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
    }
