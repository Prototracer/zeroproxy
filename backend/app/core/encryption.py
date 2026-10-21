import base64
import binascii

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import ENC_KEY


class DescriptorEncryptionError(ValueError):
    """Raised when a face descriptor cannot be decrypted."""


def _get_key() -> bytes:
    if not ENC_KEY:
        raise RuntimeError("ENC_KEY is not configured")

    try:
        key = base64.b64decode(ENC_KEY, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise RuntimeError(
            "ENC_KEY must be a Base64-encoded AES key"
        ) from exc

    if len(key) not in (16, 24, 32):
        raise RuntimeError(
            "ENC_KEY must decode to 16, 24, or 32 bytes"
        )

    return key


def encrypt_descriptor(descriptor: bytes) -> bytes:
    if not isinstance(descriptor, bytes) or not descriptor:
        raise ValueError("Descriptor must be non-empty bytes")

    nonce = __import__("os").urandom(12)
    ciphertext = AESGCM(_get_key()).encrypt(nonce, descriptor, None)

    # Store nonce before ciphertext; nonce is not secret.
    return nonce + ciphertext


def decrypt_descriptor(encrypted: bytes) -> bytes:
    if not isinstance(encrypted, bytes) or len(encrypted) < 29:
        raise DescriptorEncryptionError("Invalid encrypted descriptor")

    nonce = encrypted[:12]
    ciphertext = encrypted[12:]

    try:
        return AESGCM(_get_key()).decrypt(nonce, ciphertext, None)
    except InvalidTag as exc:
        raise DescriptorEncryptionError(
            "Descriptor integrity check failed"
        ) from exc
