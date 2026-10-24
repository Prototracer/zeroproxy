"""
QR token service — handbook §3 "Verification flow" steps 1–2.

QR rotation design (handbook §1 "Token timing" + §3 step 2):
  window  = floor(server_unix_time / WINDOW_SECONDS)
  message = f"{session_id}:{window}"   # delimiter prevents concatenation attacks
  mac     = HMAC-SHA256(QR_MASTER_KEY, message), hex-encoded, first 32 chars

  The QR payload JSON: {"session_id": int, "window": int, "mac": str}

  Validation accepts the current and the previous window so a QR generated
  just before a boundary is still usable for a few seconds (handbook §3 step 2:
  "up to about 10 s").

Handbook note on "Should tier": per-session HKDF key.
Must tier: one master secret (QR_MASTER_KEY). We implement the Must tier here.
"""

import hashlib
import hmac
import json
import time

from app.config import QR_MASTER_KEY

# QR token window in seconds (updated to 30 seconds for easier scanning)
WINDOW_SECONDS: int = 30


def _compute_mac(session_id: int, window: int) -> str:
    """Compute HMAC-SHA256 of '{session_id}:{window}' under QR_MASTER_KEY."""
    if not QR_MASTER_KEY:
        raise RuntimeError("QR_MASTER_KEY is not configured")
    message = f"{session_id}:{window}".encode()
    mac = hmac.new(QR_MASTER_KEY.encode(), message, hashlib.sha256).hexdigest()
    # Return first 32 hex chars (128 bits) — sufficient for a short-lived token
    return mac[:32]


def _current_window() -> int:
    """Return the current time window index."""
    return int(time.time()) // WINDOW_SECONDS


def generate_qr_payload(session_id: int) -> dict:
    """
    Generate the current QR payload dict.

    Each rotation window is a full WINDOW_SECONDS (30 seconds) so faculty display
    always counts down from 30 without partial 15-second jumps.
    """
    window = _current_window()
    mac = _compute_mac(session_id, window)

    return {
        "session_id": session_id,
        "window": window,
        "mac": mac,
        "expires_in_ms": WINDOW_SECONDS * 1000,
    }


def validate_qr_token(session_id: int, window: int, mac: str) -> bool:
    """
    Validate a QR token from a student scan.

    Accepts the current and previous window to handle small clock skew
    (handbook §3 step 2: a QR is usable for "up to about 10 s").

    Uses hmac.compare_digest to prevent timing attacks (handbook §8 flaw #8).
    """
    current = _current_window()
    for accepted_window in (current, current - 1):
        expected_mac = _compute_mac(session_id, accepted_window)
        if (
            accepted_window == window
            and hmac.compare_digest(expected_mac, mac)
        ):
            return True
    return False
