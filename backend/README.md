# Lingora API (FastAPI + PostgreSQL)

The v1 backend (*Lingora Platform v1*, build steps 1, 3 and 4):
- **Foundations:** database, migrations, auth, roles, consent texts, audit log.
- **Data:** signs and phrasebook come from the database, plus feedback.
- **Admin API:** overview, vocabulary, users, audit, feedback queue.

The front end in `../src` talks to it through the same `/api` contract it already uses with its mock server.

## What it does

| Area | Implementation |
|---|---|
| Passwords | argon2id (`argon2-cffi`). At least 10 characters, checked against a common-password list. Never logged or returned. |
| Sessions | A random token is stored in an `httpOnly; SameSite=Lax` cookie (`Secure` outside dev). The database keeps only its SHA-256. |
| CSRF | Unsafe methods get an Origin check. When a session cookie is present, an `X-CSRF-Token` header is also required (an HMAC of the session, returned by `/api/auth/login`, `/register` and `/me`). |
| Login protection | Rate limits per IP and per email; the same message for a wrong email or a wrong password; a 15-minute lock after 10 failures. |
| Roles | One shared dependency, `require("any" \| "user" \| "admin")`. Signed out gives 401, too low a role gives 403. Admins are created only by `scripts/create_admin.py`. |
| Audit | `audit_log` is append-only: a database trigger rejects UPDATE and DELETE. Every admin call is audited. Entries never contain bodies, typed text or landmarks. |
| Consents | Versioned texts in uz, ru and en; accepting one stores the exact version. Withdrawing `contribute_data` deletes the user's clips, except clips in an activated model's training set, which are kept and flagged. |
| Account | Users can export all their data (`GET /api/me/export`) and delete their account and data (`DELETE /api/me`). |
| Database rules | CHECK constraints: a clip needs a consent or a permission; at most 120 frames; lowercase emails; allowed roles and languages; labels in 3 languages. A partial unique index allows only one active model. |
| Errors | Always `{"error": {"code", "message", "retry_after_s"?}}`. Request bodies are validated by Pydantic with extra fields forbidden. |
| Sentence / simplify | A placeholder provider follows the existing contract and marks its output `[PLACEHOLDER]`. The ML team plugs in Azure OpenAI with `app.sentence.set_provider(...)`. |

**Not yet:** clip upload and review, permissions, export, the model registry and file storage (build steps 5–6), email verification and password reset (open decision), and admin TOTP.

## Run locally

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt
cp .env.example .env
.venv/Scripts/python -m alembic upgrade head
.venv/Scripts/python -m scripts.seed
.venv/Scripts/python -m scripts.create_admin --email you@example.org --name "Your name"
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
.venv/Scripts/python -m pytest
```

On this Windows PC the dev database is the embedded PostgreSQL 16 in `C:\Users\abdul\lingora-local`, on port 54329. Its program files had to be outside the Cyrillic "Рабочий стол" path, and it is initialised with `--no-locale`. Start it with:

```bash
C:/Users/abdul/lingora-local/pg/bin/pg_ctl -D C:/Users/abdul/lingora-local/pgdata -o "-p 54329 -c listen_addresses=127.0.0.1" -l C:/Users/abdul/lingora-local/pg.log start
```

## Supabase (production database)

1. Create a free project at https://supabase.com/dashboard. Choose a region close to your users and save the database password in your password manager.
2. Go to **Project settings → Database → Connection string**, choose **Session pooler**, and copy the URI.
3. In `backend/.env` (never committed), set `LINGORA_DATABASE_URL=postgresql+psycopg://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require`.
4. Run `alembic upgrade head`, then `python -m scripts.seed`, then `python -m scripts.create_admin ...`.
5. In Supabase, **Data API** is not used by Lingora; turn it off, or leave RLS enabled with no policies, so tables are not reachable through Supabase's public REST endpoint.

## Deployment note: same site

Session cookies are `SameSite=Lax`, so the site and the API must be on the **same site**. For example, serve the built front end and `/api` from one host, or use `app.example.uz` with `api.example.uz`. A GitHub Pages site (`*.github.io`) cannot send these cookies to an API on another domain. Choosing the API host is the next decision.
