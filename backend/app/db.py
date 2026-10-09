from sqlalchemy.ext.asyncio import(
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from app.config import DATABASE_URL

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is not set")

engine=create_async_engine(
    DATABASE_URL,
    pool_pre_ping=True,
)

SessionLocal=async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

class Base(DeclarativeBase):
    pass

async def get_db():
    async with SessionLocal() as session:
        yield session