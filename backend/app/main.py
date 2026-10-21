from fastapi import FastAPI, HTTPException
from app.routers import auth,faculty
from app.core.errors import http_exception_handler, validation_exception_handler , rate_limit_exceeded_handler
from fastapi.exceptions import RequestValidationError
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.core.rate_limiter import limiter

app=FastAPI(title="ZeroProxy API",
            description="Smart attendance system with QR verification",
            version="0.1.0")

app.state.limiter=limiter
app.add_exception_handler(RateLimitExceeded,rate_limit_exceeded_handler)

app.add_exception_handler(HTTPException,http_exception_handler)
app.add_exception_handler(
    RequestValidationError,
    validation_exception_handler,
)
@app.get("/health")
async def health_check():
    return {"status":"ok"}

app.include_router(auth.router)
app.include_router(faculty.router)