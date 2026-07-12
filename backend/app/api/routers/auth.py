"""Authentication endpoints.

Registration is intentionally NOT an open public sign-up: it is only
possible while the users table is empty (bootstrapping the first/owner
account). After that, new users can only be added by an already-authenticated
user via POST /auth/users - appropriate for a private, family-scale cellar,
not a public app (requirement 9: "anyone shall not be able to access my
cellars without strong credentials").
"""
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app import config
from app.api.deps import get_conn, get_current_user_id, login_rate_limiter
from app.api.schemas import LoginIn, RegisterIn, TokenOut
from app.core.domain import User, new_id
from app.core.exceptions import ConflictError
from app.services import auth_service
from app.storage import repositories as repo

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenOut)
def register(payload: RegisterIn, conn: sqlite3.Connection = Depends(get_conn)):
    if repo.count_users(conn) > 0:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="auth.registration_closed")
    password_hash, salt = auth_service.hash_password(payload.password)
    user = User(id=new_id(), username=payload.username, password_hash=password_hash,
                password_salt=salt, locale=payload.locale)
    try:
        repo.insert_user(conn, user)
    except ConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    conn.commit()
    token = auth_service.create_token(user.id, secret=config.SECRET_KEY, ttl_seconds=config.TOKEN_TTL_SECONDS)
    return TokenOut(access_token=token, locale=user.locale)


@router.post("/login", response_model=TokenOut)
def login(payload: LoginIn, request: Request, conn: sqlite3.Connection = Depends(get_conn)):
    rate_limit_key = payload.username.strip().lower()
    if login_rate_limiter.is_blocked(rate_limit_key):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, detail="auth.too_many_attempts")

    user = repo.get_user_by_username(conn, payload.username)
    if user is None or not auth_service.verify_password(payload.password, user.password_salt, user.password_hash):
        login_rate_limiter.record_failure(rate_limit_key)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="auth.login_failed")

    login_rate_limiter.reset(rate_limit_key)
    token = auth_service.create_token(user.id, secret=config.SECRET_KEY, ttl_seconds=config.TOKEN_TTL_SECONDS)
    return TokenOut(access_token=token, locale=user.locale)


@router.post("/users", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
def add_user(
    payload: RegisterIn,
    conn: sqlite3.Connection = Depends(get_conn),
    _current_user_id: str = Depends(get_current_user_id),
):
    """Add another household member's account. Requires being logged in
    already - this is how a second user gets access, deliberately not a
    public endpoint."""
    password_hash, salt = auth_service.hash_password(payload.password)
    user = User(id=new_id(), username=payload.username, password_hash=password_hash,
                password_salt=salt, locale=payload.locale)
    try:
        repo.insert_user(conn, user)
    except ConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    conn.commit()
    token = auth_service.create_token(user.id, secret=config.SECRET_KEY, ttl_seconds=config.TOKEN_TTL_SECONDS)
    return TokenOut(access_token=token, locale=user.locale)
