"""Shared dependencies: current user, ONE role check used by every endpoint, CSRF/Origin guard, audit."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session as Db

from .config import get_settings
from .db import get_db
from .errors import ApiError
from .models import AuditLog, Session, User
from .security import csrf_token_for, ip_hash, sha256

SESSION_COOKIE = "lingora_session"
UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def load_session(request: Request, db: Db) -> tuple[User | None, Session | None]:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None, None
    sess = db.get(Session, sha256(token))
    if not sess or sess.expires_at <= datetime.now(timezone.utc):
        return None, None
    user = db.get(User, sess.user_id)
    if not user or not user.is_active:
        return None, None
    return user, sess


def current_user(request: Request, db: Db = Depends(get_db)) -> User | None:
    user, sess = load_session(request, db)
    request.state.user = user
    request.state.session = sess
    return user


Role = Literal["any", "user", "admin"]


def require(role: Role):
    """The single role dependency (section 7): 401 when signed out, 403 when the role is too low."""

    def dep(user: User | None = Depends(current_user)) -> User | None:
        if role == "any":
            return user
        if user is None:
            raise ApiError("UNAUTHENTICATED", "Sign in required")
        if role == "admin" and user.role != "admin":
            raise ApiError("FORBIDDEN", "Admin role required")
        return user

    return dep


def csrf_guard(request: Request) -> None:
    """Origin check on every unsafe request, and a CSRF token whenever a session cookie is sent."""
    if request.method not in UNSAFE:
        return
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/") not in get_settings().origins:
        raise ApiError("FORBIDDEN", "Origin not allowed")
    token = request.cookies.get(SESSION_COOKIE)
    if token and request.url.path not in ("/api/auth/login", "/api/auth/register", "/api/auth/telegram"):
        if request.headers.get("x-csrf-token") != csrf_token_for(sha256(token)):
            raise ApiError("FORBIDDEN", "Missing or invalid CSRF token")


def audit(db: Db, request: Request, actor: User | None, action: str, target_type: str | None = None, target_id: object = None, meta: dict | None = None) -> None:
    """Append-only audit entry. meta must never contain passwords, typed text or landmarks."""
    db.add(
        AuditLog(
            actor_id=actor.id if actor else None,
            action=action,
            target_type=target_type,
            target_id=str(target_id) if target_id is not None else None,
            meta=meta,
            ip_hash=ip_hash(client_ip(request)),
        )
    )


def first(db: Db, stmt):
    return db.execute(stmt).scalars().first()


__all__ = ["audit", "client_ip", "csrf_guard", "current_user", "first", "load_session", "require", "select", "SESSION_COOKIE"]
