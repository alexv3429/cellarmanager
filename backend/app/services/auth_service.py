"""Authentication primitives: password hashing and session tokens.

Deliberately dependency-free (stdlib ``hashlib``/``hmac``/``secrets`` only) so
the whole auth flow can be unit tested without installing anything, and so a
self-hosted single-instance deployment needs no extra moving parts.

Password hashing: PBKDF2-HMAC-SHA256 with a random 16-byte salt per user and
a high iteration count. This is a NIST-recommended construction and, unlike
a hand-rolled cipher, is not "rolling your own crypto" - it is calling a
well-vetted standard-library primitive correctly.

Session tokens: a compact HMAC-SHA256-signed token, conceptually the same
shape as a JWT (base64url header/payload + signature) but implemented
directly so no external JWT library is required. If you later need to
interoperate with other systems that expect real JWTs, swap
``create_token``/``verify_token`` for ``PyJWT`` - callers only see
``create_token(user_id) -> str`` and ``verify_token(token) -> dict | None``,
so the change is fully contained here.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from typing import Optional

PBKDF2_ITERATIONS = 210_000
SALT_BYTES = 16


def hash_password(password: str, salt_hex: Optional[str] = None) -> tuple[str, str]:
    """Return (hash_hex, salt_hex). Generates a new random salt if none given."""
    if not password:
        raise ValueError("Password must not be empty")
    salt = bytes.fromhex(salt_hex) if salt_hex else _random_salt()
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return digest.hex(), salt.hex()


def verify_password(password: str, salt_hex: str, expected_hash_hex: str) -> bool:
    computed_hash, _ = hash_password(password, salt_hex)
    return hmac.compare_digest(computed_hash, expected_hash_hex)


def _random_salt() -> bytes:
    import secrets
    return secrets.token_bytes(SALT_BYTES)


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def create_token(user_id: str, secret: str, ttl_seconds: int = 12 * 3600, now: Optional[float] = None) -> str:
    """Create a compact signed session token: base64url(payload).base64url(signature)."""
    issued_at = int(now if now is not None else time.time())
    payload = {"sub": user_id, "iat": issued_at, "exp": issued_at + ttl_seconds}
    payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_b64 = _b64url_encode(payload_bytes)
    signature = hmac.new(secret.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).digest()
    return f"{payload_b64}.{_b64url_encode(signature)}"


@dataclass
class TokenPayload:
    user_id: str
    issued_at: int
    expires_at: int


def verify_token(token: str, secret: str, now: Optional[float] = None) -> Optional[TokenPayload]:
    """Verify signature and expiry. Returns None (never raises) on any problem,
    so callers can treat "invalid" and "expired" identically as "not authenticated"."""
    try:
        payload_b64, signature_b64 = token.split(".", 1)
        expected_sig = hmac.new(secret.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).digest()
        actual_sig = _b64url_decode(signature_b64)
        if not hmac.compare_digest(expected_sig, actual_sig):
            return None
        payload = json.loads(_b64url_decode(payload_b64))
        current = now if now is not None else time.time()
        if current > payload["exp"]:
            return None
        return TokenPayload(user_id=payload["sub"], issued_at=payload["iat"], expires_at=payload["exp"])
    except (ValueError, KeyError, json.JSONDecodeError):
        return None


class LoginRateLimiter:
    """Simple in-memory login-attempt throttle (per username).

    Not a substitute for a proper WAF/reverse-proxy rate limiter in a public
    deployment, but stops trivial unthrottled brute-forcing out of the box.
    """

    def __init__(self, max_attempts: int = 5, window_seconds: int = 300):
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._attempts: dict[str, list[float]] = {}

    def is_blocked(self, key: str, now: Optional[float] = None) -> bool:
        now = now if now is not None else time.time()
        attempts = [t for t in self._attempts.get(key, []) if now - t < self.window_seconds]
        self._attempts[key] = attempts
        return len(attempts) >= self.max_attempts

    def record_failure(self, key: str, now: Optional[float] = None) -> None:
        now = now if now is not None else time.time()
        self._attempts.setdefault(key, []).append(now)

    def reset(self, key: str) -> None:
        self._attempts.pop(key, None)
