from __future__ import annotations

import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_conn, get_current_user_id
from app.api.schemas import ActionOut, AddBottlesIn, HoldingOut, MoveBottlesIn, RemoveBottlesIn
from app.core.domain import HoldingState
from app.core.exceptions import ConflictError, NotFoundError, ValidationError
from app.services import holdings_service as hs
from app.storage import repositories as repo

router = APIRouter(prefix="/holdings", tags=["holdings"], dependencies=[Depends(get_current_user_id)])


@router.get("", response_model=list[HoldingOut])
def list_holdings(
    wine_id: Optional[str] = None, cellar_id: Optional[str] = None, state: Optional[str] = None,
    conn: sqlite3.Connection = Depends(get_conn),
):
    return repo.list_holdings(conn, wine_id=wine_id, cellar_id=cellar_id, state=state)


@router.post("/add", response_model=ActionOut)
def add_bottles(payload: AddBottlesIn, user_id: str = Depends(get_current_user_id), conn: sqlite3.Connection = Depends(get_conn)):
    try:
        result = hs.add_bottles(conn, user_id=user_id, **payload.model_dump())
    except (ValidationError, NotFoundError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    conn.commit()
    return ActionOut(holding=HoldingOut.model_validate(result.holding), warning=result.warning)


@router.post("/move", response_model=ActionOut)
def move_bottles(payload: MoveBottlesIn, user_id: str = Depends(get_current_user_id), conn: sqlite3.Connection = Depends(get_conn)):
    try:
        result = hs.move_bottles(conn, user_id=user_id, **payload.model_dump())
    except NotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="error.conflict") from exc
    except ValidationError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    conn.commit()
    return ActionOut(holding=HoldingOut.model_validate(result.holding), warning=result.warning)


@router.post("/remove", response_model=ActionOut)
def remove_bottles(payload: RemoveBottlesIn, user_id: str = Depends(get_current_user_id), conn: sqlite3.Connection = Depends(get_conn)):
    data = payload.model_dump()
    try:
        reason = HoldingState(data.pop("reason"))
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Invalid removal reason: {exc}") from exc
    try:
        result = hs.remove_bottles(conn, reason=reason, user_id=user_id, **data)
    except NotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="error.conflict") from exc
    except ValidationError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    conn.commit()
    return ActionOut(holding=HoldingOut.model_validate(result.holding))
