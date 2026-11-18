"""Admin API (section 6, build steps 3-4). Role admin; every call is audited."""
from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session as Db

from ..db import SessionLocal, get_db
from ..deps import audit, require
from ..errors import ApiError
from ..models import AuditLog, Clip, Feedback, Model, Sign, User
from ..schemas import AdminFeedbackPatch, AdminSignIn, AdminSignPatch, AdminUserPatch
from .public import sign_row


def _audit_every_call(request: Request, admin: User = Depends(require("admin"))) -> User:
    """Recorded in its own transaction, so the call stays in the audit log even if it then fails."""
    with SessionLocal() as own:
        audit(own, request, admin, f"admin.{request.method.lower()}", "endpoint", None, {"path": request.url.path})
        own.commit()
    return admin


router = APIRouter(prefix="/api/admin", tags=["admin"])
Admin = Depends(_audit_every_call)


def page_params(page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100)) -> tuple[int, int]:
    return page, page_size


def paged(db: Db, q, page: tuple[int, int], row):
    total = db.execute(select(func.count()).select_from(q.order_by(None).subquery())).scalar_one()
    p, size = page
    items = [row(x) for x in db.execute(q.limit(size).offset((p - 1) * size)).scalars()]
    return {"items": items, "total": total}


def user_row(u: User) -> dict:
    # Never returns password data.
    return {"id": str(u.id), "email": u.email, "display_name": u.display_name, "language": u.language, "role": u.role, "is_active": u.is_active, "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None, "created_at": u.created_at.isoformat()}


@router.get("/overview")
def overview(db: Db = Depends(get_db), _: User = Admin):
    clips = dict(db.execute(select(Clip.status, func.count()).group_by(Clip.status)).all())
    per_sign = dict(db.execute(select(Sign.slug, func.count(Clip.id)).join(Clip, Clip.sign_id == Sign.id, isouter=True).where((Clip.status == "approved") | (Clip.id.is_(None))).group_by(Sign.slug)).all())
    active = db.execute(select(Model).where(Model.status == "active")).scalars().first()
    return {
        "users": db.execute(select(func.count(User.id))).scalar_one(),
        "clips": {s: clips.get(s, 0) for s in ("pending", "approved", "rejected")},
        "approved_per_sign": per_sign,
        "signs": db.execute(select(func.count(Sign.id))).scalar_one(),
        "active_model": {"id": str(active.id), "name": active.name, "version": active.version, "metrics": active.metrics} if active else None,
        "feedback_new": db.execute(select(func.count(Feedback.id)).where(Feedback.status == "new")).scalar_one(),
    }


# ---------------- vocabulary ----------------
@router.get("/signs")
def list_signs(scenario: str | None = None, status: str | None = None, page=Depends(page_params), db: Db = Depends(get_db), _: User = Admin):
    q = select(Sign).order_by(Sign.sort_order, Sign.slug)
    if scenario:
        q = q.where(Sign.scenario == scenario)
    if status:
        q = q.where(Sign.status == status)
    return paged(db, q, page, sign_row)


@router.post("/signs", status_code=201)
def create_sign(body: AdminSignIn, request: Request, db: Db = Depends(get_db), admin: User = Admin):
    if db.execute(select(Sign.id).where(Sign.slug == body.slug)).first():
        raise ApiError("CONFLICT", "A sign with this slug exists")
    s = Sign(slug=body.slug, labels=body.labels.model_dump(), scenario=body.scenario, status=body.status, sort_order=body.sort_order)
    db.add(s)
    db.flush()
    audit(db, request, admin, "sign.create", "sign", s.id, {"slug": s.slug, "status": s.status})
    return sign_row(s)


@router.patch("/signs/{sign_id}")
def update_sign(sign_id: uuid.UUID, body: AdminSignPatch, request: Request, db: Db = Depends(get_db), admin: User = Admin):
    s = db.get(Sign, sign_id)
    if not s:
        raise ApiError("NOT_FOUND", "Sign not found")
    changes = body.model_dump(exclude_none=True)
    if "labels" in changes:
        s.labels = body.labels.model_dump()  # type: ignore[union-attr]
    for k in ("scenario", "status", "sort_order"):
        if k in changes:
            setattr(s, k, changes[k])
    audit(db, request, admin, "sign.update", "sign", s.id, {"fields": sorted(changes)})
    return sign_row(s)


# ---------------- users ----------------
@router.get("/users")
def list_users(q: str | None = Query(None, max_length=100), page=Depends(page_params), db: Db = Depends(get_db), _: User = Admin):
    stmt = select(User).order_by(User.created_at.desc())
    if q:
        stmt = stmt.where(User.email.ilike(f"%{q.lower()}%") | User.display_name.ilike(f"%{q}%"))
    return paged(db, stmt, page, user_row)


@router.patch("/users/{user_id}")
def update_user(user_id: uuid.UUID, body: AdminUserPatch, request: Request, db: Db = Depends(get_db), admin: User = Admin):
    u = db.get(User, user_id)
    if not u:
        raise ApiError("NOT_FOUND", "User not found")
    if u.id == admin.id and (body.role == "user" or body.is_active is False):
        raise ApiError("CONFLICT", "Admins cannot demote or disable themselves")
    changes = body.model_dump(exclude_none=True)
    for k, v in changes.items():
        setattr(u, k, v)
    audit(db, request, admin, "user.admin_update", "user", u.id, changes)
    return user_row(u)


# ---------------- audit (read only) ----------------
@router.get("/audit")
def list_audit(
    actor: uuid.UUID | None = None,
    action: str | None = Query(None, max_length=60),
    since: datetime | None = None,
    until: datetime | None = None,
    page=Depends(page_params),
    db: Db = Depends(get_db),
    _: User = Admin,
):
    q = select(AuditLog).order_by(AuditLog.created_at.desc())
    if actor:
        q = q.where(AuditLog.actor_id == actor)
    if action:
        q = q.where(AuditLog.action == action)
    if since:
        q = q.where(AuditLog.created_at >= since)
    if until:
        q = q.where(AuditLog.created_at <= until)
    return paged(db, q, page, lambda a: {"id": str(a.id), "actor_id": str(a.actor_id) if a.actor_id else None, "action": a.action, "target_type": a.target_type, "target_id": a.target_id, "meta": a.meta, "created_at": a.created_at.isoformat()})


# ---------------- feedback queue ----------------
@router.get("/feedback")
def list_feedback(status: str | None = Query(None, pattern="^(new|reviewed|closed)$"), page=Depends(page_params), db: Db = Depends(get_db), _: User = Admin):
    q = select(Feedback).order_by(Feedback.created_at.desc())
    if status:
        q = q.where(Feedback.status == status)
    return paged(db, q, page, lambda f: {"id": str(f.id), "kind": f.kind, "sign_ids": f.sign_ids, "model_id": str(f.model_id) if f.model_id else None, "note": f.note, "status": f.status, "created_at": f.created_at.isoformat()})


@router.patch("/feedback/{feedback_id}")
def update_feedback(feedback_id: uuid.UUID, body: AdminFeedbackPatch, request: Request, db: Db = Depends(get_db), admin: User = Admin):
    f = db.get(Feedback, feedback_id)
    if not f:
        raise ApiError("NOT_FOUND", "Feedback not found")
    f.status = body.status
    audit(db, request, admin, "feedback.update", "feedback", f.id, {"status": f.status})
    return {"id": str(f.id), "status": f.status}
