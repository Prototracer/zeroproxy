
import pytest

from app.core.face_enrollment import (
    EnrollmentValidationError,
    validate_enrollment_descriptors,
)


def make_descriptors(count=3, offset=0.0):
    return [
        [offset + i * 0.001] * 128
        for i in range(count)
    ]


def test_accepts_three_consistent_descriptors():
    descriptors = make_descriptors(3)

    result = validate_enrollment_descriptors(descriptors)

    assert len(result) == 3
    assert all(len(descriptor) == 128 for descriptor in result)


def test_accepts_five_consistent_descriptors():
    descriptors = make_descriptors(5)

    result = validate_enrollment_descriptors(descriptors)

    assert len(result) == 5


@pytest.mark.parametrize("count", [0, 1, 2, 6])
def test_rejects_invalid_sample_count(count):
    with pytest.raises(EnrollmentValidationError):
        validate_enrollment_descriptors(make_descriptors(count))


def test_rejects_wrong_descriptor_dimension():
    descriptors = make_descriptors()
    descriptors[0] = [0.0] * 127

    with pytest.raises(EnrollmentValidationError, match="128"):
        validate_enrollment_descriptors(descriptors)


def test_rejects_non_finite_values():
    descriptors = make_descriptors()
    descriptors[0][0] = float("nan")

    with pytest.raises(EnrollmentValidationError, match="finite"):
        validate_enrollment_descriptors(descriptors)


def test_rejects_inconsistent_descriptors():
    descriptors = make_descriptors()
    descriptors[2] = [1.0] * 128

    with pytest.raises(EnrollmentValidationError, match="inconsistent"):
        validate_enrollment_descriptors(descriptors)
