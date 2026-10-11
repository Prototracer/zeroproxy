from fastapi import APIRouter, Depends
from app.core.deps import get_current_user
from app.models.user import User

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