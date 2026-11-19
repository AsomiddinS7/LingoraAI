"""Social sign-in (Google, Telegram): auth_identities; email and password become optional.

Revision ID: 0003
Revises: 0002
"""
import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("users", "email", existing_type=sa.String(254), nullable=True)
    op.alter_column("users", "password_hash", existing_type=sa.String(255), nullable=True)
    op.create_table(
        "auth_identities",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("subject", sa.String(255), nullable=False),
        sa.Column("email", sa.String(254), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("provider in ('google','telegram')", name=op.f("ck_auth_identities_provider")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_auth_identities_user_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_auth_identities")),
        sa.UniqueConstraint("provider", "subject", name="uq_auth_identities_provider_subject"),
    )
    op.create_index(op.f("ix_auth_identities_user_id"), "auth_identities", ["user_id"], unique=False)
    op.execute("alter table auth_identities enable row level security")
    op.execute(
        """
        do $$
        declare r text;
        begin
          foreach r in array array['anon', 'authenticated'] loop
            if exists (select 1 from pg_roles where rolname = r) then
              execute format('revoke all on auth_identities from %I', r);
            end if;
          end loop;
        end $$;
        """
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_auth_identities_user_id"), table_name="auth_identities")
    op.drop_table("auth_identities")
    op.alter_column("users", "password_hash", existing_type=sa.String(255), nullable=False)
    op.alter_column("users", "email", existing_type=sa.String(254), nullable=False)
