"""Lingora API (FastAPI). Run: uvicorn app.main:app"""
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from . import errors
from .config import get_settings
from .deps import csrf_guard
from .routers import admin, auth, me, public


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
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        response.headers["Cache-Control"] = "no-store"
        if s.cookie_secure:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

    for r in (auth.router, me.router, public.router, admin.router):
        app.include_router(r)
    return app


app = create_app()
