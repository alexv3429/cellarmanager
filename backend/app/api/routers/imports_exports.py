from __future__ import annotations

import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import PlainTextResponse

from app.api.deps import get_conn, get_current_user_id
from app.api.schemas import ExportRequest
from app.core.exceptions import ValidationError
from app.services import csv_io
from app.storage import repositories as repo

router = APIRouter(tags=["import-export"], dependencies=[Depends(get_current_user_id)])


@router.post("/import")
async def import_csv(
    file: UploadFile,
    default_cellar_id: Optional[str] = None,
    user_id: str = Depends(get_current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
):
    raw = await file.read()
    try:
        report = csv_io.import_csv(raw, conn=conn, user_id=user_id, default_cellar_id=default_cellar_id)
    except ValidationError as exc:
        conn.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception:
        conn.rollback()
        raise
    conn.commit()
    return {
        "total_rows": report.total_rows,
        "imported": report.imported,
        "merged_into_existing_wine": report.merged_into_existing_wine,
        "skipped": report.skipped,
        "warnings": [{"row": w.row_number, "message": w.message} for w in report.warnings],
    }


@router.post("/export", response_class=PlainTextResponse)
def export_csv(payload: ExportRequest, conn: sqlite3.Connection = Depends(get_conn)):
    holdings_with_wines = repo.list_holdings_with_wines(conn, cellar_id=payload.cellar_id, active_only=True)
    rows = []
    for holding, wine in holdings_with_wines:
        cellar = repo.get_cellar(conn, holding.cellar_id) if holding.cellar_id else None
        rows.append((wine, holding, cellar))
    try:
        csv_text = csv_io.export_csv(rows, columns=payload.columns, language=payload.language)
    except ValidationError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return PlainTextResponse(
        content=csv_text, media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=cellar_export.csv"},
    )
