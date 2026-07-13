from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_conn, get_current_user_id
from app.api.schemas import WineIn, WineOut
from app.core.domain import Wine, new_id
from app.core.exceptions import ConflictError
from app.services.csv_io import parse_format_ml
from app.storage import repositories as repo

router = APIRouter(prefix="/wines", tags=["wines"], dependencies=[Depends(get_current_user_id)])


@router.get("", response_model=list[WineOut])
def list_wines(search: str | None = None, conn: sqlite3.Connection = Depends(get_conn)):
    return repo.list_wines(conn, search=search)


@router.get("/{wine_id}", response_model=WineOut)
def get_wine(wine_id: str, conn: sqlite3.Connection = Depends(get_conn)):
    wine = repo.get_wine(conn, wine_id)
    if wine is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="error.not_found")
    return wine


@router.post("", response_model=WineOut, status_code=status.HTTP_201_CREATED)
def create_wine(payload: WineIn, conn: sqlite3.Connection = Depends(get_conn)):
    wine = Wine(id=new_id(), format_ml=parse_format_ml(payload.format), **payload.model_dump())
    repo.insert_wine(conn, wine)
    conn.commit()
    return wine


@router.put("/{wine_id}", response_model=WineOut)
def update_wine(
    wine_id: str,
    payload: WineIn,
    expected_version: int,
    conn: sqlite3.Connection = Depends(get_conn),
):
    existing = repo.get_wine(conn, wine_id)
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="error.not_found")
    for field_name, value in payload.model_dump().items():
        setattr(existing, field_name, value)
    existing.format_ml = parse_format_ml(existing.format)
    try:
        repo.update_wine(conn, existing, expected_version=expected_version)
    except ConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="error.conflict") from exc
    conn.commit()
    return existing


@router.get("/{wine_id}/locations")
def wine_locations(wine_id: str, conn: sqlite3.Connection = Depends(get_conn)):
    from app.services.holdings_service import locations_for_wine

    if repo.get_wine(conn, wine_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="error.not_found")
    return locations_for_wine(conn, wine_id)
