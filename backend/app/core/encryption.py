
import base64
import binascii
import os
import struct
from math import isfinite
from typing import Sequence

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import ENC_KEY


class DescriptorEncryptionError(ValueError):
    """Raised when encrypted face descriptors are invalid or cannot be decrypted."""


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


def _make_aad(user_id: int, version: int) -> bytes:
    if (
        isinstance(user_id, bool)
        or not isinstance(user_id, int)
        or user_id <= 0
        or isinstance(version, bool)
        or not isinstance(version, int)
        or version <= 0
    ):
        raise ValueError("user_id and version must be positive integers")

    return f"zeroproxy:face-vectors:user={user_id}:version={version}".encode()


def serialize_descriptors(
    descriptors: Sequence[Sequence[float]],
) -> bytes:
    """Serialize 3–5 face descriptors, each containing 128 finite floats."""
    if isinstance(descriptors, (str, bytes)) or not isinstance(descriptors, (list, tuple)):
        raise ValueError("Descriptors must be a list or tuple")

    if not 3 <= len(descriptors) <= 5:
        raise ValueError("Enrollment requires 3 to 5 descriptors")

    output = bytearray(b"ZPF1")
    output.append(len(descriptors))

    for descriptor in descriptors:
        if (
            isinstance(descriptor, (str, bytes))
            or not isinstance(descriptor, (list, tuple))
            or len(descriptor) != 128
        ):
            raise ValueError("Each descriptor must contain exactly 128 values")

        values = []
        for value in descriptor:
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError("Descriptor values must be numbers")

            value = float(value)
            if not isfinite(value):
                raise ValueError("Descriptor values must be finite")

            values.append(value)

        output.extend(struct.pack("!128f", *values))

    return bytes(output)


def deserialize_descriptors(data: bytes) -> list[list[float]]:
    """Deserialize and validate a serialized descriptor set."""
    if not isinstance(data, bytes) or len(data) < 5 or data[:4] != b"ZPF1":
        raise DescriptorEncryptionError("Invalid descriptor serialization")

    count = data[4]
    expected_length = 5 + count * 128 * 4

    if count < 3 or count > 5 or len(data) != expected_length:
        raise DescriptorEncryptionError("Invalid descriptor serialization")

    descriptors = []
    offset = 5

    for _ in range(count):
        values = list(struct.unpack("!128f", data[offset:offset + 512]))
        if not all(isfinite(value) for value in values):
            raise DescriptorEncryptionError("Descriptor contains non-finite values")
        descriptors.append(values)
        offset += 512

    return descriptors


def encrypt_descriptor_set(
    descriptors: Sequence[Sequence[float]],
    *,
    user_id: int,
    version: int,
) -> bytes:
    """Serialize and encrypt an enrollment set using AES-GCM and AAD."""
    serialized = serialize_descriptors(descriptors)
    nonce = os.urandom(12)
    aad = _make_aad(user_id, version)
    ciphertext = AESGCM(_get_key()).encrypt(nonce, serialized, aad)
    return nonce + ciphertext


def decrypt_descriptor_set(
    encrypted: bytes,
    *,
    user_id: int,
    version: int,
) -> list[list[float]]:
    """Decrypt an enrollment set, verifying its student and version binding."""
    if not isinstance(encrypted, bytes) or len(encrypted) < 12 + 16 + 5:
        raise DescriptorEncryptionError("Invalid encrypted descriptor set")

    nonce = encrypted[:12]
    ciphertext = encrypted[12:]
    aad = _make_aad(user_id, version)

    try:
        serialized = AESGCM(_get_key()).decrypt(nonce, ciphertext, aad)
    except InvalidTag as exc:
        raise DescriptorEncryptionError(
            "Descriptor integrity or identity check failed"
        ) from exc

    return deserialize_descriptors(serialized)


# Backward-compatible helpers for existing callers and tests.
def encrypt_descriptor(descriptor: bytes) -> bytes:
    if not isinstance(descriptor, bytes) or not descriptor:
        raise ValueError("Descriptor must be non-empty bytes")

    nonce = os.urandom(12)
    ciphertext = AESGCM(_get_key()).encrypt(nonce, descriptor, None)
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
