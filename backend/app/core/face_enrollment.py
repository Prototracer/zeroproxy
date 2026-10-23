
from itertools import combinations
from math import isfinite, sqrt
from typing import Sequence

from app.config import (
    MAX_ENROLL_SAMPLES,
    MIN_ENROLL_SAMPLES,
    MAX_ENROLL_SPREAD,
)


class EnrollmentValidationError(ValueError):
    """Raised when face enrollment samples fail validation."""


def _validate_descriptor(descriptor: Sequence[float]) -> list[float]:
    if (
        isinstance(descriptor, (str, bytes))
        or not isinstance(descriptor, (list, tuple))
        or len(descriptor) != 128
    ):
        raise EnrollmentValidationError(
            "Each descriptor must contain exactly 128 values"
        )

    values = []

    for value in descriptor:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise EnrollmentValidationError(
                "Descriptor values must be numeric"
            )

        value = float(value)

        if not isfinite(value):
            raise EnrollmentValidationError(
                "Descriptor values must be finite"
            )

        values.append(value)

    return values


def euclidean_distance(
    first: Sequence[float],
    second: Sequence[float],
) -> float:
    if len(first) != len(second):
        raise ValueError("Descriptors must have matching dimensions")

    return sqrt(sum((a - b) ** 2 for a, b in zip(first, second)))


def validate_enrollment_descriptors(
    descriptors: Sequence[Sequence[float]],
) -> list[list[float]]:
    """Validate enrollment count, descriptor structure and sample consistency."""
    if (
        isinstance(descriptors, (str, bytes))
        or not isinstance(descriptors, (list, tuple))
    ):
        raise EnrollmentValidationError(
            "Descriptors must be a list or tuple"
        )

    if not MIN_ENROLL_SAMPLES <= len(descriptors) <= MAX_ENROLL_SAMPLES:
        raise EnrollmentValidationError(
            f"Enrollment requires {MIN_ENROLL_SAMPLES} to "
            f"{MAX_ENROLL_SAMPLES} descriptors"
        )

    validated = [
        _validate_descriptor(descriptor)
        for descriptor in descriptors
    ]

    for first, second in combinations(validated, 2):
        if euclidean_distance(first, second) > MAX_ENROLL_SPREAD:
            raise EnrollmentValidationError(
                "Enrollment descriptors are inconsistent"
            )

    return validated
