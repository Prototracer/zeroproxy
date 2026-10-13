from pydantic import BaseModel,EmailStr,Field,ConfigDict

class RegisterRequest(BaseModel):
    name:str=Field(min_length=2,max_length=255)
    email:EmailStr
    roll_no:str=Field(min_length=1,max_length=50)
    password: str=Field(min_length=8,max_length=128)

class UserResponse(BaseModel):
    model_config=ConfigDict(from_attributes=True)
    id: int
    name: str
    roll_no: str
    email: EmailStr
    role: str
    status: str
    must_change_password: bool

class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1,max_length=128)