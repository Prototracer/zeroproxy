from fastapi import Request,HTTPException
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError

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