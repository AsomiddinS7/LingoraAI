"""Passwords (argon2id), session tokens (hashed in storage), CSRF tokens, ip hashing, rate limits."""
from __future__ import annotations

import hashlib
import hmac
import secrets
import threading
import time
from collections import defaultdict, deque

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from .config import get_settings

_ph = PasswordHasher()  # argon2id with library defaults (memory-hard)

# A short list of very common passwords (section 7). Lower-cased comparison.
COMMON_PASSWORDS = {
    "1234567890", "12345678910", "0123456789", "qwertyuiop", "password12", "password123", "password1234",
    "1q2w3e4r5t", "qwerty1234", "qwerty12345", "iloveyou12", "letmein123", "welcome123", "admin12345",
    "abcdefghij", "abc1234567", "1111111111", "0000000000", "1234512345", "passw0rd12", "football12",
    "monkey1234", "dragon1234", "sunshine12", "princess12", "parol12345", "parol123456", "uzbekistan",
    "tashkent123", "toshkent123", "qwerty123456", "zxcvbnm123", "asdfghjkl1", "1qaz2wsx3edc", "lingora123",
}


def password_problem(pw: str, email: str = "") -> str | None:
    if len(pw) < 10:
        return "Password must be at least 10 characters"
    if len(pw) > 200:
        return "Password is too long"
    low = pw.lower()
    if low in COMMON_PASSWORDS or (email and low == email.lower()):
        return "This password is too common"
    return None


def hash_password(pw: str) -> str:
    return _ph.hash(pw)


def verify_password(stored: str, pw: str) -> bool:
    try:
        return _ph.verify(stored, pw)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


# Constant-time dummy verification so "unknown email" takes as long as "wrong password".
_DUMMY = _ph.hash("not-a-real-password-for-timing")


def dummy_verify() -> None:
    verify_password(_DUMMY, "x")


def new_session_token() -> tuple[str, str]:
    """Returns (token for the cookie, sha256 id stored in the database)."""
    token = secrets.token_urlsafe(32)
    return token, sha256(token)


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def hmac_hex(value: str) -> str:
    return hmac.new(get_settings().secret_key.encode(), value.encode(), hashlib.sha256).hexdigest()


def csrf_token_for(session_id: str) -> str:
    """Stateless CSRF token bound to the session; sent in X-CSRF-Token on unsafe methods."""
    return hmac_hex("csrf:" + session_id)


def ip_hash(ip: str | None) -> str | None:
    return hmac_hex("ip:" + ip) if ip else None


class RateLimiter:
    """In-process sliding window. One process per deployment in v1; use Redis when scaling out."""

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window_s: int) -> int | None:
        """Records a hit. Returns None if allowed, else seconds until a slot frees up."""
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > window_s:
                q.popleft()
            if len(q) >= limit:
                return max(1, int(window_s - (now - q[0])) + 1)
            q.append(now)
            return None

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()
