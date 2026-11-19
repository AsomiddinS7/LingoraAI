"""Settings from environment variables only. Secrets never live in code (section 7)."""
import os
from functools import lru_cache

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
        if not s.cookie_secure:
            raise RuntimeError("LINGORA_COOKIE_SECURE must be true outside dev (HTTPS only)")
    return s
