"""Bearer sessions for a cross-site static front end (GitHub Pages calling the API on Render)."""
from fastapi.testclient import TestClient

from app.main import app

from .conftest import ORIGIN, PASSWORD, consent_ids


def bearer_client() -> TestClient:
    return TestClient(app, base_url="http://testserver", headers={"origin": ORIGIN, "x-lingora-auth": "bearer"})


def test_bearer_register_returns_token_and_sets_no_cookie():
    c = bearer_client()
    r = c.post("/api/auth/register", json={"email": "b@example.org", "password": PASSWORD, "display_name": "B", "language": "uz", "consent_ids": consent_ids(c)})
    assert r.status_code == 201
    token = r.json()["token"]
    assert len(token) > 20
    assert "set-cookie" not in r.headers

    me = c.get("/api/auth/me", headers={"authorization": f"Bearer {token}"})
    assert me.status_code == 200 and me.json()["email"] == "b@example.org"
    assert "token" not in me.json()


def test_bearer_login_logout_and_no_csrf_needed():
    c = bearer_client()
    c.post("/api/auth/register", json={"email": "c@example.org", "password": PASSWORD, "display_name": "C", "language": "en", "consent_ids": consent_ids(c)})
    token = c.post("/api/auth/login", json={"email": "c@example.org", "password": PASSWORD}).json()["token"]
    auth = {"authorization": f"Bearer {token}"}
    # Unsafe call with a bearer session works without a CSRF token.
    assert c.post("/api/auth/logout", headers=auth).status_code == 200
    assert c.get("/api/auth/me", headers=auth).status_code == 401


def test_cookie_clients_do_not_get_the_token(client):
    r = client.post("/api/auth/register", json={"email": "d@example.org", "password": PASSWORD, "display_name": "D", "language": "en", "consent_ids": consent_ids(client)})
    assert r.status_code == 201 and "token" not in r.json()


def test_wrong_bearer_token_is_signed_out():
    c = bearer_client()
    assert c.get("/api/auth/me", headers={"authorization": "Bearer nope"}).status_code == 401


def test_cors_allows_bearer_headers_from_allowed_origin():
    c = bearer_client()
    r = c.options("/api/auth/login", headers={"access-control-request-method": "POST", "access-control-request-headers": "authorization,x-lingora-auth,content-type"})
    assert r.status_code == 200
    allowed = r.headers["access-control-allow-headers"].lower()
    assert "authorization" in allowed and "x-lingora-auth" in allowed
