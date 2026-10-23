
from datetime import datetime
from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column
from app.db import Base


class FaceVector(Base):
    __tablename__ = "face_vectors"
    __table_args__ = (
    Index(
        "uq_face_vectors_one_active_per_user",
        "tenant_id",
        "user_id",
        unique=True,
        postgresql_where=text("active = true"),
    ),
    )

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )

    tenant_id: Mapped[int] = mapped_column(
        Integer,
        default=1,
        nullable=False,
        index=True,
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"),
        nullable=False,
        index=True,
    )

    # Stores the encrypted set of 3–5 face descriptors.
    # Never store raw descriptors in this column.
    descriptor_enc: Mapped[bytes] = mapped_column(
        LargeBinary,
        nullable=False,
    )

    version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )

    approved_by: Mapped[int] = mapped_column(
        ForeignKey("users.id"),
        nullable=False,
    )

    consent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
