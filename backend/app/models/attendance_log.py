"""
AttendanceLog model — append-only attendance record.

Handbook §6 schema:
  attendance_logs(id, session_id, student_id, marked_at, source [scan|override],
                  ip INET, match_distance, challenge, prev_hash, row_hash,
                  UNIQUE(student_id, session_id))

The UNIQUE constraint at the DB level plus ON CONFLICT DO NOTHING in the service
prevents duplicate attendance (handbook flaw #13 fix).

tenant_id is denormalised for efficient tenant-scoped queries without joins.
"""

from datetime import datetime

from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class AttendanceLog(Base):
    __tablename__ = "attendance_logs"

    __table_args__ = (
        # Prevents duplicate attendance; used with ON CONFLICT DO NOTHING on insert
        UniqueConstraint(
            "student_id",
            "session_id",
            name="uq_attendance_student_session",
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

    session_id: Mapped[int] = mapped_column(
        ForeignKey("attendance_sessions.id"),
        nullable=False,
        index=True,
    )

    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"),
        nullable=False,
        index=True,
    )

    marked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # "scan" = student QR+face; "override" = faculty manual
    source: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )

    # Client IP at submission time (stored as text; PostgreSQL INET cast applied in service)
    ip: Mapped[str | None] = mapped_column(
        String(45),   # fits IPv6
        nullable=True,
    )

    # Lowest Euclidean distance to enrolled samples (null for overrides)
    match_distance: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    # Which liveness challenge was used (e.g. "blink")
    challenge: Mapped[str | None] = mapped_column(
        String(20),
        nullable=True,
    )

    # Optional hash chain fields (handbook §8 flaw #9 "Nice tier")
    prev_hash: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    row_hash: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )
