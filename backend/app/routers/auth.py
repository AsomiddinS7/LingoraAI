"""Registration, login, logout, profile (sections 6 and 7)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session as Db

from ..config import get_settings
from ..db import get_db
from ..deps import SESSION_COOKIE, audit, client_ip, require, session_token, wants_bearer
from ..errors import ApiError
from ..models import Consent, ConsentText, Session, User
from ..schemas import LoginIn, RegisterIn
from ..security import csrf_token_for, dummy_verify, hash_password, limiter, new_session_token, password_problem, sha256, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])

WRONG = "Email or password is wrong"  # same message for unknown email and wrong password


def me_body(user: User, session_id: str | None) -> dict:
    return {
        "id": str(user.id),
        "email": user.email,
        "display_name": user.display_name,
        "language": user.language,
        "role": user.role,
        **({"csrf_token": csrf_token_for(session_id)} if session_id else {}),
    }


def _rate(key: str, limit: int, window: int) -> None:
    wait = limiter.hit(key, limit, window)
    if wait is not None:
        raise ApiError("RATE_LIMITED", "Too many attempts", retry_after_s=wait)


def start_session(db: Db, request: Request, response: Response, user: User) -> str:
    s = get_settings()
    token, sid = new_session_token()
    ua = request.headers.get("user-agent")
    db.add(Session(id=sid, user_id=user.id, expires_at=datetime.now(timezone.utc) + timedelta(hours=s.session_ttl_hours), user_agent_hash=sha256(ua) if ua else None))
    if wants_bearer(request):
        # Cross-site client (static site on another host): the token goes in the body, no cookie.
        request.state.bearer_token = token
        return sid
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=s.session_ttl_hours * 3600,
        httponly=True,
        secure=s.cookie_secure,
        samesite="lax",
        path="/",
    )
    return sid


def session_body(request: Request, user: User, sid: str) -> dict:
    """Profile after sign-in, plus the session token for a bearer client."""
    body = me_body(user, sid)
    token = getattr(request.state, "bearer_token", None)
    if token:
        body["token"] = token
    return body


@router.post("/register", status_code=201)
def register(body: RegisterIn, request: Request, response: Response, db: Db = Depends(get_db)):
    email = body.email.lower()
    _rate(f"register:ip:{client_ip(request)}", 20, 600)
    _rate(f"register:email:{email}", 10, 600)
    problem = password_problem(body.password, email)
    if problem:
        raise ApiError("BAD_REQUEST", problem)

    # The current, published account consent must be among the accepted ids.
    accepted = db.execute(select(ConsentText).where(ConsentText.id.in_(body.consent_ids), ConsentText.published_at.is_not(None))).scalars().all()
    if not any(t.type == "account" for t in accepted):
        raise ApiError("BAD_REQUEST", "The account consent must be accepted")

    if db.execute(select(User.id).where(User.email == email)).first():
        raise ApiError("CONFLICT", "An account with this email already exists")

    user = User(email=email, password_hash=hash_password(body.password), display_name=body.display_name, language=body.language, role="user")
    db.add(user)
    db.flush()
    for t in accepted:
        db.add(Consent(user_id=user.id, consent_text_id=t.id))
    sid = start_session(db, request, response, user)
    audit(db, request, user, "user.register", "user", user.id, {"consents": [f"{t.type}:v{t.version}" for t in accepted]})
    return session_body(request, user, sid)


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, db: Db = Depends(get_db)):
    s = get_settings()
    email = body.email.lower()
    _rate(f"login:ip:{client_ip(request)}", 30, 600)
    _rate(f"login:email:{email}", 20, 600)
    now = datetime.now(timezone.utc)
    user = db.execute(select(User).where(User.email == email)).scalars().first()
    if user is None:
        dummy_verify()
        raise ApiError("UNAUTHENTICATED", WRONG)
    if user.locked_until and user.locked_until > now:
        raise ApiError("RATE_LIMITED", "Too many failed attempts. Try again later.", retry_after_s=int((user.locked_until - now).total_seconds()) + 1)
    if not verify_password(user.password_hash, body.password) or not user.is_active:
        user.failed_logins += 1
        if user.failed_logins >= s.login_lock_failures:
            user.locked_until = now + timedelta(minutes=s.login_lock_minutes)
            user.failed_logins = 0
            audit(db, request, None, "auth.locked", "user", user.id)
        db.commit()  # keep the failure count even though we raise
        raise ApiError("UNAUTHENTICATED", WRONG)
    user.failed_logins = 0
    user.locked_until = None
    user.last_login_at = now
    sid = start_session(db, request, response, user)
    audit(db, request, user, "auth.login", "user", user.id)
    return session_body(request, user, sid)


@router.post("/logout")
def logout(request: Request, response: Response, db: Db = Depends(get_db)):
    token = session_token(request)
    if token:
        sess = db.get(Session, sha256(token))
        if sess:
            db.delete(sess)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"status": "ok"}


@router.get("/me")
def me(request: Request, user: User = Depends(require("user"))):
    return me_body(user, request.state.session.id)
