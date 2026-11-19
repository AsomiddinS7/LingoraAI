"""Lingora API (FastAPI). Run: uvicorn app.main:app"""
import mimetypes
from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from . import errors
from .config import get_settings
from .deps import csrf_guard
from .routers import admin, auth, me, public, social

mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("application/manifest+json", ".webmanifest")


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(
        title="Lingora API",
        version="1.0.0",
        dependencies=[Depends(csrf_guard)],
        docs_url="/api/docs" if s.env == "dev" else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if s.env == "dev" else None,
    )
    errors.install(app)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "X-CSRF-Token"],
        max_age=600,
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        path = request.url.path
        if path.startswith("/api"):
            response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
            response.headers["Cache-Control"] = "no-store"
        else:
            # The site itself (same origin as the API, so session cookies work).
            response.headers["Content-Security-Policy"] = SITE_CSP
            response.headers["Permissions-Policy"] = "camera=(self), microphone=(self), geolocation=()"
            long_lived = path.startswith(("/assets/", "/mediapipe/", "/model/"))
            response.headers["Cache-Control"] = "public, max-age=604800, immutable" if long_lived else "no-cache"
        if s.cookie_secure:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

    for r in (auth.router, social.router, me.router, public.router, admin.router):
        app.include_router(r)

    # Serve the built front end (dist/) when LINGORA_STATIC_DIR points at it (production image).
    static = Path(s.static_dir) if s.static_dir else None
    if static and (static / "index.html").exists():
        app.mount("/", StaticFiles(directory=static, html=True), name="site")
    return app


SITE_CSP = (
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' blob: data:; worker-src 'self' blob:; "
    "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
)


app = create_app()
