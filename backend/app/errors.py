"""One error shape for every failure: {"error": {"code", "message", "retry_after_s"?}} (section 6)."""
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

STATUS = {
    "BAD_REQUEST": 400,
    "UNAUTHENTICATED": 401,
    "FORBIDDEN": 403,
    "NOT_FOUND": 404,
    "NOT_AVAILABLE": 404,
    "CONFLICT": 409,
    "RATE_LIMITED": 429,
    "CAP_REACHED": 429,
    "UPSTREAM_ERROR": 502,
    "UPSTREAM_TIMEOUT": 504,
}


class ApiError(Exception):
    def __init__(self, code: str, message: str, retry_after_s: int | None = None, status: int | None = None):
        self.code = code
        self.message = message
        self.retry_after_s = retry_after_s
        self.status = status or STATUS.get(code, 400)


def body(code: str, message: str, retry_after_s: int | None = None) -> dict:
    e: dict = {"code": code, "message": message}
    if retry_after_s is not None:
        e["retry_after_s"] = retry_after_s
    return {"error": e}


def install(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api(_: Request, exc: ApiError):
        headers = {"Retry-After": str(exc.retry_after_s)} if exc.retry_after_s else None
        return JSONResponse(body(exc.code, exc.message, exc.retry_after_s), status_code=exc.status, headers=headers)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        # Never echo the input back (it may contain typed text or a password).
        first = exc.errors()[0] if exc.errors() else {}
        loc = ".".join(str(p) for p in first.get("loc", []) if p != "body")
        return JSONResponse(body("BAD_REQUEST", f"{loc}: {first.get('msg', 'invalid')}".strip(": ")), status_code=400)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException):
        code = {401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 429: "RATE_LIMITED"}.get(exc.status_code, "BAD_REQUEST")
        return JSONResponse(body(code, str(exc.detail)), status_code=exc.status_code)
