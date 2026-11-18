"""Database model (Lingora Platform v1, section 5).

All ids are UUIDs. Every table has created_at, and updated_at where rows change.
Indexes on every foreign key and on status columns. Business rules that the database
itself must enforce are CHECK constraints (see `ck_clips_consent_or_permission`).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

NAMING = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)


def _id() -> Mapped[uuid.UUID]:
    return mapped_column(Uuid, primary_key=True, default=uuid.uuid4)


def _created() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


def _updated() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


LANGS = "('uz','ru','en')"


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = _id()
    email: Mapped[str] = mapped_column(String(254), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(40), nullable=False)
    language: Mapped[str] = mapped_column(String(2), nullable=False, default="uz")
    role: Mapped[str] = mapped_column(String(10), nullable=False, default="user")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Lockout after repeated failures (section 7): 10 failures -> 15 minutes.
    failed_logins: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()
    __table_args__ = (
        CheckConstraint("email = lower(email)", name="email_lowercase"),
        CheckConstraint(f"language in {LANGS}", name="language"),
        CheckConstraint("role in ('user','admin')", name="role"),
    )


class Session(Base):
    """Server-side session. The id is the SHA-256 of the cookie token, never the token itself."""

    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    user_agent_hash: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = _created()


class ConsentText(Base):
    __tablename__ = "consent_texts"
    id: Mapped[uuid.UUID] = _id()
    type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    language: Mapped[str] = mapped_column(String(2), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created()
    __table_args__ = (
        UniqueConstraint("type", "version", "language", name="uq_consent_texts_type_version_language"),
        CheckConstraint("type in ('account','contribute_data','voice')", name="type"),
        CheckConstraint(f"language in {LANGS}", name="language"),
    )


class Consent(Base):
    __tablename__ = "consents"
    id: Mapped[uuid.UUID] = _id()
    # SET NULL, not CASCADE: a consent that is the legal basis of a clip kept in an activated
    # model's training set must survive account deletion (the clip CHECK needs it).
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    consent_text_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("consent_texts.id"), index=True, nullable=False)
    accepted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created()


class Sign(Base):
    __tablename__ = "signs"
    id: Mapped[uuid.UUID] = _id()
    slug: Mapped[str] = mapped_column(String(60), unique=True, nullable=False)
    labels: Mapped[dict] = mapped_column(JSONB, nullable=False)  # {en, ru, uz}
    scenario: Mapped[str] = mapped_column(String(40), nullable=False, default="greeting", index=True)
    reference_clip_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("clips.id", ondelete="SET NULL", use_alter=True, name="fk_signs_reference_clip_id_clips"), index=True
    )
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="draft", index=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()
    __table_args__ = (
        CheckConstraint("status in ('draft','active','retired')", name="status"),
        CheckConstraint("labels ? 'en' and labels ? 'ru' and labels ? 'uz'", name="labels_three_languages"),
    )


class Signer(Base):
    """A pseudonym (S01 style), never a real name."""

    __tablename__ = "signers"
    id: Mapped[uuid.UUID] = _id()
    code: Mapped[str] = mapped_column(String(10), unique=True, nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    created_at: Mapped[datetime] = _created()
    __table_args__ = (CheckConstraint("type in ('native_deaf','hearing_learner','instructor_video')", name="type"),)


class Permission(Base):
    """Required for every video-derived clip."""

    __tablename__ = "permissions"
    id: Mapped[uuid.UUID] = _id()
    owner_name: Mapped[str] = mapped_column(String(200), nullable=False)
    source_url: Mapped[str] = mapped_column(String(1000), nullable=False)
    license: Mapped[str] = mapped_column(String(200), nullable=False)
    evidence_note: Mapped[str] = mapped_column(Text, nullable=False)
    granted_on: Mapped[date] = mapped_column(Date, nullable=False)
    scope: Mapped[str] = mapped_column(String(500), nullable=False)
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    created_at: Mapped[datetime] = _created()


class Clip(Base):
    __tablename__ = "clips"
    id: Mapped[uuid.UUID] = _id()
    sign_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("signs.id"), index=True, nullable=False)
    signer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("signers.id"), index=True, nullable=False)
    source_type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    source_ref: Mapped[str | None] = mapped_column(String(500))
    consent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("consents.id", ondelete="SET NULL"), index=True)
    permission_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("permissions.id"), index=True)
    fps: Mapped[int] = mapped_column(Integer, nullable=False)
    aspect: Mapped[str] = mapped_column(String(10), nullable=False)
    n_frames: Mapped[int] = mapped_column(Integer, nullable=False)
    data: Mapped[dict] = mapped_column(JSONB, nullable=False)  # landmark frames only, never video
    quality: Mapped[dict | None] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="pending", index=True)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    review_reason: Mapped[str | None] = mapped_column(String(300))
    # Set when the clip is part of an activated model's training set (consent withdrawal rule, section 7).
    in_training_set: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()
    __table_args__ = (
        # The database itself rejects a clip with neither consent nor permission (sections 5 and 12).
        CheckConstraint("consent_id is not null or permission_id is not null", name="consent_or_permission"),
        CheckConstraint("source_type in ('phone','instructor_video')", name="source_type"),
        CheckConstraint("status in ('pending','approved','rejected')", name="status"),
        CheckConstraint("n_frames between 1 and 120", name="n_frames"),
    )


class Model(Base):
    __tablename__ = "models"
    id: Mapped[uuid.UUID] = _id()
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    version: Mapped[str] = mapped_column(String(40), nullable=False)
    feature_version: Mapped[str] = mapped_column(String(40), nullable=False)
    runtime: Mapped[str] = mapped_column(String(40), nullable=False)
    classes: Mapped[list] = mapped_column(JSONB, nullable=False)
    artifact_path: Mapped[str] = mapped_column(String(500), nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    metrics: Mapped[dict | None] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="candidate", index=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()
    __table_args__ = (
        UniqueConstraint("name", "version", name="uq_models_name_version"),
        CheckConstraint("status in ('candidate','active','retired')", name="status"),
        # At most one active model at any time.
        Index("uq_models_one_active", "status", unique=True, postgresql_where=text("status = 'active'")),
    )


class Evaluation(Base):
    __tablename__ = "evaluations"
    id: Mapped[uuid.UUID] = _id()
    model_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("models.id", ondelete="CASCADE"), index=True, nullable=False)
    held_out_signers: Mapped[list] = mapped_column(JSONB, nullable=False)
    metrics: Mapped[dict] = mapped_column(JSONB, nullable=False)
    report_path: Mapped[str | None] = mapped_column(String(500))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    created_at: Mapped[datetime] = _created()


class Feedback(Base):
    __tablename__ = "feedback"
    id: Mapped[uuid.UUID] = _id()
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    sign_ids: Mapped[list] = mapped_column(JSONB, nullable=False)
    model_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("models.id", ondelete="SET NULL"), index=True)
    note: Mapped[str | None] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="new", index=True)
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()
    __table_args__ = (
        CheckConstraint("kind in ('wrong_sign','wrong_translation','other')", name="kind"),
        CheckConstraint("status in ('new','reviewed','closed')", name="status"),
        CheckConstraint("note is null or char_length(note) <= 300", name="note_length"),
    )


class Phrase(Base):
    __tablename__ = "phrases"
    id: Mapped[uuid.UUID] = _id()
    slug: Mapped[str] = mapped_column(String(60), unique=True, nullable=False)
    texts: Mapped[dict] = mapped_column(JSONB, nullable=False)  # {en, ru, uz}
    audio_path: Mapped[str | None] = mapped_column(String(500))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()


class UserPhrase(Base):
    """Saved only when the user opts in. Conversation text is otherwise never stored."""

    __tablename__ = "user_phrases"
    id: Mapped[uuid.UUID] = _id()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    text: Mapped[str] = mapped_column(String(300), nullable=False)
    language: Mapped[str] = mapped_column(String(2), nullable=False)
    created_at: Mapped[datetime] = _created()
    __table_args__ = (CheckConstraint(f"language in {LANGS}", name="language"),)


class AuditLog(Base):
    """Append only (a trigger rejects UPDATE and DELETE). actor_id has no foreign key on purpose,
    so deleting a user never rewrites history."""

    __tablename__ = "audit_log"
    id: Mapped[uuid.UUID] = _id()
    actor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, index=True)
    action: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    target_type: Mapped[str | None] = mapped_column(String(40))
    target_id: Mapped[str | None] = mapped_column(String(64))
    meta: Mapped[dict | None] = mapped_column(JSONB)
    ip_hash: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
