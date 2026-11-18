"""Every admin endpoint as guest (401), as user (403) and as admin (not 401/403). Section 7."""
import uuid

import pytest
from fastapi.routing import APIRoute
from sqlalchemy import select

from app.main import app
from app.models import AuditLog
from tests.conftest import assert_error

ADMIN_ROUTES = sorted(
    {(m, r.path) for r in app.routes if isinstance(r, APIRoute) and r.path.startswith("/api/admin") for m in r.methods},
)


def call(client, method: str, path: str):
    url = path.replace("{sign_id}", str(uuid.uuid4())).replace("{user_id}", str(uuid.uuid4())).replace("{feedback_id}", str(uuid.uuid4()))
    return client.request(method, url, json={} if method in ("POST", "PATCH") else None)


def test_there_are_admin_routes():
    assert len(ADMIN_ROUTES) >= 9


@pytest.mark.parametrize("method,path", ADMIN_ROUTES)
def test_guest_gets_401(client, method, path):
    assert_error(call(client, method, path), 401, "UNAUTHENTICATED")


@pytest.mark.parametrize("method,path", ADMIN_ROUTES)
def test_user_gets_403(user_client, method, path):
    assert_error(call(user_client, method, path), 403, "FORBIDDEN")


@pytest.mark.parametrize("method,path", ADMIN_ROUTES)
def test_admin_passes_the_role_check_and_is_audited(admin_client, db, method, path):
    r = call(admin_client, method, path)
    assert r.status_code not in (401, 403), r.text
    actions = db.execute(select(AuditLog.action)).scalars().all()
    assert f"admin.{method.lower()}" in actions
