from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_conn, get_current_user_id
from app.api.schemas import CellarIn, CellarOut
from app.core.domain import Cellar, new_id
from app.core.exceptions import ConfigurationError, ConflictError, NotFoundError
from app.services import assignment_service, cellar_rules
from app.storage import repositories as repo

router = APIRouter(
    prefix="/cellars",
    tags=["cellars"],
    dependencies=[Depends(get_current_user_id)],
)


def _with_fill(
    conn: sqlite3.Connection,
    cellar: Cellar,
    *,
    reconciled_holdings: int = 0,
    reconciled_bottles: int = 0,
) -> CellarOut:
    out = CellarOut.model_validate(cellar)
    out.current_fill = repo.cellar_fill(conn, cellar.id)
    out.reconciled_holdings = reconciled_holdings
    out.reconciled_bottles = reconciled_bottles
    return out


def _cellar_conflict(exc: ConflictError) -> dict:
    detail: dict = {"code": "optimistic_conflict", "message": str(exc)}
    if exc.current is not None:
        try:
            detail["current"] = CellarOut.model_validate(exc.current).model_dump(mode="json")
        except Exception:
            pass
    return detail


@router.get("", response_model=list[CellarOut])
def list_cellars(conn: sqlite3.Connection = Depends(get_conn)):
    return [_with_fill(conn, cellar) for cellar in repo.list_cellars(conn)]


# Static routes must stay above /{cellar_id}.
@router.get("/unassigned-summary")
def get_unassigned_summary(conn: sqlite3.Connection = Depends(get_conn)):
    """Return active bottles that have not yet been assigned to a cellar."""
    return assignment_service.unassigned_summary(conn)


@router.post("/reconcile-unassigned")
def reconcile_unassigned(
    conn: sqlite3.Connection = Depends(get_conn),
    user_id: str = Depends(get_current_user_id),
):
    """Apply all currently configured location rules to unassigned holdings."""
    result = assignment_service.reconcile_unassigned(conn, user_id=user_id)
    conn.commit()
    return result.as_dict()


@router.get("/{cellar_id}", response_model=CellarOut)
def get_cellar(cellar_id: str, conn: sqlite3.Connection = Depends(get_conn)):
    cellar = repo.get_cellar(conn, cellar_id)
    if cellar is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="error.not_found")
    return _with_fill(conn, cellar)


@router.post("", response_model=CellarOut, status_code=status.HTTP_201_CREATED)
def create_cellar(
    payload: CellarIn,
    conn: sqlite3.Connection = Depends(get_conn),
    user_id: str = Depends(get_current_user_id),
):
    existing = repo.list_cellars(conn)
    payload_data = payload.model_dump()
    try:
        normalized_rule, normalized_layout = cellar_rules.normalize_location_configuration(
            payload_data.get("location_rule"),
            payload_data.get("layout"),
        )
        payload_data["location_rule"] = normalized_rule
        payload_data["layout"] = normalized_layout
        cellar_rules.validate_rule_uniqueness(normalized_rule, None, existing)
    except ConfigurationError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    cellar = Cellar(id=new_id(), **payload_data)
    if cellar.is_overflow:
        cellar.purpose_level = None
    try:
        repo.insert_cellar(conn, cellar)
    except ConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    reconciliation = assignment_service.reconcile_unassigned(
        conn,
        user_id=user_id,
        only_cellar_id=cellar.id,
    )
    conn.commit()
    return _with_fill(
        conn,
        cellar,
        reconciled_holdings=reconciliation.assigned_holdings,
        reconciled_bottles=reconciliation.assigned_bottles,
    )


@router.put("/{cellar_id}", response_model=CellarOut)
def update_cellar(
    cellar_id: str,
    payload: CellarIn,
    expected_version: int,
    conn: sqlite3.Connection = Depends(get_conn),
    user_id: str = Depends(get_current_user_id),
):
    existing = repo.get_cellar(conn, cellar_id)
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="error.not_found")
    others = [cellar for cellar in repo.list_cellars(conn) if cellar.id != cellar_id]
    payload_data = payload.model_dump()
    try:
        normalized_rule, normalized_layout = cellar_rules.normalize_location_configuration(
            payload_data.get("location_rule"),
            payload_data.get("layout"),
        )
        payload_data["location_rule"] = normalized_rule
        payload_data["layout"] = normalized_layout
        cellar_rules.validate_rule_uniqueness(normalized_rule, cellar_id, others)
    except ConfigurationError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    for field_name, value in payload_data.items():
        setattr(existing, field_name, value)
    if existing.is_overflow:
        existing.purpose_level = None
    try:
        repo.update_cellar(conn, existing, expected_version=expected_version)
    except ConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=_cellar_conflict(exc)) from exc

    reconciliation = assignment_service.reconcile_unassigned(
        conn,
        user_id=user_id,
        only_cellar_id=existing.id,
    )
    conn.commit()
    return _with_fill(
        conn,
        existing,
        reconciled_holdings=reconciliation.assigned_holdings,
        reconciled_bottles=reconciliation.assigned_bottles,
    )


@router.delete("/{cellar_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_cellar(cellar_id: str, conn: sqlite3.Connection = Depends(get_conn)):
    try:
        repo.delete_cellar(conn, cellar_id)
    except NotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="error.not_found") from exc
    except ConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    conn.commit()
