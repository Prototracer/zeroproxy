"""
Tests for QR service — HMAC token generation and validation.

Covers handbook §8.1 "QR" test requirements:
  - Tampered MAC rejected
  - Token from two windows ago rejected
  - Current and previous window accepted
"""

import time
from unittest.mock import patch

import pytest

from app.services.qr_service import (
    WINDOW_SECONDS,
    generate_qr_payload,
    validate_qr_token,
    _current_window,
    _compute_mac,
)


SESSION_ID = 42


class TestQRGeneration:
    def test_generate_returns_required_fields(self):
        payload = generate_qr_payload(SESSION_ID)
        assert payload["session_id"] == SESSION_ID
        assert "window" in payload
        assert "mac" in payload
        assert "expires_in_ms" in payload

    def test_mac_is_hex_string(self):
        payload = generate_qr_payload(SESSION_ID)
        mac = payload["mac"]
        assert isinstance(mac, str)
        assert len(mac) == 32
        # Verify it's hex
        int(mac, 16)

    def test_expires_in_ms_is_positive(self):
        payload = generate_qr_payload(SESSION_ID)
        assert payload["expires_in_ms"] >= 0

    def test_different_sessions_get_different_macs(self):
        p1 = generate_qr_payload(1)
        p2 = generate_qr_payload(2)
        assert p1["mac"] != p2["mac"]


class TestQRValidation:
    def test_current_window_is_accepted(self):
        payload = generate_qr_payload(SESSION_ID)
        assert validate_qr_token(SESSION_ID, payload["window"], payload["mac"]) is True

    def test_previous_window_is_accepted(self):
        """The previous window must be accepted to handle clock skew (handbook §3 step 2)."""
        current = _current_window()
        prev_mac = _compute_mac(SESSION_ID, current - 1)
        assert validate_qr_token(SESSION_ID, current - 1, prev_mac) is True

    def test_two_windows_ago_is_rejected(self):
        current = _current_window()
        old_mac = _compute_mac(SESSION_ID, current - 2)
        assert validate_qr_token(SESSION_ID, current - 2, old_mac) is False

    def test_tampered_mac_is_rejected(self):
        payload = generate_qr_payload(SESSION_ID)
        tampered = payload["mac"][:30] + "ff"
        assert validate_qr_token(SESSION_ID, payload["window"], tampered) is False

    def test_wrong_session_id_is_rejected(self):
        payload = generate_qr_payload(SESSION_ID)
        assert validate_qr_token(SESSION_ID + 1, payload["window"], payload["mac"]) is False

    def test_empty_mac_is_rejected(self):
        current = _current_window()
        assert validate_qr_token(SESSION_ID, current, "") is False

    def test_wrong_length_mac_is_rejected(self):
        current = _current_window()
        # A 31-char hex string — hmac.compare_digest handles different lengths safely
        assert validate_qr_token(SESSION_ID, current, "a" * 31) is False
