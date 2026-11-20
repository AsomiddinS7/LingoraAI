"""Settings from environment variables only. Secrets never live in code (section 7)."""
import os
from functools import lru_cache

from urllib.parse import quote

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="LINGORA_", extra="ignore")

    env: str = "dev"  # dev | test | staging | production
    # Supabase: Project settings -> Database -> Connection string (use the psycopg form, sslmode=require).
    database_url: str = "postgresql+psycopg://postgres@127.0.0.1:54329/lingora"
    # Origins allowed to call the API with cookies (comma separated). The site and API must be same-site
    # for SameSite=Lax session cookies to be sent (see README: deployment).
    allowed_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    secret_key: str = "dev-only-change-me"  # HMAC key for CSRF tokens and ip hashes
    cookie_secure: bool = False  # True in staging/production (HTTPS)
    session_ttl_hours: int = 24 * 14
    speech_enabled: bool = False
    static_dir: str = ""  # path to the built front end (dist/) to serve at "/"
    # Social sign-in (all optional; buttons appear only when configured).
    google_client_id: str = ""
    google_client_secret: str = ""
    telegram_bot_token: str = ""  # from @BotFather; its numeric prefix is the public bot id
    public_base_url: str = ""  # https://your-domain; defaults to RENDER_EXTERNAL_URL

    # Alternative to a full URL: only the password is secret; host/user come from render.yaml.
    # When LINGORA_DB_PASSWORD is set it wins over LINGORA_DATABASE_URL.
    db_password: str = ""
    db_host: str = ""
    db_user: str = ""
    db_port: int = 5432
    db_name: str = "postgres"

    @field_validator("db_password", "db_host", "db_user", "db_name", "secret_key", "allowed_origins", mode="before")
    @classmethod
    def _strip(cls, v: object) -> object:
        # Dashboard text boxes easily add a trailing newline or spaces.
        return v.strip() if isinstance(v, str) else v

    @field_validator("database_url", mode="before")
    @classmethod
    def _normalise_db_url(cls, v: object) -> object:
        # Pasted values often carry spaces/quotes or use the postgres:// scheme Supabase shows.
        if not isinstance(v, str):
            return v
        v = v.strip().strip('"').strip("'")
        for prefix in ("postgres://", "postgresql://"):
            if v.startswith(prefix):
                v = "postgresql+psycopg://" + v[len(prefix):]
        return v

    @model_validator(mode="after")
    def _build_db_url(self) -> "Settings":
        pw = self.db_password.strip()
        if pw:
            if not (self.db_host and self.db_user):
                raise ValueError("LINGORA_DB_PASSWORD is set but LINGORA_DB_HOST / LINGORA_DB_USER are missing")
            self.database_url = (
                f"postgresql+psycopg://{quote(self.db_user, safe='')}:{quote(pw, safe='')}"
                f"@{self.db_host}:{self.db_port}/{self.db_name}?sslmode=require"
            )
        v = self.database_url
        if not v.startswith("postgresql+psycopg://") or "\n" in v:
            raise ValueError("LINGORA_DATABASE_URL must be one line starting with postgresql:// (wrong text pasted?)")
        if "@" not in v or v.split("@", 1)[1].startswith(("/", ":")):
            raise ValueError("LINGORA_DATABASE_URL has no host after '@' (incomplete text pasted?)")
        return self

    @property
    def base_url(self) -> str:
        return (self.public_base_url or os.environ.get("RENDER_EXTERNAL_URL", "")).strip().rstrip("/")
    login_lock_failures: int = 10
    login_lock_minutes: int = 15

    @property
    def origins(self) -> list[str]:
        out = [o.strip().rstrip("/") for o in self.allowed_origins.split(",") if o.strip()]
        # Render sets RENDER_EXTERNAL_URL (https://<service>.onrender.com) on the running service.
        ext = os.environ.get("RENDER_EXTERNAL_URL", "").strip().rstrip("/")
        if ext and ext not in out:
            out.append(ext)
        return out


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.env in ("staging", "production"):
        if s.secret_key == "dev-only-change-me" or len(s.secret_key) < 32:
            raise RuntimeError("LINGORA_SECRET_KEY must be set to a long random value outside dev")
        if "@127.0.0.1" in s.database_url or "@localhost" in s.database_url:
            raise RuntimeError("LINGORA_DATABASE_URL is not set on the server (still the local dev default)")
        if not s.cookie_secure:
            raise RuntimeError("LINGORA_COOKIE_SECURE must be true outside dev (HTTPS only)")
    return s
