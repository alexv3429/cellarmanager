"""FastAPI dependencies: database access, authentication, locale resolution."""
from __future__ import annotations

import sqlite3
from typing import Iterator, Optional

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app import config
from app.services import auth_service
from app.storage import repositories as repo
from app.storage.database import Database

_db = Database(config.DATABASE_PATH)
_bearer = HTTPBearer(auto_error=False)
login_rate_limiter = auth_service.LoginRateLimiter(
    max_attempts=config.LOGIN_MAX_ATTEMPTS, window_seconds=config.LOGIN_WINDOW_SECONDS
)


def get_database() -> Database:
    return _db


def get_conn() -> Iterator[sqlite3.Connection]:
    conn = _db.connect()
    try:
        yield conn
    finally:
        pass  # thread-local connection is reused across requests on this worker thread


def get_current_user_id(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    conn: sqlite3.Connection = Depends(get_conn),
) -> str:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = auth_service.verify_token(credentials.credentials, secret=config.SECRET_KEY)
    if payload is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Session expired or invalid, please log in again")
    user = repo.get_user(conn, payload.user_id)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="User no longer exists")
    return user.id


def get_locale(accept_language: Optional[str] = Header(default=None)) -> str:
    if accept_language:
        primary = accept_language.split(",")[0].split("-")[0].strip().lower()
        from app.i18n.loader import available_locales
        if primary in available_locales():
            return primary
    return config.DEFAULT_LOCALE
