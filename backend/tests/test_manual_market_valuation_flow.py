from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from app import config
from app.core.domain import Holding, Wine
from app.services import internet_enrichment
from app.services.stats_service import compute_stats
from app.storage import repositories as repo

SCHEMA = Path(__file__).parents[1] / "app" / "storage" / "schema.sql"


def _connection() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(SCHEMA.read_text(encoding="utf-8"))
    return conn


def _manual_response() -> dict:
    return {
        "identity": {
            "matched_name": "Domaine Roulot Meursault Meix Chavaux 2022 750 ml",
            "confidence": 0.99,
            "explanation": "The merchant page names the exact producer, cuvée, vintage and format.",
            "ambiguities": [],
        },
        "drinking_windows": [],
        "market_observations": [
            {
                "source_url": "https://example.com/roulot-meix-chavaux-2022",
                "source_type": "auction",
                "published_at": None,
                "exact_producer": True,
                "exact_cuvee": True,
                "exact_vintage": True,
                "exact_format": True,
                "amount": 180.0,
                "currency": "EUR",
                "offer_type": "auction",
                "bottle_count": 1,
                "format_ml": 750,
                "tax_included": None,
                "in_stock": True,
                "observed_at": "2026-07-15",
                "notes": "Exact 750 ml bottle.",
            }
        ],
        "pairings": [],
        "serving": {
            "available": False,
            "temperature_min_c": None,
            "temperature_max_c": None,
            "decant_minutes": None,
            "stand_upright_hours": None,
            "glass": None,
            "rationale": "Not requested.",
            "source_urls": [],
            "method": "unavailable",
        },
        "composition": {
            "available": False,
            "grapes": [],
            "alcohol_percent": None,
            "sweetness": None,
            "oak": None,
            "certifications": [],
            "source_urls": [],
        },
        "reviews": [],
        "external_identifiers": [],
        "summary": "One exact auction observation.",
    }


def test_manual_market_candidate_is_saved_and_used_in_stats(monkeypatch) -> None:
    monkeypatch.setattr(config, "MANUAL_CHATGPT_ENABLED", True)
    conn = _connection()
    now = datetime.now(UTC).isoformat()
    conn.execute(
        "INSERT INTO users (id,username,password_hash,password_salt,created_at) "
        "VALUES ('user-1','owner','hash','salt',?)",
        (now,),
    )
    wine = Wine(
        id="wine-1",
        producer="Domaine Roulot",
        cuvee="Meix Chavaux",
        appellation="Meursault",
        vintage=2022,
        color="white",
        format="75cl",
        format_ml=750,
    )
    repo.insert_wine(conn, wine)
    holding = Holding(id="holding-1", wine_id=wine.id, quantity=2)
    repo.insert_holding(conn, holding)

    job = internet_enrichment.import_manual_chatgpt_response(
        conn,
        wine=wine,
        user_id="user-1",
        topics=["market_value"],
        locale="fr",
        response=_manual_response(),
    )
    assert job["provider"] == "manual_chatgpt"

    rows = conn.execute(
        "SELECT id,label,status FROM enrichment_candidates WHERE wine_id=?",
        (wine.id,),
    ).fetchall()
    labels = {row["label"] for row in rows}
    assert "secondary_market_value" in labels
    assert "quick_sale_estimate" in labels

    secondary = next(row for row in rows if row["label"] == "secondary_market_value")
    internet_enrichment.apply_candidate(
        conn,
        candidate_id=secondary["id"],
        user_id="user-1",
        force=True,
    )

    updated = repo.get_wine(conn, wine.id)
    assert updated is not None
    assert updated.market_value == 180.0
    assert updated.market_value_currency == "EUR"
    assert updated.market_value_basis == "secondary_market_value"

    stats = compute_stats([(updated, holding)])
    assert stats.market_value_by_currency == {"EUR": 360.0}
    assert stats.market_value_bottles == 2
    assert stats.market_value_missing_bottles == 0
