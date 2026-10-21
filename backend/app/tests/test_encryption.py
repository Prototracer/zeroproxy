import pytest
from app.core import encryption


def test_descriptor_round_trip(monkeypatch):
    monkeypatch.setattr(
        encryption,
        "ENC_KEY",
        "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
    )

    original = b"example-face-descriptor"

    encrypted = encryption.encrypt_descriptor(original)

    assert encrypted != original
    assert encryption.decrypt_descriptor(encrypted) == original


def test_encryption_uses_different_nonces(monkeypatch):
    monkeypatch.setattr(
        encryption,
        "ENC_KEY",
        "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
    )

    first = encryption.encrypt_descriptor(b"descriptor")
    second = encryption.encrypt_descriptor(b"descriptor")

    assert first != second


def test_modified_ciphertext_is_rejected(monkeypatch):
    monkeypatch.setattr(
        encryption,
        "ENC_KEY",
        "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
    )

    encrypted = bytearray(
        encryption.encrypt_descriptor(b"descriptor")
    )
    encrypted[-1] ^= 1

    with pytest.raises(encryption.DescriptorEncryptionError):
        encryption.decrypt_descriptor(bytes(encrypted))


def test_invalid_encrypted_data_is_rejected():
    with pytest.raises(encryption.DescriptorEncryptionError):
        encryption.decrypt_descriptor(b"too-short")


def test_empty_descriptor_is_rejected():
    with pytest.raises(ValueError):
        encryption.encrypt_descriptor(b"")
