import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from app.models.user import User


class EmailVerification(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "email_verifications"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    email: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
    )
    otp_hash: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    attempts: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    # Relationships
    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])
