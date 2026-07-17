from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from app.core.domain import Holding, Wine
from app.services import market_valuation_service as valuations
from app.services.stats_service import compute_stats
from app.storage import repositories as repo

SCHEMA = Path(__file__).parents[1] / "app" / "storage" / "schema.sql"


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(SCHEMA.read_text(encoding="utf-8"))
    return conn


def _wine(conn: sqlite3.Connection, wine_id: str = "wine-1", **kwargs) -> Wine:
    wine = Wine(id=wine_id, producer="Producer", **kwargs)
    repo.insert_wine(conn, wine)
    return wine


def _candidate(
    conn: sqlite3.Connection,
    *,
    candidate_id: str,
    wine_id: str,
    label: str,
    amount: float,
    currency: str,
    confidence: float = 0.8,
) -> None:
    now = datetime.now(UTC).isoformat()
    conn.execute(
        "INSERT INTO enrichment_jobs (id,wine_id,provider,topics_json,locale,auto_apply,status,created_at) VALUES (?,?,?,'[]','en',0,'completed',?)",
        (f"job-{candidate_id}", wine_id, "test", now),
    )
    conn.execute(
        """INSERT INTO enrichment_candidates
        (id,job_id,wine_id,topic,label,value_json,confidence,method,rationale,source_ids_json,status,created_at,reviewed_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,'accepted',?,?)""",
        (
            candidate_id,
            f"job-{candidate_id}",
            wine_id,
            "market_value",
            label,
            json.dumps({"amount": amount, "currency": currency}),
            confidence,
            "test",
            "test",
            "[]",
            now,
            now,
        ),
    )


def _profile(conn: sqlite3.Connection, wine_id: str, entries: dict) -> None:
    conn.execute(
        "INSERT INTO wine_enrichment_profiles (wine_id,profile_json,updated_at,version) VALUES (?,?,?,1)",
        (wine_id, json.dumps(entries), datetime.now(UTC).isoformat()),
    )


def test_secondary_wins_and_quick_sale_is_separate() -> None:
    conn = _conn()
    _wine(conn)
    _candidate(
        conn,
        candidate_id="replacement",
        wine_id="wine-1",
        label="replacement_value",
        amount=120,
        currency="EUR",
    )
    _candidate(
        conn,
        candidate_id="secondary",
        wine_id="wine-1",
        label="secondary_market_value",
        amount=95,
        currency="EUR",
        confidence=0.9,
    )
    _candidate(
        conn,
        candidate_id="quick",
        wine_id="wine-1",
        label="quick_sale_estimate",
        amount=70,
        currency="EUR",
    )
    now = datetime.now(UTC).isoformat()
    _profile(
        conn,
        "wine-1",
        {
            valuations.REPLACEMENT_KEY: {
                "value": {"amount": 120, "currency": "EUR"},
                "candidate_id": "replacement",
                "accepted_at": now,
            },
            valuations.SECONDARY_KEY: {
                "value": {"amount": 95, "currency": "EUR"},
                "candidate_id": "secondary",
                "accepted_at": now,
            },
            valuations.QUICK_SALE_KEY: {
                "value": {"amount": 70, "currency": "EUR"},
                "candidate_id": "quick",
                "accepted_at": now,
            },
        },
    )

    assert valuations.sync_wine_valuation(conn, "wine-1") is not None
    wine = repo.get_wine(conn, "wine-1")
    assert wine is not None
    assert wine.market_value == 95
    assert wine.market_value_basis == "secondary_market_value"
    assert wine.market_value_currency == "EUR"
    assert wine.quick_sale_value == 70
    assert wine.quick_sale_currency == "EUR"


def test_manual_value_is_preserved_unless_forced() -> None:
    conn = _conn()
    _wine(
        conn,
        market_value=150,
        market_value_currency="GBP",
        market_value_basis="manual",
        market_value_source="user",
    )
    _candidate(
        conn,
        candidate_id="secondary",
        wine_id="wine-1",
        label="secondary_market_value",
        amount=90,
        currency="EUR",
    )
    now = datetime.now(UTC).isoformat()
    _profile(
        conn,
        "wine-1",
        {
            valuations.SECONDARY_KEY: {
                "value": {"amount": 90, "currency": "EUR"},
                "candidate_id": "secondary",
                "accepted_at": now,
            }
        },
    )

    valuations.sync_wine_valuation(conn, "wine-1", force=False)
    assert repo.get_wine(conn, "wine-1").market_value == 150
    valuations.sync_wine_valuation(conn, "wine-1", force=True)
    wine = repo.get_wine(conn, "wine-1")
    assert wine.market_value == 90
    assert wine.market_value_currency == "EUR"


def test_stats_never_mix_currencies_and_report_coverage() -> None:
    pairs = [
        (
            Wine(
                id="eur",
                producer="A",
                market_value=10,
                market_value_currency="EUR",
                market_value_basis="secondary_market_value",
                quick_sale_value=7,
                quick_sale_currency="EUR",
            ),
            Holding(id="h1", wine_id="eur", quantity=2),
        ),
        (
            Wine(
                id="gbp",
                producer="B",
                market_value=20,
                market_value_currency="GBP",
                market_value_basis="replacement_value",
                quick_sale_value=12,
                quick_sale_currency="GBP",
            ),
            Holding(id="h2", wine_id="gbp", quantity=3),
        ),
        (
            Wine(id="missing", producer="C"),
            Holding(id="h3", wine_id="missing", quantity=4),
        ),
    ]
    stats = compute_stats(pairs)
    assert stats.market_value_by_currency == {"EUR": 20.0, "GBP": 60.0}
    assert stats.quick_sale_value_by_currency == {"EUR": 14.0, "GBP": 36.0}
    assert stats.market_value_mixed_currencies is True
    assert stats.total_value_market == 0.0
    assert stats.market_value_bottles == 5
    assert stats.market_value_missing_bottles == 4
    assert stats.market_value_basis_counts == {
        "secondary_market_value": 2,
        "replacement_value": 3,
    }


def test_single_currency_keeps_legacy_scalar() -> None:
    stats = compute_stats(
        [
            (
                Wine(id="w", producer="A", market_value=12.5, market_value_currency="EUR"),
                Holding(id="h", wine_id="w", quantity=2),
            )
        ]
    )
    assert stats.total_value_market == 25.0
    assert stats.market_value_currency == "EUR"
    assert stats.market_value_mixed_currencies is False
