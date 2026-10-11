from fastapi import Depends,HTTPException,status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.user import User
from app.core.security import decode_access_token

oauth2_scheme=OAuth2PasswordBearer(tokenUrl="/auth/login")
#token: str = Depends(oauth2_scheme)

async def get_current_user(
        token: str = Depends(oauth2_scheme),
        db: AsyncSession=Depends(get_db),
):
    payload=decode_access_token(token)

    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token",
            headers={"WWW-Authenticate":"Bearer"}
        )

    user_id=payload.get("sub")

    if user_id is None or not user_id.isdigit():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid access token payload",
            headers={"WWW-Authenticate": "Bearer"}
        )

    result= await db.execute(
        select(User).where(User.id==int(user_id))
    )
    user=result.scalar_one_or_none()

    if user is None:
        raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="User not found",
        headers={"WWW-Authenticate": "Bearer"},
        )

    if user.status != "active":
        raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="User account is inactive",
    )
    return user
def require_role(*allowed_roles: str):
    async def role_checker(
            user: User= Depends(get_current_user),
            ) -> User:
        if user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to access this resource"
            )
        return user
    return role_checker