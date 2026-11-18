"""Enable Row Level Security on every table (no policies).

Supabase exposes the public schema through its REST Data API (anon/authenticated roles).
Lingora never uses that API: all access goes through the FastAPI backend, which connects as
the table owner and is therefore not affected by RLS. With RLS on and no policies, the Data API
cannot read or write any Lingora table. On plain PostgreSQL this is harmless.

Revision ID: 0002
Revises: 0001
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

TABLES = [
    "users", "sessions", "consent_texts", "consents", "signs", "signers", "permissions", "clips",
    "models", "evaluations", "feedback", "phrases", "user_phrases", "audit_log",
]


def upgrade() -> None:
    for t in TABLES:
        op.execute(f"alter table {t} enable row level security")
    # Supabase roles exist only on Supabase; revoke their table access where they exist.
    op.execute(
        """
        do $$
        declare r text;
        begin
          foreach r in array array['anon', 'authenticated'] loop
            if exists (select 1 from pg_roles where rolname = r) then
              execute format('revoke all on all tables in schema public from %I', r);
              execute format('revoke all on all sequences in schema public from %I', r);
            end if;
          end loop;
        end $$;
        """
    )


def downgrade() -> None:
    for t in TABLES:
        op.execute(f"alter table {t} disable row level security")
