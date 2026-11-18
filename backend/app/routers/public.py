"""Endpoints for everyone (guest or signed in): signs, phrasebook, active model, feedback,
sentence/simplify (existing contract), speech token, health, usage."""
from __future__ import annotations

import threading

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session as Db

from ..config import get_settings
from ..db import get_db
from ..deps import client_ip, require
from ..errors import ApiError
from ..models import Feedback, Model, Phrase, Sign, User
from ..schemas import FeedbackIn, SentenceIn, SimplifyIn
from ..security import limiter
from ..sentence import provider

router = APIRouter(prefix="/api", tags=["public"])

_calls = {"total": 0}
_calls_lock = threading.Lock()


def sign_row(s: Sign) -> dict:
    return {"id": str(s.id), "slug": s.slug, "labels": s.labels, "scenario": s.scenario, "status": s.status, "sort_order": s.sort_order, "reference_clip_id": str(s.reference_clip_id) if s.reference_clip_id else None}


@router.get("/signs")
def signs(scenario: str | None = Query(default=None, max_length=40), db: Db = Depends(get_db)):
    q = select(Sign).where(Sign.status == "active").order_by(Sign.sort_order, Sign.slug)
    if scenario:
        q = q.where(Sign.scenario == scenario)
    items = [sign_row(s) for s in db.execute(q).scalars()]
    return {"items": items, "total": len(items)}


@router.get("/phrasebook")
def phrasebook(db: Db = Depends(get_db)):
    items = [{"id": str(p.id), "slug": p.slug, "texts": p.texts, "audio_path": p.audio_path} for p in db.execute(select(Phrase).order_by(Phrase.sort_order, Phrase.slug)).scalars()]
    return {"items": items, "total": len(items)}


@router.get("/model/active")
def model_active(db: Db = Depends(get_db)):
    m = db.execute(select(Model).where(Model.status == "active")).scalars().first()
    if not m:
        raise ApiError("NOT_FOUND", "No active model")
    return {"manifest_url": f"/api/models/{m.id}/files/manifest.json", "version": m.version, "sha256": m.sha256}


@router.post("/feedback")
def feedback(body: FeedbackIn, request: Request, db: Db = Depends(get_db), user: User | None = Depends(require("any"))):
    wait = limiter.hit(f"feedback:ip:{client_ip(request)}", 10, 60)
    if wait is not None:
        raise ApiError("RATE_LIMITED", "Too many feedback reports", retry_after_s=wait)
    f = Feedback(user_id=user.id if user else None, kind=body.kind, sign_ids=body.sign_ids, model_id=body.model_id, note=body.note)
    db.add(f)
    db.flush()
    return {"status": "ok", "id": str(f.id)}


def _count() -> None:
    with _calls_lock:
        _calls["total"] += 1


@router.post("/sentence")
def sentence(body: SentenceIn, db: Db = Depends(get_db)):
    active = {s for (s,) in db.execute(select(Sign.slug).where(Sign.status == "active"))}
    if any(s.label not in active for s in body.signs):
        raise ApiError("BAD_REQUEST", "every label must be in the vocabulary")
    _count()
    return provider().compose(body, {s.slug: s.labels for s in db.execute(select(Sign)).scalars()})


@router.post("/simplify")
def simplify(body: SimplifyIn, db: Db = Depends(get_db)):
    _count()
    return provider().simplify(body, [(p.slug, p.texts) for p in db.execute(select(Phrase)).scalars()])


@router.get("/speech-token")
def speech_token():
    if not get_settings().speech_enabled:
        raise ApiError("NOT_AVAILABLE", "Speech is off")
    # TODO(ML team): exchange the Azure Speech key for a short-lived token here (Plan A).
    raise ApiError("UPSTREAM_ERROR", "Speech token provider is not configured")


@router.get("/health")
def health(db: Db = Depends(get_db)):
    db.execute(select(1))
    return {"ok": True, "mock": provider().is_placeholder}


@router.get("/usage")
def usage():
    return {"calls_session": 0, "calls_total": _calls["total"], "cap": 0, "mock": provider().is_placeholder}
