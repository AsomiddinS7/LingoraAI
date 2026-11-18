from sqlalchemy import select

from app.models import AuditLog, Session, User
from tests.conftest import PASSWORD, assert_error, consent_ids, login, new_client, register


def test_register_sets_httponly_lax_cookie_and_returns_profile(client, db):
    r = register(client)
    assert r.status_code == 201
    body = r.json()
    assert body["email"] == "user@example.org" and body["role"] == "user" and body["csrf_token"]
    assert "password" not in r.text and "hash" not in r.text
    cookie = r.headers["set-cookie"].lower()
    assert "lingora_session=" in cookie and "httponly" in cookie and "samesite=lax" in cookie
    u = db.execute(select(User)).scalars().one()
    assert u.password_hash.startswith("$argon2id$")
    # the cookie token is not stored: only its SHA-256
    token = client.cookies.get("lingora_session")
    assert db.get(Session, token) is None
    assert db.execute(select(AuditLog.action)).scalars().all() == ["user.register"]


def test_register_requires_account_consent(client):
    r = client.post("/api/auth/register", json={"email": "a@example.org", "password": PASSWORD, "display_name": "A", "language": "en", "consent_ids": []})
    assert_error(r, 400, "BAD_REQUEST")


def test_register_password_rules(client):
    assert_error(register(client, password="short"), 400, "BAD_REQUEST")
    assert_error(register(client, password="1234567890"), 400, "BAD_REQUEST")
    assert_error(register(client, password="Password123"), 400, "BAD_REQUEST")


def test_register_duplicate_email_is_conflict_and_email_is_lowercased(client):
    assert register(client, email="Mixed@Example.org").status_code == 201
    assert register(new_client(), email="mixed@example.org").status_code == 409


def test_register_rejects_extra_fields(client):
    r = client.post("/api/auth/register", json={"email": "a@example.org", "password": PASSWORD, "display_name": "A", "consent_ids": consent_ids(client), "role": "admin"})
    assert_error(r, 400, "BAD_REQUEST")


def test_login_same_message_for_wrong_email_and_wrong_password(client):
    register(new_client())
    a = client.post("/api/auth/login", json={"email": "nobody@example.org", "password": PASSWORD})
    b = client.post("/api/auth/login", json={"email": "user@example.org", "password": "wrong password!"})
    assert_error(a, 401, "UNAUTHENTICATED")
    assert_error(b, 401, "UNAUTHENTICATED")
    assert a.json()["error"]["message"] == b.json()["error"]["message"]


def test_lockout_after_ten_failures(client):
    register(new_client())
    for _ in range(10):
        assert client.post("/api/auth/login", json={"email": "user@example.org", "password": "wrong password!"}).status_code == 401
    r = client.post("/api/auth/login", json={"email": "user@example.org", "password": PASSWORD})
    assert_error(r, 429, "RATE_LIMITED")
    assert 800 < r.json()["error"]["retry_after_s"] <= 901


def test_login_rate_limited_per_email():
    register(new_client())
    c = new_client()
    codes = [c.post("/api/auth/login", json={"email": "user@example.org", "password": "x"}).status_code for _ in range(25)]
    assert 429 in codes


def test_me_logout(client):
    assert_error(client.get("/api/auth/me"), 401, "UNAUTHENTICATED")
    register(client)
    assert client.get("/api/auth/me").json()["display_name"] == "Aziz"
    assert client.post("/api/auth/logout").status_code == 200
    assert_error(client.get("/api/auth/me"), 401, "UNAUTHENTICATED")


def test_disabled_user_cannot_log_in(client, db):
    register(new_client())
    u = db.execute(select(User)).scalars().one()
    u.is_active = False
    db.commit()
    assert_error(login(client, "user@example.org"), 401, "UNAUTHENTICATED")


def test_csrf_token_required_on_unsafe_methods_with_a_session(user_client):
    token = user_client.headers.pop("x-csrf-token")
    assert_error(user_client.patch("/api/me", json={"language": "ru"}), 403, "FORBIDDEN")
    user_client.headers["x-csrf-token"] = "forged"
    assert_error(user_client.patch("/api/me", json={"language": "ru"}), 403, "FORBIDDEN")
    user_client.headers["x-csrf-token"] = token
    assert user_client.patch("/api/me", json={"language": "ru"}).status_code == 200


def test_foreign_origin_is_rejected(client):
    r = client.post("/api/auth/login", json={"email": "a@example.org", "password": "x"}, headers={"origin": "https://evil.example"})
    assert_error(r, 403, "FORBIDDEN")
