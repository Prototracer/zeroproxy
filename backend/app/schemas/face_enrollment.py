
from pydantic import BaseModel, Field, field_validator


class FaceEnrollmentRequest(BaseModel):
    descriptors: list[list[float]] = Field(
        min_length=3,
        max_length=5,
    )
    consent: bool

    @field_validator("descriptors")
    @classmethod
    def validate_descriptors(cls, descriptors):
        for descriptor in descriptors:
            if len(descriptor) != 128:
                raise ValueError(
                    "Each descriptor must contain exactly 128 values"
                )

            for value in descriptor:
                if not isinstance(value, (int, float)):
                    raise ValueError(
                        "Descriptor values must be numeric"
                    )

        return descriptors

    @field_validator("consent")
    @classmethod
    def require_consent(cls, consent):
        if consent is not True:
            raise ValueError("Consent is required for face enrollment")
        return consent
