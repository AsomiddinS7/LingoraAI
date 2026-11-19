"""Google (OIDC + PKCE) and Telegram sign-in."""
import base64
import hashlib
import hmac
import json
import time
import urllib.parse

import pytest
from sqlalchemy import select

from app.config import get_settings
from app.models import AuthIdentity, Consent, User
from app.routers import social
from tests.conftest import assert_error, consent_ids, new_client, register

BOT = "123456789:TEST-bot-token-for-unit-tests"


@pytest.fixture
def configured(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "google_client_id", "client-123.apps.googleusercontent.com")
    monkeypatch.setattr(s, "google_client_secret", "test-secret")
    monkeypatch.setattr(s, "telegram_bot_token", BOT)
    monkeypatch.setattr(s, "public_base_url", "http://testserver")
    return s


def tg_payload(uid=777, first="Aziz", auth_date=None, **extra):
    data = {"id": uid, "first_name": first, "username": "aziz_uz", "auth_date": auth_date or int(time.time())}
    check = "\n".join(f"{k}={data[k]}" for k in sorted(data))
    data["hash"] = hmac.new(hashlib.sha256(BOT.encode()).digest(), check.encode(), hashlib.sha256).hexdigest()
    return {**data, **extra}


# ---------------------------------------------------------------- providers
def test_providers_hidden_when_not_configured(client):
    assert client.get("/api/auth/providers").json() == {"google": False, "telegram": None}


def test_providers_when_configured(client, configured):
    assert client.get("/api/auth/providers").json() == {"google": True, "telegram": {"bot_id": 123456789}}


# ---------------------------------------------------------------- Telegram
def test_telegram_signature_check():
    good = tg_payload()
    assert social.telegram_check(good, BOT)
    assert not social.telegram_check({**good, "first_name": "Mallory"}, BOT)  # tampered
    assert not social.telegram_check(good, "999:other-bot")  # wrong bot
    old = tg_payload(auth_date=int(time.time()) - 2 * 86400)
    assert not social.telegram_check(old, BOT)  # stale


def test_telegram_requires_consent_for_new_account(client, configured):
    assert_error(client.post("/api/auth/telegram", json=tg_payload()), 400, "BAD_REQUEST")


def test_telegram_sign_up_then_sign_in(client, configured, db):
    cid = consent_ids(client)[0]
    r = client.post("/api/auth/telegram", json=tg_payload(consent_text_id=cid, language="ru"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["display_name"] == "Aziz" and body["email"] is None and body["language"] == "ru" and body["csrf_token"]
    user = db.execute(select(User)).scalars().one()
    assert user.password_hash is None
    assert db.execute(select(AuthIdentity.provider, AuthIdentity.subject)).one() == ("telegram", "777")
    assert db.execute(select(Consent)).scalars().one().user_id == user.id
    # second sign-in: no consent needed, same user
    c2 = new_client()
    assert c2.post("/api/auth/telegram", json=tg_payload()).status_code == 200
    assert db.execute(select(User)).scalars().all().__len__() == 1
    assert c2.get("/api/auth/me").json()["id"] == str(user.id)


def test_telegram_forged_is_rejected(client, configured):
    bad = tg_payload(consent_text_id=consent_ids(client)[0])
    bad["id"] = 1  # signature no longer matches
    assert_error(client.post("/api/auth/telegram", json=bad), 401, "UNAUTHENTICATED")


def test_telegram_not_configured(client):
    assert_error(client.post("/api/auth/telegram", json=tg_payload()), 404, "NOT_AVAILABLE")


def test_social_account_cannot_use_password_login(client, configured):
    client.post("/api/auth/telegram", json=tg_payload(consent_text_id=consent_ids(client)[0]))
    # no email, so nothing to log in with; and a wrong-password attempt never matches a None hash
    assert_error(new_client().post("/api/auth/login", json={"email": "aziz@example.org", "password": "anything goes 1"}), 401, "UNAUTHENTICATED")


# ---------------------------------------------------------------- Google
def _id_token(claims: dict) -> str:
    enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()  # noqa: E731
    return f"{enc({'alg': 'RS256'})}.{enc(claims)}.sig"


def _start(client, consent=None):
    q = f"?lang=en&consent={consent}" if consent else "?lang=en"
    r = client.get("/api/auth/google/start" + q, follow_redirects=False)
    assert r.status_code == 302
    loc = urllib.parse.urlparse(r.headers["location"])
    params = dict(urllib.parse.parse_qsl(loc.query))
    assert loc.netloc == "accounts.google.com" and params["code_challenge_method"] == "S256"
    assert params["redirect_uri"] == "http://testserver/api/auth/google/callback"
    return params


def _google(monkeypatch, claims_override=None, nonce_from=None):
    def fake_exchange(code, verifier, redirect_uri):
        assert code == "the-code" and len(verifier) > 40
        claims = {"iss": "https://accounts.google.com", "aud": "client-123.apps.googleusercontent.com", "exp": time.time() + 300,
                  "sub": "google-sub-1", "email": "Dilnoza@Gmail.com", "email_verified": True, "name": "Dilnoza", "nonce": nonce_from["nonce"]}
        claims.update(claims_override or {})
        return {"id_token": _id_token(claims)}
    monkeypatch.setattr(social, "google_exchange", fake_exchange)


def test_google_not_configured_redirects_back(client):
    r = client.get("/api/auth/google/start", follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"].endswith("#/signin?error=not_available")


def test_google_sign_up_and_link(client, configured, monkeypatch, db):
    params = _start(client, consent=consent_ids(client)[0])
    _google(monkeypatch, nonce_from=params)
    r = client.get(f"/api/auth/google/callback?state={params['state']}&code=the-code", follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"].endswith("#/conversation")
    me = client.get("/api/auth/me").json()
    assert me["email"] == "dilnoza@gmail.com" and me["display_name"] == "Dilnoza"
    assert db.execute(select(AuthIdentity.provider)).scalar_one() == "google"


def test_google_links_existing_email_account(client, configured, monkeypatch, db):
    register(new_client(), email="dilnoza@gmail.com")
    params = _start(client)  # no consent needed: account exists
    _google(monkeypatch, nonce_from=params)
    r = client.get(f"/api/auth/google/callback?state={params['state']}&code=the-code", follow_redirects=False)
    assert r.headers["location"].endswith("#/conversation")
    assert len(db.execute(select(User)).scalars().all()) == 1


def test_google_new_account_without_consent(client, configured, monkeypatch):
    params = _start(client)
    _google(monkeypatch, nonce_from=params)
    r = client.get(f"/api/auth/google/callback?state={params['state']}&code=the-code", follow_redirects=False)
    assert r.headers["location"].endswith("#/register?error=consent_required")


@pytest.mark.parametrize("bad", [
    {"aud": "someone-else"},
    {"iss": "https://evil.example"},
    {"exp": time.time() - 10},
    {"email_verified": False},
    {"nonce": "wrong"},
])
def test_google_rejects_bad_id_token(client, configured, monkeypatch, bad):
    params = _start(client, consent=consent_ids(client)[0])
    _google(monkeypatch, claims_override=bad, nonce_from=params)
    r = client.get(f"/api/auth/google/callback?state={params['state']}&code=the-code", follow_redirects=False)
    assert r.headers["location"].endswith("#/signin?error=failed")


def test_google_rejects_wrong_state(client, configured, monkeypatch):
    params = _start(client, consent=consent_ids(client)[0])
    _google(monkeypatch, nonce_from=params)
    r = client.get("/api/auth/google/callback?state=forged&code=the-code", follow_redirects=False)
    assert r.headers["location"].endswith("#/signin?error=failed")
