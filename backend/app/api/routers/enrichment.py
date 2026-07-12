from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status

from app.api.deps import get_conn, get_current_user_id
from app.core.domain import Movement, MovementAction, new_id
from app.services import enrichment
from app.services import recognition_service as rs
from app.storage import repositories as repo

router = APIRouter(
    tags=["enrichment"], dependencies=[Depends(get_current_user_id)]
)


def _json_default(obj):
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def _providers_or_503():
    providers = enrichment.get_active_providers()
    if not providers:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "enrichment_not_configured",
                "message": (
                    "No real enrichment provider is configured. Demo-generated "
                    "wine dates and prices are disabled by default."
                ),
            },
        )
    return providers


@router.post("/wines/{wine_id}/enrich/drinking-window")
def enrich_drinking_window(
    wine_id: str,
    user_id: str = Depends(get_current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
):
    wine = repo.get_wine(conn, wine_id)
    if wine is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="error.not_found")
    providers = _providers_or_503()
    fetched = enrichment.fetch_and_aggregate_drinking_window(wine, providers)
    if fetched is None:
        return {
            "applied": False,
            "note": "Configured providers returned no drinking-window data for this wine.",
        }
    before = {"drink_after": wine.drink_after, "drink_before": wine.drink_before}
    decisions = enrichment.apply_drinking_window_enrichment(wine, fetched)
    repo.update_wine(conn, wine, expected_version=wine.version)
    repo.insert_movement(
        conn,
        Movement(
            id=new_id(),
            action=MovementAction.ENRICH.value,
            wine_id=wine.id,
            user_id=user_id,
            note=f"drinking-window enrichment ({fetched.source_count} source(s))",
            details_json=json.dumps(
                {"before": before, "aggregated": asdict(fetched)},
                default=_json_default,
            ),
        ),
    )
    conn.commit()
    return {
        "decisions": [asdict(decision) for decision in decisions],
        "aggregated": asdict(fetched),
        "wine": asdict(wine),
    }


@router.post("/wines/{wine_id}/enrich/market-info")
def enrich_market_info(
    wine_id: str,
    user_id: str = Depends(get_current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
):
    wine = repo.get_wine(conn, wine_id)
    if wine is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="error.not_found")
    providers = _providers_or_503()
    fetched = enrichment.fetch_and_aggregate_market_info(wine, providers)
    if fetched is None:
        return {
            "applied": False,
            "note": "Configured providers returned no market information for this wine.",
        }
    before_value = wine.market_value
    decision = enrichment.apply_market_info_enrichment(wine, fetched)
    repo.update_wine(conn, wine, expected_version=wine.version)
    repo.insert_movement(
        conn,
        Movement(
            id=new_id(),
            action=MovementAction.ENRICH.value,
            wine_id=wine.id,
            user_id=user_id,
            note=f"market-info enrichment ({fetched.source_count} source(s))",
            details_json=json.dumps(
                {"before_value": before_value, "aggregated": asdict(fetched)},
                default=_json_default,
            ),
        ),
    )
    conn.commit()
    return {
        "decision": asdict(decision),
        "aggregated": asdict(fetched),
        "wine": asdict(wine),
    }


@router.post("/wines/{wine_id}/photos")
async def register_photo(
    wine_id: str,
    file: UploadFile,
    conn: sqlite3.Connection = Depends(get_conn),
):
    if repo.get_wine(conn, wine_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="error.not_found")
    raw = await file.read()
    try:
        phash = rs.compute_phash(raw)
    except rs.RecognitionUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    repo.insert_photo_hash(conn, new_id(), wine_id, phash)
    conn.commit()
    return {"status": "registered"}


@router.post("/photos/recognize")
async def recognize_photo(
    file: UploadFile,
    conn: sqlite3.Connection = Depends(get_conn),
):
    raw = await file.read()
    wines = repo.list_wines(conn)
    known_hashes = repo.list_photo_hashes(conn)
    result = rs.recognize_bottle(raw, wines, known_hashes, top_k=5)
    wines_by_id = {wine.id: wine for wine in wines}
    matches = []
    for match in result.matches:
        wine = wines_by_id.get(match.wine_id)
        if not wine:
            continue
        matches.append(
            {
                "wine_id": wine.id,
                "producer": wine.producer,
                "cuvee": wine.cuvee,
                "vintage": wine.vintage,
                "confidence": round(match.confidence, 3),
                "ocr_score": match.ocr_score,
                "photo_score": match.photo_score,
                "matched_via": match.matched_via,
            }
        )
    return {
        "ocr_available": result.ocr_available,
        "photo_match_available": result.photo_match_available,
        "ocr_text": result.ocr_text,
        "matches": matches,
    }
