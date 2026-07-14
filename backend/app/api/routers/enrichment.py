from __future__ import annotations

import sqlite3
from typing import Any, Literal

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Response,
    UploadFile,
    status,
)
from pydantic import BaseModel, Field

from app.api.deps import get_conn, get_current_user_id, get_database
from app.core.domain import new_id
from app.services import internet_enrichment as research
from app.services import recognition_service as rs
from app.storage import enrichment_repository as er
from app.storage import repositories as repo
from app.storage.database import Database

router = APIRouter(tags=["enrichment"], dependencies=[Depends(get_current_user_id)])


class ResearchRequest(BaseModel):
    topics: list[str] = Field(default_factory=lambda: sorted(research.TOPICS))
    locale: str = "en"
    background: bool = True
    auto_apply: bool = False


class ManualResearchRequest(BaseModel):
    topics: list[str] = Field(default_factory=lambda: sorted(research.TOPICS))
    locale: str = "en"


class ManualResearchImportRequest(ManualResearchRequest):
    response: dict[str, Any] | str
    auto_apply: bool = False


class CandidateDecisionRequest(BaseModel):
    decision: Literal["accepted", "rejected"]
    force: bool = False


def _error(exc: research.EnrichmentError) -> HTTPException:
    code_to_status = {
        research.EnrichmentNotConfigured.code: status.HTTP_503_SERVICE_UNAVAILABLE,
        research.EnrichmentBudgetExceeded.code: status.HTTP_429_TOO_MANY_REQUESTS,
        research.ProviderRequestError.code: status.HTTP_502_BAD_GATEWAY,
        research.ProviderResponseError.code: status.HTTP_502_BAD_GATEWAY,
    }
    return HTTPException(
        code_to_status.get(exc.code, status.HTTP_500_INTERNAL_SERVER_ERROR),
        detail={"code": exc.code, "message": str(exc)},
    )


@router.get("/enrichment/status")
def enrichment_status(conn: sqlite3.Connection = Depends(get_conn)):
    provider = research.provider_status()
    return {
        **provider.__dict__,
        "jobs_today": er.jobs_created_since(conn, research._day_start()),
        "tokens_this_month": er.tokens_used_since(conn, research._month_start()),
    }


@router.post("/wines/{wine_id}/research/manual-chatgpt")
def prepare_manual_chatgpt_research(
    wine_id: str,
    payload: ManualResearchRequest,
    conn: sqlite3.Connection = Depends(get_conn),
):
    wine = repo.get_wine(conn, wine_id)
    if wine is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="error.not_found")
    try:
        return research.prepare_manual_chatgpt_request(
            wine,
            topics=payload.topics,
            locale=payload.locale,
        )
    except research.ProviderResponseError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail={"code": exc.code, "message": str(exc)},
        ) from exc
    except research.EnrichmentError as exc:
        raise _error(exc) from exc
    except ValueError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid_research_request", "message": str(exc)},
        ) from exc


@router.post("/wines/{wine_id}/research/manual-chatgpt/import")
def import_manual_chatgpt_research(
    wine_id: str,
    payload: ManualResearchImportRequest,
    user_id: str = Depends(get_current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
):
    wine = repo.get_wine(conn, wine_id)
    if wine is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="error.not_found")
    try:
        result = research.import_manual_chatgpt_response(
            conn,
            wine=wine,
            user_id=user_id,
            topics=payload.topics,
            locale=payload.locale,
            response=payload.response,
            auto_apply=payload.auto_apply,
        )
    except research.ProviderResponseError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail={"code": exc.code, "message": str(exc)},
        ) from exc
    except research.EnrichmentError as exc:
        raise _error(exc) from exc
    except ValueError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid_research_request", "message": str(exc)},
        ) from exc
    conn.commit()
    return result


@router.post("/wines/{wine_id}/research")
def start_research(
    wine_id: str,
    payload: ResearchRequest,
    background_tasks: BackgroundTasks,
    response: Response,
    user_id: str = Depends(get_current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
    db: Database = Depends(get_database),
):
    wine = repo.get_wine(conn, wine_id)
    if wine is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="error.not_found")
    try:
        job = research.create_job(
            conn,
            wine=wine,
            user_id=user_id,
            topics=payload.topics,
            locale=payload.locale,
            auto_apply=payload.auto_apply,
        )
    except research.EnrichmentError as exc:
        raise _error(exc) from exc
    except ValueError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid_research_request", "message": str(exc)},
        ) from exc
    conn.commit()

    if payload.background:
        background_tasks.add_task(research.execute_job, db, job["id"])
        response.status_code = status.HTTP_202_ACCEPTED
        return job

    research.execute_job(db, job["id"])
    result = er.get_job_with_results(conn, job["id"])
    if result and result["status"] == "failed":
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail={
                "code": result.get("error_code") or "enrichment_failed",
                "message": result.get("error_message") or "Research failed",
            },
        )
    return result


@router.get("/enrichment/jobs/{job_id}")
def get_research_job(
    job_id: str,
    conn: sqlite3.Connection = Depends(get_conn),
):
    job = er.get_job_with_results(conn, job_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="error.not_found")
    return job


@router.get("/wines/{wine_id}/research/history")
def research_history(
    wine_id: str,
    limit: int = 20,
    conn: sqlite3.Connection = Depends(get_conn),
):
    if repo.get_wine(conn, wine_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="error.not_found")
    return er.list_jobs_for_wine(conn, wine_id, limit=max(1, min(limit, 100)))


@router.get("/wines/{wine_id}/enrichment-profile")
def enrichment_profile(
    wine_id: str,
    conn: sqlite3.Connection = Depends(get_conn),
):
    if repo.get_wine(conn, wine_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="error.not_found")
    return {
        **er.get_profile(conn, wine_id),
        "external_identifiers": er.list_external_identifiers(conn, wine_id),
    }


@router.post("/enrichment/candidates/{candidate_id}/decision")
def decide_candidate(
    candidate_id: str,
    payload: CandidateDecisionRequest,
    user_id: str = Depends(get_current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
):
    try:
        if payload.decision == "accepted":
            result = research.apply_candidate(
                conn,
                candidate_id=candidate_id,
                user_id=user_id,
                force=payload.force,
            )
        else:
            result = research.reject_candidate(conn, candidate_id=candidate_id, user_id=user_id)
    except KeyError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="error.not_found") from exc
    conn.commit()
    return result


# Backward-compatible convenience endpoints. They now run the real research
# engine and return evidence-backed candidates rather than deterministic demo
# values. Results are not auto-applied unless their confidence exceeds the
# configured threshold and the existing value is not manual.
@router.post("/wines/{wine_id}/enrich/drinking-window")
def enrich_drinking_window_legacy(
    wine_id: str,
    background_tasks: BackgroundTasks,
    response: Response,
    user_id: str = Depends(get_current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
    db: Database = Depends(get_database),
):
    return start_research(
        wine_id,
        ResearchRequest(
            topics=["drinking_window"],
            background=True,
            auto_apply=False,
        ),
        background_tasks,
        response,
        user_id,
        conn,
        db,
    )


@router.post("/wines/{wine_id}/enrich/market-info")
def enrich_market_info_legacy(
    wine_id: str,
    background_tasks: BackgroundTasks,
    response: Response,
    user_id: str = Depends(get_current_user_id),
    conn: sqlite3.Connection = Depends(get_conn),
    db: Database = Depends(get_database),
):
    return start_research(
        wine_id,
        ResearchRequest(
            topics=["market_value", "pairing", "serving"],
            background=True,
            auto_apply=False,
        ),
        background_tasks,
        response,
        user_id,
        conn,
        db,
    )


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
