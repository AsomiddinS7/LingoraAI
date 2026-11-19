"""Sign in with Google (OpenID Connect, authorization code + PKCE) and Telegram (Login, HMAC-checked).

Nothing third-party runs inside the Lingora page: both are full-page redirects.
- Google: the ID token comes straight from Google's token endpoint over TLS, using our client secret,
  so its claims can be trusted after checking iss, aud, exp, nonce and email_verified (OIDC Core 3.1.3.7).
- Telegram: the login data is signed with HMAC-SHA256 using SHA256(bot token) as the key; a forged or
  stale payload (older than 24 h) is rejected.
First sign-in creates an account only when the current account consent was accepted (spec section 7).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
import urllib.parse
import urllib.request
import uuid

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.orm import Session as Db

from ..config import get_settings
from ..db import get_db
from ..deps import audit, client_ip
from ..errors import ApiError
from ..models import AuthIdentity, Consent, ConsentText, User
from ..schemas import Strict
from ..security import hmac_hex, limiter
from .auth import me_body, start_session

router = APIRouter(prefix="/api/auth", tags=["social"])

GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}
OAUTH_COOKIE = "lingora_oauth"
TELEGRAM_MAX_AGE_S = 24 * 3600


class ConsentRequired(Exception):
    pass


# ---------------------------------------------------------------- shared
def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _b64url_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _base_url(request: Request) -> str:
    return get_settings().base_url or str(request.base_url).rstrip("/")


def _valid_account_consent(db: Db, consent_id: str | None) -> ConsentText | None:
    if not consent_id:
        return None
    try:
        cid = uuid.UUID(consent_id)
    except ValueError:
        return None
    t = db.get(ConsentText, cid)
    return t if t and t.type == "account" and t.published_at else None


def complete_social_login(db: Db, request: Request, provider: str, subject: str, email: str | None, name: str, language: str, consent_id: str | None) -> User:
    ident = db.execute(select(AuthIdentity).where(AuthIdentity.provider == provider, AuthIdentity.subject == subject)).scalars().first()
    if ident:
        user = db.get(User, ident.user_id)
    else:
        user = None
        if email:  # verified by the provider: link to the existing account with that email
            user = db.execute(select(User).where(User.email == email)).scalars().first()
        if user is None:
            consent = _valid_account_consent(db, consent_id)
            if consent is None:
                raise ConsentRequired()
            user = User(email=email, password_hash=None, display_name=(name or "Lingora")[:40], language=language if language in ("uz", "ru", "en") else "uz", role="user")
            db.add(user)
            db.flush()
            db.add(Consent(user_id=user.id, consent_text_id=consent.id))
            audit(db, request, user, "user.register", "user", user.id, {"provider": provider, "consents": [f"account:v{consent.version}"]})
        db.add(AuthIdentity(user_id=user.id, provider=provider, subject=subject, email=email))
        db.flush()
    if not user or not user.is_active:
        raise ApiError("FORBIDDEN", "This account is disabled")
    audit(db, request, user, "auth.login", "user", user.id, {"provider": provider})
    return user


@router.get("/providers")
def providers():
    s = get_settings()
    bot_id = s.telegram_bot_token.split(":", 1)[0] if s.telegram_bot_token else ""
    return {
        "google": bool(s.google_client_id and s.google_client_secret),
        "telegram": {"bot_id": int(bot_id)} if bot_id.isdigit() else None,
    }


# ---------------------------------------------------------------- Google
def _sign(payload: dict) -> str:
    raw = _b64url(json.dumps(payload, separators=(",", ":")).encode())
    return f"{raw}.{hmac_hex('oauth:' + raw)}"


def _unsign(value: str | None) -> dict | None:
    if not value or "." not in value:
        return None
    raw, sig = value.rsplit(".", 1)
    if not hmac.compare_digest(sig, hmac_hex("oauth:" + raw)):
        return None
    data = json.loads(_b64url_decode(raw))
    return data if data.get("exp", 0) > time.time() else None


def google_exchange(code: str, verifier: str, redirect_uri: str) -> dict:
    """Token request to Google (replaced in tests)."""
    s = get_settings()
    body = urllib.parse.urlencode({
        "code": code, "client_id": s.google_client_id, "client_secret": s.google_client_secret,
        "redirect_uri": redirect_uri, "grant_type": "authorization_code", "code_verifier": verifier,
    }).encode()
    req = urllib.request.Request(GOOGLE_TOKEN, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=10) as r:  # noqa: S310 (fixed https URL)
        return json.loads(r.read())


def _id_token_claims(id_token: str) -> dict:
    parts = id_token.split(".")
    if len(parts) != 3:
        raise ValueError("malformed id_token")
    return json.loads(_b64url_decode(parts[1]))


def _back(request: Request, route: str, **params: str) -> RedirectResponse:
    q = ("?" + urllib.parse.urlencode(params)) if params else ""
    return RedirectResponse(f"{_base_url(request)}/#/{route}{q}", status_code=302)


@router.get("/google/start")
def google_start(request: Request, consent: str | None = Query(None, max_length=64), lang: str = Query("uz", pattern="^(uz|ru|en)$")):
    s = get_settings()
    if not (s.google_client_id and s.google_client_secret):
        return _back(request, "signin", error="not_available")
    state, nonce, verifier = secrets.token_urlsafe(24), secrets.token_urlsafe(24), secrets.token_urlsafe(48)
    challenge = _b64url(hashlib.sha256(verifier.encode()).digest())
    redirect_uri = f"{_base_url(request)}/api/auth/google/callback"
    url = GOOGLE_AUTH + "?" + urllib.parse.urlencode({
        "client_id": s.google_client_id, "redirect_uri": redirect_uri, "response_type": "code",
        "scope": "openid email profile", "state": state, "nonce": nonce,
        "code_challenge": challenge, "code_challenge_method": "S256", "prompt": "select_account",
    })
    resp = RedirectResponse(url, status_code=302)
    resp.set_cookie(OAUTH_COOKIE, _sign({"state": state, "nonce": nonce, "verifier": verifier, "consent": consent, "lang": lang, "exp": time.time() + 600}),
                    max_age=600, httponly=True, secure=s.cookie_secure, samesite="lax", path="/api/auth/google")
    return resp


@router.get("/google/callback")
def google_callback(request: Request, state: str = "", code: str = "", error: str = "", db: Db = Depends(get_db)):
    s = get_settings()
    saved = _unsign(request.cookies.get(OAUTH_COOKIE))
    if error or not code or not saved or not hmac.compare_digest(state, saved.get("state", "")):
        return _back(request, "signin", error="cancelled" if error else "failed")
    try:
        tokens = google_exchange(code, saved["verifier"], f"{_base_url(request)}/api/auth/google/callback")
        claims = _id_token_claims(tokens["id_token"])
    except Exception:
        return _back(request, "signin", error="failed")
    ok = (
        claims.get("iss") in GOOGLE_ISSUERS
        and claims.get("aud") == s.google_client_id
        and float(claims.get("exp", 0)) > time.time()
        and hmac.compare_digest(str(claims.get("nonce", "")), saved["nonce"])
        and claims.get("email_verified") in (True, "true")
        and claims.get("sub")
    )
    if not ok:
        return _back(request, "signin", error="failed")
    try:
        user = complete_social_login(db, request, "google", str(claims["sub"]), str(claims.get("email", "")).lower() or None, claims.get("name") or claims.get("given_name") or "", saved.get("lang", "uz"), saved.get("consent"))
    except ConsentRequired:
        return _back(request, "register", error="consent_required")
    resp = _back(request, "conversation")
    start_session(db, request, resp, user)
    resp.delete_cookie(OAUTH_COOKIE, path="/api/auth/google")
    return resp


# ---------------------------------------------------------------- Telegram
class TelegramIn(Strict):
    id: int
    first_name: str = Field(max_length=200)
    last_name: str | None = Field(default=None, max_length=200)
    username: str | None = Field(default=None, max_length=200)
    photo_url: str | None = Field(default=None, max_length=1000)
    auth_date: int
    hash: str = Field(min_length=64, max_length=64)
    consent_text_id: str | None = Field(default=None, max_length=64)
    language: str = Field(default="uz", pattern="^(uz|ru|en)$")


def telegram_check(data: dict, bot_token: str, now: float | None = None) -> bool:
    """Telegram Login check: HMAC-SHA256 over sorted 'key=value' lines, key = SHA256(bot_token)."""
    given = str(data.get("hash", ""))
    fields = {k: v for k, v in data.items() if k in ("id", "first_name", "last_name", "username", "photo_url", "auth_date") and v is not None}
    check = "\n".join(f"{k}={fields[k]}" for k in sorted(fields))
    expected = hmac.new(hashlib.sha256(bot_token.encode()).digest(), check.encode(), hashlib.sha256).hexdigest()
    fresh = (now or time.time()) - int(data.get("auth_date", 0)) < TELEGRAM_MAX_AGE_S
    return hmac.compare_digest(expected, given) and fresh


@router.post("/telegram")
def telegram_login(body: TelegramIn, request: Request, response: Response, db: Db = Depends(get_db)):
    s = get_settings()
    if not s.telegram_bot_token:
        raise ApiError("NOT_AVAILABLE", "Telegram sign-in is not configured")
    wait = limiter.hit(f"telegram:ip:{client_ip(request)}", 20, 600)
    if wait is not None:
        raise ApiError("RATE_LIMITED", "Too many attempts", retry_after_s=wait)
    if not telegram_check(body.model_dump(), s.telegram_bot_token):
        raise ApiError("UNAUTHENTICATED", "Telegram login could not be verified")
    name = " ".join(x for x in (body.first_name, body.last_name) if x)
    try:
        user = complete_social_login(db, request, "telegram", str(body.id), None, name, body.language, body.consent_text_id)
    except ConsentRequired:
        raise ApiError("BAD_REQUEST", "consent_required")
    sid = start_session(db, request, response, user)
    return me_body(user, sid)
