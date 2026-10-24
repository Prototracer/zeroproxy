from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded

from app.core.errors import (
    http_exception_handler,
    rate_limit_exceeded_handler,
    validation_exception_handler,
)
from app.core.rate_limiter import limiter
from app.routers import admin, attendance, auth, faculty, sessions, student

app = FastAPI(
    title="ZeroProxy API",
    description="Smart attendance system with QR verification",
    version="0.1.0",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)
app.add_exception_handler(HTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    return {"status": "ok"}


app.include_router(auth.router)
app.include_router(student.router)
app.include_router(faculty.router)
app.include_router(sessions.router)
app.include_router(attendance.router)
app.include_router(admin.router)