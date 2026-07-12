from __future__ import annotations

import sqlite3
from dataclasses import asdict
from typing import Optional

from fastapi import APIRouter, Depends

from app.api.deps import get_conn, get_current_user_id
from app.api.schemas import RecommendationRequestIn
from app.services import moveplan_service, recommendation_service as rec, stats_service
from app.storage import repositories as repo

router = APIRouter(tags=["insights"], dependencies=[Depends(get_current_user_id)])


@router.get("/stats")
def get_stats(cellar_id: Optional[str] = None, conn: sqlite3.Connection = Depends(get_conn)):
    if cellar_id:
        pairs = [(w, h) for h, w in repo.list_holdings_with_wines(conn, cellar_id=cellar_id, active_only=True)]
        return asdict(stats_service.compute_stats(pairs))

    all_pairs = repo.list_holdings_with_wines(conn, active_only=True)
    overall = [(w, h) for h, w in all_pairs]
    by_cellar: dict[str, list] = {}
    for holding, wine in all_pairs:
        if holding.cellar_id:
            by_cellar.setdefault(holding.cellar_id, []).append((wine, holding))
    return {
        "overall": asdict(stats_service.compute_stats(overall)),
        "per_cellar": {cid: asdict(stats_service.compute_stats(pairs)) for cid, pairs in by_cellar.items()},
    }


@router.get("/moveplan")
def get_move_plan(conn: sqlite3.Connection = Depends(get_conn)):
    cellars = repo.list_cellars(conn)
    holdings_with_wines = repo.list_holdings_with_wines(conn, active_only=True)
    plan = moveplan_service.suggest_move_plan(cellars, holdings_with_wines)
    return asdict(plan)


@router.post("/recommendations")
def get_recommendations(payload: RecommendationRequestIn, conn: sqlite3.Connection = Depends(get_conn)):
    holdings_with_wines = repo.list_holdings_with_wines(conn, cellar_id=payload.cellar_id, active_only=True)
    criteria = rec.RecommendationCriteria(**payload.model_dump(exclude={"limit"}))
    results = rec.recommend_wines(holdings_with_wines, criteria, limit=payload.limit)
    return [
        {
            "wine": asdict(r.wine),
            "holding_id": r.holding.id,
            "quantity": r.holding.quantity,
            "score": r.score,
            "reasons": r.reasons,
        }
        for r in results
    ]
