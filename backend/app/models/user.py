from datetime import datetime
from sqlalchemy import Boolean,DateTime,Integer,String,func
from sqlalchemy.orm import Mapped, mapped_column
from app.db import Base

class User(Base):
    __tablename__="users"
    id: Mapped[int]=mapped_column(Integer,primary_key=True,index=True)
    tenant_id: Mapped[int]=mapped_column(Integer,default=1,nullable=False)

    roll_no: Mapped[str]=mapped_column(String(50),unique=True,nullable=False)
    email: Mapped[str]=mapped_column(String(255),unique=True,nullable=False)
    name: Mapped[str]=mapped_column(String(255),nullable=False)
    password_hash: Mapped[str]=mapped_column(String(255),nullable=False)

    role: Mapped[str]=mapped_column(String(20),nullable=False)
    status: Mapped[str]=mapped_column(String(20),default="pending",nullable=False)

    must_change_password: Mapped[bool]=mapped_column(Boolean,default=False,nullable=False)
    created_at: Mapped[datetime]=mapped_column(
        DateTime(timezone=True),server_default=func.now(),nullable=False)

    @property
    def full_name(self) -> str:
        return self.name

    @full_name.setter
    def full_name(self, value: str) -> None:
        self.name = value
    