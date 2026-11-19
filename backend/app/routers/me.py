"""Profile, consents, data export and account deletion (sections 2.1, 6, 7)."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session as Db

from ..db import get_db
from ..deps import SESSION_COOKIE, audit, require
from ..errors import ApiError
from ..models import AuthIdentity, Clip, Consent, ConsentText, Feedback, Session, Signer, User, UserPhrase
from ..schemas import ConsentIn, MePatch
from .auth import me_body

router = APIRouter(prefix="/api", tags=["me"])
CONSENT_TYPES = ("account", "contribute_data", "voice")


@router.patch("/me")
def patch_me(body: MePatch, request: Request, db: Db = Depends(get_db), user: User = Depends(require("user"))):
    if body.display_name is not None:
        user.display_name = body.display_name
    if body.language is not None:
        user.language = body.language
    audit(db, request, user, "user.update", "user", user.id, {"fields": sorted(body.model_dump(exclude_none=True))})
    return me_body(user, request.state.session.id)


def _user_clips(db: Db, user: User):
    signer_ids = select(Signer.id).where(Signer.user_id == user.id)
    consent_ids = select(Consent.id).where(Consent.user_id == user.id)
    return select(Clip).where((Clip.signer_id.in_(signer_ids)) | (Clip.consent_id.in_(consent_ids)))


@router.get("/me/export")
def export_me(request: Request, db: Db = Depends(get_db), user: User = Depends(require("user"))):
    """Everything we hold about the user, as JSON (right of access)."""
    consents = db.execute(select(Consent, ConsentText).join(ConsentText).where(Consent.user_id == user.id)).all()
    clips = db.execute(_user_clips(db, user)).scalars().all()
    audit(db, request, user, "user.export", "user", user.id)
    return {
        "user": {k: v for k, v in me_body(user, None).items()} | {"created_at": user.created_at.isoformat()},
        "sign_in_methods": [i.provider for i in db.execute(select(AuthIdentity).where(AuthIdentity.user_id == user.id)).scalars()] + (["email"] if user.password_hash else []),
        "consents": [
            {"type": t.type, "version": t.version, "language": t.language, "accepted_at": c.accepted_at.isoformat(), "withdrawn_at": c.withdrawn_at.isoformat() if c.withdrawn_at else None}
            for c, t in consents
        ],
        "clips": [{"id": str(c.id), "sign_id": str(c.sign_id), "status": c.status, "n_frames": c.n_frames, "data": c.data, "created_at": c.created_at.isoformat()} for c in clips],
        "saved_phrases": [{"text": p.text, "language": p.language} for p in db.execute(select(UserPhrase).where(UserPhrase.user_id == user.id)).scalars()],
        "feedback": [{"kind": f.kind, "sign_ids": f.sign_ids, "note": f.note, "created_at": f.created_at.isoformat()} for f in db.execute(select(Feedback).where(Feedback.user_id == user.id)).scalars()],
    }


def _remove_clips(db: Db, user: User) -> dict:
    """Deletes the user's clips, except clips in an activated model's training set: those stay
    (anonymous signer pseudonym) and are flagged for the admin dashboard, as the consent text says."""
    deleted = flagged = 0
    for c in db.execute(_user_clips(db, user)).scalars().all():
        if c.in_training_set:
            q = dict(c.quality or {})
            q["consent_withdrawn"] = True
            c.quality = q
            flagged += 1
        else:
            db.delete(c)
            deleted += 1
    return {"deleted": deleted, "flagged": flagged}


@router.delete("/me")
def delete_me(request: Request, response: Response, db: Db = Depends(get_db), user: User = Depends(require("user"))):
    result = _remove_clips(db, user)
    audit(db, request, user, "user.delete", "user", user.id, result)
    db.execute(delete(Session).where(Session.user_id == user.id))
    db.flush()
    # Consents go too, except those that are the legal basis of a clip kept in a training set.
    kept = select(Clip.consent_id).where(Clip.consent_id.is_not(None))
    db.execute(delete(Consent).where(Consent.user_id == user.id, Consent.id.not_in(kept)))
    db.delete(user)  # user_phrases cascade; remaining consents keep user_id = NULL
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"status": "ok", **result}


# ---------------- consents ----------------
def _current_texts(db: Db, language: str | None):
    rows = db.execute(select(ConsentText).where(ConsentText.published_at.is_not(None)).order_by(ConsentText.type, ConsentText.version.desc())).scalars().all()
    latest: dict[tuple[str, str], ConsentText] = {}
    for t in rows:
        latest.setdefault((t.type, t.language), t)
    return [t for (_, lang), t in sorted(latest.items()) if language is None or lang == language]


@router.get("/consents/current")
def consents_current(language: str | None = Query(default=None, pattern="^(uz|ru|en)$"), db: Db = Depends(get_db)):
    items = [{"id": str(t.id), "type": t.type, "version": t.version, "language": t.language, "body": t.body} for t in _current_texts(db, language)]
    return {"items": items, "total": len(items)}


@router.post("/consents", status_code=201)
def accept_consent(body: ConsentIn, request: Request, db: Db = Depends(get_db), user: User = Depends(require("user"))):
    text = db.get(ConsentText, body.consent_text_id)
    if not text or not text.published_at or text not in _current_texts(db, text.language):
        raise ApiError("BAD_REQUEST", "Not a current consent text")
    active = db.execute(
        select(Consent).join(ConsentText).where(Consent.user_id == user.id, ConsentText.type == text.type, Consent.withdrawn_at.is_(None))
    ).scalars().first()
    if active and active.consent_text_id == text.id:
        return {"status": "ok", "id": str(active.id)}
    if active:
        active.withdrawn_at = datetime.now(timezone.utc)  # superseded by the new version
    c = Consent(user_id=user.id, consent_text_id=text.id)
    db.add(c)
    db.flush()
    audit(db, request, user, "consent.accept", "consent", c.id, {"type": text.type, "version": text.version})
    return {"status": "ok", "id": str(c.id)}


@router.delete("/consents/{ctype}")
def withdraw_consent(ctype: str, request: Request, db: Db = Depends(get_db), user: User = Depends(require("user"))):
    if ctype not in CONSENT_TYPES:
        raise ApiError("NOT_FOUND", "Unknown consent type")
    if ctype == "account":
        raise ApiError("BAD_REQUEST", "To withdraw the account consent, delete the account")
    active = db.execute(
        select(Consent).join(ConsentText).where(Consent.user_id == user.id, ConsentText.type == ctype, Consent.withdrawn_at.is_(None))
    ).scalars().all()
    if not active:
        raise ApiError("NOT_FOUND", "No active consent of this type")
    now = datetime.now(timezone.utc)
    for c in active:
        c.withdrawn_at = now
    result = _remove_clips(db, user) if ctype == "contribute_data" else {}
    audit(db, request, user, "consent.withdraw", "consent", None, {"type": ctype, **result})
    return {"status": "ok", **result}
