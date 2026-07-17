"""Synchronize accepted market research with the ordinary Wine fields.

The enrichment profile remains the durable record of every accepted candidate.
The fields on ``Wine`` are a compatibility/read-optimized projection used by
bottle lists and statistics. Secondary-market evidence takes precedence over
retail replacement value; quick-sale estimates are deliberately separate.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.core.domain import Wine
from app.storage import enrichment_repository as er
from app.storage import repositories as repo

SECONDARY_KEY = "market_value:secondary_market_value"
REPLACEMENT_KEY = "market_value:replacement_value"
QUICK_SALE_KEY = "market_value:quick_sale_estimate"
RESEARCH_BASES = {"secondary_market_value", "replacement_value"}


@dataclass(frozen=True)
class AcceptedValuation:
    amount: float
    currency: str
    basis: str
    confidence: float | None
    source: str
    accepted_at: datetime | None


def _parse_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _accepted_value(
    conn: sqlite3.Connection,
    entry: Any,
    *,
    basis: str,
) -> AcceptedValuation | None:
    if not isinstance(entry, dict):
        return None
    value = entry.get("value")
    if not isinstance(value, dict):
        return None
    try:
        amount = float(value["amount"])
    except (KeyError, TypeError, ValueError):
        return None
    if amount <= 0:
        return None
    currency = str(value.get("currency") or "").strip().upper()
    if not currency:
        return None
    candidate_id = entry.get("candidate_id")
    candidate = er.get_candidate(conn, candidate_id) if candidate_id else None
    confidence = None
    source = f"research-profile:{basis}"
    if candidate:
        raw_confidence = candidate.get("confidence")
        confidence = float(raw_confidence) if raw_confidence is not None else None
        source = f"research:{candidate.get('job_id')}:{basis}"
    return AcceptedValuation(
        amount=amount,
        currency=currency,
        basis=basis,
        confidence=confidence,
        source=source,
        accepted_at=_parse_datetime(entry.get("accepted_at")),
    )


def accepted_valuations(
    conn: sqlite3.Connection, wine_id: str
) -> tuple[AcceptedValuation | None, AcceptedValuation | None]:
    profile = er.get_profile(conn, wine_id).get("profile", {})
    secondary = _accepted_value(conn, profile.get(SECONDARY_KEY), basis="secondary_market_value")
    replacement = _accepted_value(conn, profile.get(REPLACEMENT_KEY), basis="replacement_value")
    quick_sale = _accepted_value(conn, profile.get(QUICK_SALE_KEY), basis="quick_sale_estimate")
    return secondary or replacement, quick_sale


def _is_manual_current_value(wine: Wine) -> bool:
    if wine.market_value is None:
        return False
    if wine.market_value_basis in RESEARCH_BASES:
        return False
    return not (wine.market_value_source or "").startswith("research:")


def apply_accepted_valuations(
    conn: sqlite3.Connection,
    wine: Wine,
    *,
    force: bool = False,
) -> bool:
    current, quick_sale = accepted_valuations(conn, wine.id)
    changed = False

    if current is not None and (force or not _is_manual_current_value(wine)):
        desired = (
            current.amount,
            current.currency,
            current.basis,
            current.confidence,
            current.source,
            current.accepted_at,
        )
        existing = (
            wine.market_value,
            wine.market_value_currency,
            wine.market_value_basis,
            wine.market_value_confidence,
            wine.market_value_source,
            wine.market_value_updated_at,
        )
        if desired != existing:
            (
                wine.market_value,
                wine.market_value_currency,
                wine.market_value_basis,
                wine.market_value_confidence,
                wine.market_value_source,
                wine.market_value_updated_at,
            ) = desired
            changed = True

    if quick_sale is not None:
        desired_quick = (
            quick_sale.amount,
            quick_sale.currency,
            quick_sale.confidence,
            quick_sale.source,
            quick_sale.accepted_at,
        )
        existing_quick = (
            wine.quick_sale_value,
            wine.quick_sale_currency,
            wine.quick_sale_confidence,
            wine.quick_sale_source,
            wine.quick_sale_updated_at,
        )
        if desired_quick != existing_quick:
            (
                wine.quick_sale_value,
                wine.quick_sale_currency,
                wine.quick_sale_confidence,
                wine.quick_sale_source,
                wine.quick_sale_updated_at,
            ) = desired_quick
            changed = True

    return changed


def sync_wine_valuation(
    conn: sqlite3.Connection,
    wine_id: str,
    *,
    force: bool = False,
) -> Wine | None:
    wine = repo.get_wine(conn, wine_id)
    if wine is None:
        return None
    expected_version = wine.version
    if apply_accepted_valuations(conn, wine, force=force):
        repo.update_wine(conn, wine, expected_version=expected_version)
    return wine


def backfill_accepted_market_valuations(conn: sqlite3.Connection) -> int:
    rows = conn.execute("SELECT wine_id FROM wine_enrichment_profiles").fetchall()
    changed = 0
    for row in rows:
        wine = repo.get_wine(conn, row["wine_id"])
        if wine is None:
            continue
        expected_version = wine.version
        if apply_accepted_valuations(conn, wine, force=False):
            repo.update_wine(conn, wine, expected_version=expected_version)
            changed += 1
    return changed
