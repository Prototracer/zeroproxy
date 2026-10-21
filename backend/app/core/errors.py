from fastapi import Request,HTTPException
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from slowapi.errors import RateLimitExceeded

async def http_exception_handler(
    request: Request,
    exc: HTTPException,
):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": "http_error",
            "detail": str(exc.detail),
        },
        headers=exc.headers,
    )

async def validation_exception_handler(
        request: Request,
        exc: RequestValidationError,
):
    return JSONResponse(
        status_code=422,
        content={
            "error":"validation_error",
            "detail": "Request  validation failed",
        },
    )

async def rate_limit_exceeded_handler(
    request: Request,
    exc: RateLimitExceeded,
):
    return JSONResponse(
        status_code=429,
        content={
            "error": "rate_limit_exceeded",
            "detail": "Too many login attempts. Try again later.",
        },
    )