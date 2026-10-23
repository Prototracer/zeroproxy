import pytest
from app.core import encryption
from app.core.encryption import (
    encrypt_descriptor_set,
    decrypt_descriptor_set,
    serialize_descriptors,
    deserialize_descriptors,
)

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


import pytest


def make_descriptors(count=3):
    return [
        [float(i + j) / 100 for j in range(128)]
        for i in range(count)
    ]


def test_descriptor_set_round_trip(monkeypatch):
    monkeypatch.setattr(
        "app.core.encryption.ENC_KEY",
        "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
    )

    descriptors = make_descriptors(3)

    encrypted = encrypt_descriptor_set(
        descriptors,
        user_id=10,
        version=1,
    )

    decrypted = decrypt_descriptor_set(
        encrypted,
        user_id=10,
        version=1,
    )

    assert len(decrypted) == 3
    assert len(decrypted[0]) == 128
    for original, recovered in zip(descriptors, decrypted):
        assert recovered == pytest.approx(original, abs=1e-6)


def test_descriptor_set_rejects_wrong_user(monkeypatch):
    monkeypatch.setattr(
        "app.core.encryption.ENC_KEY",
        "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
    )

    encrypted = encrypt_descriptor_set(
        make_descriptors(),
        user_id=10,
        version=1,
    )

    with pytest.raises(ValueError, match="identity check failed"):
        decrypt_descriptor_set(
            encrypted,
            user_id=11,
            version=1,
        )


def test_descriptor_set_rejects_wrong_version(monkeypatch):
    monkeypatch.setattr(
        "app.core.encryption.ENC_KEY",
        "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
    )

    encrypted = encrypt_descriptor_set(
        make_descriptors(),
        user_id=10,
        version=1,
    )

    with pytest.raises(ValueError, match="identity check failed"):
        decrypt_descriptor_set(
            encrypted,
            user_id=10,
            version=2,
        )


@pytest.mark.parametrize("count", [0, 1, 2, 6])
def test_serialization_rejects_invalid_sample_count(count):
    with pytest.raises(ValueError, match="3 to 5"):
        serialize_descriptors(make_descriptors(count))


def test_serialization_rejects_wrong_descriptor_dimension():
    with pytest.raises(ValueError, match="128"):
        serialize_descriptors([[0.0] * 127 for _ in range(3)])


def test_serialization_rejects_non_finite_values():
    descriptors = make_descriptors()
    descriptors[0][0] = float("nan")

    with pytest.raises(ValueError, match="finite"):
        serialize_descriptors(descriptors)


def test_serialization_round_trip():
    descriptors = make_descriptors(5)

    serialized = serialize_descriptors(descriptors)
    recovered = deserialize_descriptors(serialized)

    assert len(recovered) == 5
    for original, actual in zip(descriptors, recovered):
        assert actual == pytest.approx(original, abs=1e-6)
