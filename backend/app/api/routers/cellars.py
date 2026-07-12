from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_conn, get_current_user_id
from app.api.schemas import CellarIn, CellarOut
from app.core.domain import Cellar, new_id
from app.core.exceptions import ConfigurationError, ConflictError, NotFoundError
from app.services import cellar_rules
from app.storage import repositories as repo

router = APIRouter(prefix="/cellars", tags=["cellars"], dependencies=[Depends(get_current_user_id)])


def _with_fill(conn: sqlite3.Connection, cellar: Cellar) -> CellarOut:
    out = CellarOut.model_validate(cellar)
    out.current_fill = repo.cellar_fill(conn, cellar.id)
    return out


@router.get("", response_model=list[CellarOut])
def list_cellars(conn: sqlite3.Connection = Depends(get_conn)):
    return [_with_fill(conn, c) for c in repo.list_cellars(conn)]


@router.get("/{cellar_id}", response_model=CellarOut)
def get_cellar(cellar_id: str, conn: sqlite3.Connection = Depends(get_conn)):
    cellar = repo.get_cellar(conn, cellar_id)
    if cellar is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="error.not_found")
    return _with_fill(conn, cellar)


@router.post("", response_model=CellarOut, status_code=status.HTTP_201_CREATED)
def create_cellar(payload: CellarIn, conn: sqlite3.Connection = Depends(get_conn)):
    existing = repo.list_cellars(conn)
    try:
        cellar_rules.validate_rule_uniqueness(payload.location_rule, None, existing)
    except ConfigurationError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    cellar = Cellar(id=new_id(), **payload.model_dump())
    if cellar.is_overflow:
        cellar.purpose_level = None
    try:
        repo.insert_cellar(conn, cellar)
    except ConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    conn.commit()
    return _with_fill(conn, cellar)


@router.put("/{cellar_id}", response_model=CellarOut)
def update_cellar(cellar_id: str, payload: CellarIn, expected_version: int, conn: sqlite3.Connection = Depends(get_conn)):
    existing = repo.get_cellar(conn, cellar_id)
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="error.not_found")
    others = [c for c in repo.list_cellars(conn) if c.id != cellar_id]
    try:
        cellar_rules.validate_rule_uniqueness(payload.location_rule, cellar_id, others)
    except ConfigurationError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    for field_name, value in payload.model_dump().items():
        setattr(existing, field_name, value)
    if existing.is_overflow:
        existing.purpose_level = None
    try:
        repo.update_cellar(conn, existing, expected_version=expected_version)
    except ConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="error.conflict") from exc
    conn.commit()
    return _with_fill(conn, existing)


@router.delete("/{cellar_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_cellar(cellar_id: str, conn: sqlite3.Connection = Depends(get_conn)):
    try:
        repo.delete_cellar(conn, cellar_id)
    except NotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="error.not_found") from exc
    except ConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    conn.commit()
