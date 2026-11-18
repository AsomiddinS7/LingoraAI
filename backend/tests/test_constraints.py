"""Database rules the database itself must enforce (sections 5 and 12)."""
from datetime import date

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.models import AuditLog, Clip, Model, Permission, Sign, Signer, User

FRAMES = {"frames": [{"t": 0, "pose": None, "L": None, "R": [[0.1, 0.2, 0.0]] * 21}]}


def _sign_and_signer(db):
    sign = db.execute(select(Sign)).scalars().first()
    signer = Signer(code="S01", type="instructor_video")
    db.add(signer)
    db.flush()
    return sign, signer


def test_clip_without_consent_and_without_permission_is_rejected(db):
    sign, signer = _sign_and_signer(db)
    db.add(Clip(sign_id=sign.id, signer_id=signer.id, source_type="phone", fps=30, aspect="16:9", n_frames=1, data=FRAMES))
    with pytest.raises(IntegrityError) as e:
        db.flush()
    assert "ck_clips_consent_or_permission" in str(e.value)


def test_clip_with_permission_is_accepted(db):
    sign, signer = _sign_and_signer(db)
    perm = Permission(owner_name="[PLACEHOLDER] Instructor", source_url="https://example.org/video", license="written permission", evidence_note="email on file", granted_on=date(2026, 11, 1), scope="training")
    db.add(perm)
    db.flush()
    db.add(Clip(sign_id=sign.id, signer_id=signer.id, source_type="instructor_video", permission_id=perm.id, fps=30, aspect="16:9", n_frames=1, data=FRAMES))
    db.flush()


def test_clip_frame_limit(db):
    sign, signer = _sign_and_signer(db)
    perm = Permission(owner_name="x", source_url="x", license="x", evidence_note="x", granted_on=date(2026, 1, 1), scope="x")
    db.add(perm)
    db.flush()
    db.add(Clip(sign_id=sign.id, signer_id=signer.id, source_type="instructor_video", permission_id=perm.id, fps=30, aspect="16:9", n_frames=121, data=FRAMES))
    with pytest.raises(IntegrityError):
        db.flush()


def test_email_must_be_lowercase(db):
    db.add(User(email="Upper@Example.org", password_hash="x", display_name="U", language="en", role="user"))
    with pytest.raises(IntegrityError):
        db.flush()


def test_role_and_language_are_checked(db):
    db.add(User(email="a@example.org", password_hash="x", display_name="U", language="de", role="user"))
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()
    db.add(User(email="b@example.org", password_hash="x", display_name="U", language="en", role="root"))
    with pytest.raises(IntegrityError):
        db.flush()


def test_only_one_active_model(db):
    for v in ("1", "2"):
        db.add(Model(name="seq", version=v, feature_version="1", runtime="onnxruntime-web", classes=["hello"], artifact_path=f"m/{v}.zip", sha256="0" * 64, status="active"))
    with pytest.raises(IntegrityError):
        db.flush()


def test_audit_log_is_append_only(db):
    db.add(AuditLog(action="test.event"))
    db.commit()
    with pytest.raises(DBAPIError):
        db.execute(text("update audit_log set action = 'changed'"))
    db.rollback()
    with pytest.raises(DBAPIError):
        db.execute(text("delete from audit_log"))
    db.rollback()
    assert db.execute(select(AuditLog.action)).scalars().all() == ["test.event"]


def test_sign_labels_need_three_languages(db):
    db.add(Sign(slug="bad", labels={"en": "x"}, scenario="greeting", status="draft"))
    with pytest.raises(IntegrityError):
        db.flush()
