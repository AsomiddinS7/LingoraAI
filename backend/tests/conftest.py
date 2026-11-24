"""Tests run against a real PostgreSQL test database (CHECK constraints, JSONB and triggers are
PostgreSQL features). Set LINGORA_TEST_DATABASE_URL to point elsewhere."""
import os

os.environ["LINGORA_DATABASE_URL"] = os.environ.get("LINGORA_TEST_DATABASE_URL", "postgresql+psycopg://postgres@127.0.0.1:54329/lingora_test")
os.environ["LINGORA_ENV"] = "test"
os.environ["LINGORA_ALLOWED_ORIGINS"] = "http://localhost:5173"

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base, User  # noqa: E402
from app.security import hash_password, limiter  # noqa: E402
from scripts.seed import seed  # noqa: E402

ORIGIN = "http://localhost:5173"
PASSWORD = "correct horse battery"


@pytest.fixture(scope="session", autouse=True)
def schema():
    name = engine.url.database or ''
    if not (name.endswith('_test') or name.startswith('lingora_test_')):
        raise RuntimeError('Refusing schema reset outside a dedicated test database')
    with engine.begin() as c:
        c.execute(text("drop schema public cascade; create schema public;"))
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "migrations"))
    command.upgrade(cfg, "head")
    yield


@pytest.fixture(autouse=True)
def clean():
    tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
    with engine.begin() as c:
        c.execute(text(f"truncate {tables} restart identity cascade"))
    with SessionLocal() as db:
        seed(db)
        db.commit()
    limiter.reset()
    yield


@pytest.fixture
def db():
    with SessionLocal() as s:
        yield s


def new_client() -> TestClient:
    return TestClient(app, base_url="http://testserver", headers={"origin": ORIGIN})


@pytest.fixture
def client():
    return new_client()


def consent_ids(client, types=("account",)) -> list[str]:
    items = client.get("/api/consents/current?language=en").json()["items"]
    return [i["id"] for i in items if i["type"] in types]


def register(client, email="user@example.org", password=PASSWORD, name="Aziz", types=("account",)):
    r = client.post("/api/auth/register", json={"email": email, "password": password, "display_name": name, "language": "en", "consent_ids": consent_ids(client, types)})
    if r.status_code == 201:
        client.headers["x-csrf-token"] = r.json()["csrf_token"]
    return r


def make_admin(email="admin@example.org") -> None:
    with SessionLocal() as db:
        db.add(User(email=email, password_hash=hash_password(PASSWORD), display_name="Admin", language="en", role="admin"))
        db.commit()


def login(client, email, password=PASSWORD):
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    if r.status_code == 200:
        client.headers["x-csrf-token"] = r.json()["csrf_token"]
    return r


@pytest.fixture
def user_client():
    c = new_client()
    assert register(c).status_code == 201
    return c


@pytest.fixture
def admin_client():
    make_admin()
    c = new_client()
    assert login(c, "admin@example.org").status_code == 200
    return c


def assert_error(r, status: int, code: str):
    assert r.status_code == status, r.text
    body = r.json()
    assert set(body) == {"error"}
    assert body["error"]["code"] == code
    assert isinstance(body["error"]["message"], str)
