
import os
from pathlib import Path
from dotenv import load_dotenv

ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(ENV_FILE)

DATABASE_URL = os.getenv("DATABASE_URL")
JWT_SECRET = os.getenv("JWT_SECRET")
QR_MASTER_KEY = os.getenv("QR_MASTER_KEY")
ENC_KEY = os.getenv("ENC_KEY")

JWT_ALGORITHM="HS256"
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS = 7
# Face enrollment configuration
MIN_ENROLL_SAMPLES = 3
MAX_ENROLL_SAMPLES = 5
MAX_ENROLL_SPREAD = float(os.getenv("MAX_ENROLL_SPREAD", "0.55"))
FACE_MATCH_THRESHOLD = float(
    os.getenv("FACE_MATCH_THRESHOLD", "0.55")
)

CAMPUS_CIDRS = [
    cidr.strip()
    for cidr in os.getenv("CAMPUS_CIDRS", "").split(",")
    if cidr.strip()
]


def validate_settings():
    required = {
        "DATABASE_URL": DATABASE_URL,
        "JWT_SECRET": JWT_SECRET,
        "QR_MASTER_KEY": QR_MASTER_KEY,
        "ENC_KEY": ENC_KEY,
        "CAMPUS_CIDRS": CAMPUS_CIDRS,
    }

    missing = [
        name for name, value in required.items()
        if not value
    ]

    if missing:
        raise RuntimeError(
            f"Missing required environment variables: {', '.join(missing)}"
        )
