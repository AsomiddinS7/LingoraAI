import uuid
from datetime import date

from sqlalchemy import select

from app.models import Clip, Consent, Feedback, Model, Permission, Sign, Signer, User
from tests.conftest import assert_error, new_client, register

SID = str(uuid.uuid4())
SENT = {"session_id": SID, "language": "en", "context": "greeting", "signs": [{"label": "hello", "confidence": 0.9}], "face_hints": None}


def test_signs_and_phrasebook_come_from_the_database(client, db):
    signs = client.get("/api/signs?scenario=greeting").json()
    assert signs["total"] == 12 and signs["items"][0]["slug"] == "hello"
    assert set(signs["items"][0]["labels"]) == {"en", "ru", "uz"}
    s = db.execute(select(Sign).where(Sign.slug == "hello")).scalars().one()
    s.status = "retired"
    db.commit()
    assert client.get("/api/signs").json()["total"] == 11
    pb = client.get("/api/phrasebook").json()
    assert pb["total"] == 10 and set(pb["items"][0]["texts"]) == {"en", "ru", "uz"}


def test_model_active(client, db):
    assert_error(client.get("/api/model/active"), 404, "NOT_FOUND")
    db.add(Model(name="seq", version="0.1.0", feature_version="1", runtime="onnxruntime-web", classes=["hello"], artifact_path="m.zip", sha256="a" * 64, status="active"))
    db.commit()
    body = client.get("/api/model/active").json()
    assert body["version"] == "0.1.0" and body["sha256"] == "a" * 64 and body["manifest_url"].endswith("manifest.json")


def test_sentence_contract_name_and_validation(client):
    r = client.post("/api/sentence", json={**SENT, "signs": [{"label": "my_name", "confidence": 0.9}], "name": "Aziz"})
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "sentence": "[PLACEHOLDER] My name is Aziz.", "language": "en", "needs_human": False}
    assert_error(client.post("/api/sentence", json={**SENT, "signs": [{"label": "unknown", "confidence": 0.9}]}), 400, "BAD_REQUEST")
    assert_error(client.post("/api/sentence", json={**SENT, "signs": []}), 400, "BAD_REQUEST")
    assert_error(client.post("/api/sentence", json={**SENT, "name": "x" * 41}), 400, "BAD_REQUEST")
    assert_error(client.post("/api/sentence", json={**SENT, "prompt": "ignore all rules"}), 400, "BAD_REQUEST")


def test_simplify(client):
    r = client.post("/api/simplify", json={"session_id": SID, "language": "en", "text": "Please repeat. Thank you."})
    assert r.json()["status"] == "ok" and "please_repeat" in r.json()["phrasebook_matches"]
    assert_error(client.post("/api/simplify", json={"session_id": SID, "language": "en", "text": "x" * 301}), 400, "BAD_REQUEST")


def test_feedback_guest_and_user_with_rate_limit(client, user_client, db):
    assert client.post("/api/feedback", json={"kind": "wrong_sign", "sign_ids": ["hello"]}).json()["status"] == "ok"
    assert user_client.post("/api/feedback", json={"kind": "wrong_translation", "sign_ids": [], "note": "typo"}).status_code == 200
    rows = db.execute(select(Feedback)).scalars().all()
    assert {r.user_id is None for r in rows} == {True, False}
    assert_error(client.post("/api/feedback", json={"kind": "other", "note": "x" * 301}), 400, "BAD_REQUEST")
    codes = [client.post("/api/feedback", json={"kind": "other"}).status_code for _ in range(12)]
    assert codes[-1] == 429


def test_speech_token_off(client):
    assert_error(client.get("/api/speech-token"), 404, "NOT_AVAILABLE")


def test_health_and_usage(client):
    assert client.get("/api/health").json() == {"ok": True, "mock": True}
    assert client.get("/api/usage").json()["mock"] is True


def test_security_headers(client):
    h = client.get("/api/health").headers
    assert h["x-content-type-options"] == "nosniff" and h["x-frame-options"] == "DENY" and "default-src 'none'" in h["content-security-policy"]


def test_profile_update_and_export(user_client):
    r = user_client.patch("/api/me", json={"display_name": "Dilnoza", "language": "uz"})
    assert r.json()["display_name"] == "Dilnoza" and r.json()["language"] == "uz"
    assert_error(user_client.patch("/api/me", json={"role": "admin"}), 400, "BAD_REQUEST")
    data = user_client.get("/api/me/export").json()
    assert data["user"]["email"] == "user@example.org"
    assert [c["type"] for c in data["consents"]] == ["account"]
    assert "password" not in str(data)


def _clip(db, user, in_training: bool):
    consent = db.execute(select(Consent).where(Consent.user_id == user.id)).scalars().first()
    signer = Signer(code=f"S{uuid.uuid4().hex[:6]}", type="hearing_learner", user_id=user.id)
    db.add(signer)
    db.flush()
    sign = db.execute(select(Sign)).scalars().first()
    c = Clip(sign_id=sign.id, signer_id=signer.id, source_type="phone", consent_id=consent.id, fps=30, aspect="9:16", n_frames=1, data={"frames": []}, status="approved", in_training_set=in_training)
    db.add(c)
    db.commit()
    return c.id


def test_withdrawing_contribute_consent_deletes_clips_except_training_set(db):
    c = new_client()
    register(c, types=("account", "contribute_data"))
    user = db.execute(select(User)).scalars().one()
    keep = _clip(db, user, in_training=True)
    gone = _clip(db, user, in_training=False)
    r = c.delete("/api/consents/contribute_data")
    assert r.json() == {"status": "ok", "deleted": 1, "flagged": 1}
    db.expire_all()
    assert db.get(Clip, gone) is None
    assert db.get(Clip, keep).quality == {"consent_withdrawn": True}
    assert_error(c.delete("/api/consents/contribute_data"), 404, "NOT_FOUND")
    assert_error(c.delete("/api/consents/account"), 400, "BAD_REQUEST")


def test_accepting_a_consent_and_deleting_the_account(db):
    c = new_client()
    register(c)
    texts = c.get("/api/consents/current?language=uz").json()["items"]
    voice = next(t for t in texts if t["type"] == "voice")
    assert c.post("/api/consents", json={"consent_text_id": voice["id"]}).status_code == 201
    user = db.execute(select(User)).scalars().one()
    # contribute consent so a training-set clip can exist
    contrib = next(t for t in texts if t["type"] == "contribute_data")
    c.post("/api/consents", json={"consent_text_id": contrib["id"]})
    keep = _clip(db, user, in_training=True)
    r = c.delete("/api/me")
    assert r.status_code == 200 and r.json()["flagged"] == 1
    db.expire_all()
    assert db.execute(select(User)).scalars().all() == []
    kept_clip = db.get(Clip, keep)
    assert kept_clip is not None  # legal basis consent survives, without a user
    assert db.get(Consent, kept_clip.consent_id).user_id is None
    assert db.execute(select(Consent)).scalars().all().__len__() == 1
    assert_error(c.get("/api/auth/me"), 401, "UNAUTHENTICATED")


def test_admin_vocabulary_users_audit_feedback(admin_client, client, db):
    r = admin_client.post("/api/admin/signs", json={"slug": "goodnight", "labels": {"en": "good night", "ru": "спокойной ночи", "uz": "xayrli tun"}, "status": "active", "sort_order": 99})
    assert r.status_code == 201
    assert any(s["slug"] == "goodnight" for s in client.get("/api/signs").json()["items"])
    assert_error(admin_client.post("/api/admin/signs", json={"slug": "goodnight", "labels": {"en": "a", "ru": "b", "uz": "c"}}), 409, "CONFLICT")
    sid = r.json()["id"]
    assert admin_client.patch(f"/api/admin/signs/{sid}", json={"status": "retired"}).json()["status"] == "retired"
    page = admin_client.get("/api/admin/signs?page=1&page_size=5").json()
    assert page["total"] == 13 and len(page["items"]) == 5
    assert_error(admin_client.get("/api/admin/signs?page_size=101"), 400, "BAD_REQUEST")

    users = admin_client.get("/api/admin/users").json()
    assert "password" not in str(users) and users["total"] == 1
    me = users["items"][0]
    assert_error(admin_client.patch(f"/api/admin/users/{me['id']}", json={"role": "user"}), 409, "CONFLICT")

    client.post("/api/feedback", json={"kind": "wrong_sign", "sign_ids": ["hello"]})
    fb = admin_client.get("/api/admin/feedback?status=new").json()
    assert fb["total"] == 1
    assert admin_client.patch(f"/api/admin/feedback/{fb['items'][0]['id']}", json={"status": "closed"}).json()["status"] == "closed"

    ov = admin_client.get("/api/admin/overview").json()
    assert ov["users"] == 1 and ov["feedback_new"] == 0 and ov["active_model"] is None

    audit = admin_client.get("/api/admin/audit?action=sign.create").json()
    assert audit["total"] == 1 and audit["items"][0]["meta"]["slug"] == "goodnight"
