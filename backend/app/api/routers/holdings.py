from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_conn, get_current_user_id
from app.api.schemas import (
    ActionOut,
    AddBottlesIn,
    BottleEditContextOut,
    BottleEditIn,
    BottleEditOut,
    HoldingOut,
    MoveBottlesIn,
    RemoveBottlesIn,
)
from app.core.domain import HoldingState
from app.core.exceptions import ConflictError, NotFoundError, ValidationError
from app.services import bottle_edit_service as bes
from app.services import holdings_service as hs
from app.storage import repositories as repo

router = APIRouter(
    prefix="/holdings",
    tags=["holdings"],
    dependencies=[Depends(get_current_user_id)],
)


def _conflict_detail(exc: ConflictError) -> dict:
    detail: dict = {"code": "optimistic_conflict", "message": str(exc)}
    if exc.current is not None:
        try:
            detail["current"] = HoldingOut.model_validate(exc.current).model_dump(mode="json")
        except Exception:
            pass
    return detail


def _action_out(result: hs.ActionResult) -> ActionOut:
    return ActionOut(
        holding=HoldingOut.model_validate(result.holding),
        warning=result.warning,
        duplicate=result.duplicate,
    )


@router.get("", response_model=list[HoldingOut])
def list_holdings(
    wine_id: str | None = None,
    cellar_id: str | None = None,
    state: str | None = None,
    conn: sqlite3.Connection = Depends(get_conn),
):
    return repo.list_holdings(conn, wine_id=wine_id, cellar_id=cellar_id, state=state)


@router.get("/{holding_id}/edit-context", response_model=BottleEditContextOut)
def bottle_edit_context(
    holding_id: str,
    conn: sqlite3.Connection = Depends(get_conn),
):
    try:
        result = bes.get_edit_context(conn, holding_id)
    except NotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return BottleEditContextOut.model_validate(result)


@router.put("/{holding_id}/bottle", response_model=BottleEditOut)
def update_bottle(
    holding_id: str,
    payload: BottleEditIn,
    user_id: str = Depends(get_current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
):
    try:
        result = bes.edit_bottle(
            conn,
            holding_id=holding_id,
            payload=payload,
            user_id=user_id,
        )
    except NotFoundError as exc:
        conn.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        conn.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=_conflict_detail(exc)) from exc
    except ValidationError as exc:
        conn.rollback()
        if exc.field == "database":
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail={"code": "database_integrity", "message": str(exc)},
            ) from exc
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    conn.commit()
    return BottleEditOut.model_validate({"wine": result.wine, "holding": result.holding})


@router.post("/add", response_model=ActionOut)
def add_bottles(
    payload: AddBottlesIn,
    user_id: str = Depends(get_current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
):
    try:
        result = hs.add_bottles(conn, user_id=user_id, **payload.model_dump())
    except NotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=_conflict_detail(exc)) from exc
    except ValidationError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    conn.commit()
    return _action_out(result)


@router.post("/move", response_model=ActionOut)
def move_bottles(
    payload: MoveBottlesIn,
    user_id: str = Depends(get_current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
):
    try:
        result = hs.move_bottles(conn, user_id=user_id, **payload.model_dump())
    except NotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=_conflict_detail(exc)) from exc
    except ValidationError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    conn.commit()
    return _action_out(result)


@router.post("/remove", response_model=ActionOut)
def remove_bottles(
    payload: RemoveBottlesIn,
    user_id: str = Depends(get_current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
):
    data = payload.model_dump()
    try:
        reason = HoldingState(data.pop("reason"))
    except ValueError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail=f"Invalid removal reason: {exc}"
        ) from exc
    try:
        result = hs.remove_bottles(conn, reason=reason, user_id=user_id, **data)
    except NotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=_conflict_detail(exc)) from exc
    except ValidationError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    conn.commit()
    return _action_out(result)
