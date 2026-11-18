"""Request bodies: Pydantic with extra fields forbidden (section 4)."""
from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

Lang = Literal["uz", "ru", "en"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, protected_namespaces=())


class RegisterIn(Strict):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)
    display_name: str = Field(min_length=1, max_length=40)
    language: Lang = "uz"
    consent_ids: list[uuid.UUID] = Field(default_factory=list, max_length=10)


class LoginIn(Strict):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class MePatch(Strict):
    display_name: str | None = Field(default=None, min_length=1, max_length=40)
    language: Lang | None = None


class ConsentIn(Strict):
    consent_text_id: uuid.UUID


class SignIn(Strict):
    label: str = Field(min_length=1, max_length=60)
    confidence: float = Field(ge=0, le=1)


class FaceHints(Strict):
    question: bool
    negation: bool


class SentenceIn(Strict):
    session_id: uuid.UUID
    language: Lang
    context: str = Field(min_length=1, max_length=40)
    signs: list[SignIn] = Field(min_length=1, max_length=5)
    face_hints: FaceHints | None
    name: str | None = Field(default=None, min_length=1, max_length=40)


class SimplifyIn(Strict):
    session_id: uuid.UUID
    language: Lang
    text: str = Field(min_length=1, max_length=300)


class FeedbackIn(Strict):
    kind: Literal["wrong_sign", "wrong_translation", "other"]
    sign_ids: list[str] = Field(default_factory=list, max_length=5)
    model_id: uuid.UUID | None = None
    note: str | None = Field(default=None, max_length=300)


class Labels(Strict):
    en: str = Field(min_length=1, max_length=120)
    ru: str = Field(min_length=1, max_length=120)
    uz: str = Field(min_length=1, max_length=120)


class AdminSignIn(Strict):
    slug: str = Field(pattern=r"^[a-z][a-z0-9_]{1,59}$")
    labels: Labels
    scenario: str = Field(default="greeting", min_length=1, max_length=40)
    status: Literal["draft", "active", "retired"] = "draft"
    sort_order: int = Field(default=0, ge=0, le=10000)


class AdminSignPatch(Strict):
    labels: Labels | None = None
    scenario: str | None = Field(default=None, min_length=1, max_length=40)
    status: Literal["draft", "active", "retired"] | None = None
    sort_order: int | None = Field(default=None, ge=0, le=10000)


class AdminUserPatch(Strict):
    is_active: bool | None = None
    role: Literal["user", "admin"] | None = None


class AdminFeedbackPatch(Strict):
    status: Literal["new", "reviewed", "closed"]
