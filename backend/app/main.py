from fastapi import FastAPI
from app.routers import auth

app=FastAPI(title="ZeroProxy API",
            description="Smart attendance system with QR verification",
            version="0.1.0")

@app.get("/health")
async def health_check():
    return {"status":"ok"}

app.include_router(auth.router)