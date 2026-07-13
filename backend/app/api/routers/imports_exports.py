from __future__ import annotations

import json
import sqlite3
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import PlainTextResponse

from app.api.deps import get_conn, get_current_user_id
from app.api.schemas import ExportRequest
from app.core.exceptions import ValidationError
from app.services import csv_io
from app.storage import repositories as repo

router = APIRouter(
    tags=["import-export"],
    dependencies=[Depends(get_current_user_id)],
)


def _decode_mapping(raw_mapping: str | None) -> dict[str, Any] | None:
    if raw_mapping is None or not raw_mapping.strip():
        return None
    try:
        value = json.loads(raw_mapping)
    except json.JSONDecodeError as exc:
        raise ValidationError("CSV mapping is not valid JSON") from exc
    if not isinstance(value, dict):
        raise ValidationError("CSV mapping must be a JSON object")
    return value


def _bad_request(exc: ValidationError) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.post("/import/analyze")
async def analyze_csv(file: UploadFile = File(...)):
    """Inspect a CSV without changing the database.

    The response contains stable source-column IDs, sample values and automatic
    mapping suggestions. Duplicate/blank spreadsheet headers remain usable.
    """
    raw = await file.read()
    try:
        return csv_io.analyze_csv(raw)
    except ValidationError as exc:
        raise _bad_request(exc) from exc


@router.post("/import/preview")
async def preview_csv(
    file: UploadFile = File(...),
    mapping: str = Form(...),
    default_cellar_id: str | None = None,
    conn: sqlite3.Connection = Depends(get_conn),
):
    """Validate a chosen mapping and return normalized sample rows."""
    raw = await file.read()
    try:
        parsed_mapping = _decode_mapping(mapping)
        if parsed_mapping is None:
            raise ValidationError("A CSV column mapping is required for preview")
        return csv_io.preview_csv(
            raw,
            mapping=parsed_mapping,
            conn=conn,
            default_cellar_id=default_cellar_id,
        )
    except ValidationError as exc:
        raise _bad_request(exc) from exc


@router.post("/import")
async def import_csv(
    file: UploadFile = File(...),
    mapping: str | None = Form(None),
    default_cellar_id: str | None = None,
    user_id: str = Depends(get_current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
):
    """Import with an explicit mapping, or automatic aliases for old clients."""
    raw = await file.read()
    try:
        parsed_mapping = _decode_mapping(mapping)
        report = csv_io.import_csv(
            raw,
            conn=conn,
            user_id=user_id,
            default_cellar_id=default_cellar_id,
            mapping=parsed_mapping,
        )
    except ValidationError as exc:
        conn.rollback()
        raise _bad_request(exc) from exc
    except Exception:
        conn.rollback()
        raise
    conn.commit()
    return {
        "total_rows": report.total_rows,
        "imported": report.imported,
        "merged_into_existing_wine": report.merged_into_existing_wine,
        "skipped": report.skipped,
        "unassigned_rows": report.unassigned_rows,
        "unassigned_bottles": report.unassigned_bottles,
        "warnings": [
            {"row": warning.row_number, "message": warning.message} for warning in report.warnings
        ],
    }


@router.post("/export", response_class=PlainTextResponse)
def export_csv(
    payload: ExportRequest,
    conn: sqlite3.Connection = Depends(get_conn),
):
    holdings_with_wines = repo.list_holdings_with_wines(
        conn,
        cellar_id=payload.cellar_id,
        active_only=True,
    )
    rows = []
    for holding, wine in holdings_with_wines:
        cellar = repo.get_cellar(conn, holding.cellar_id) if holding.cellar_id else None
        rows.append((wine, holding, cellar))
    try:
        csv_text = csv_io.export_csv(
            rows,
            columns=payload.columns,
            language=payload.language,
        )
    except ValidationError as exc:
        raise _bad_request(exc) from exc
    return PlainTextResponse(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=cellar_export.csv"},
    )
