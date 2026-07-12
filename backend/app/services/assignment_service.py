"""Assign active unassigned holdings to cellars using location rules.

CSV imports may happen before any cellar exists. In that case the holding keeps
its physical location text but has no ``cellar_id`` yet. This service makes that
state visible and safely reconciles it when cellars/rules are added later.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from app.core.domain import HoldingState
from app.services import cellar_rules, holdings_service
from app.storage import repositories as repo


@dataclass
class ReconciliationResult:
    assigned_holdings: int = 0
    assigned_bottles: int = 0
    remaining_holdings: int = 0
    remaining_bottles: int = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "assigned_holdings": self.assigned_holdings,
            "assigned_bottles": self.assigned_bottles,
            "remaining_holdings": self.remaining_holdings,
            "remaining_bottles": self.remaining_bottles,
        }


def _unassigned_active_holdings(conn):
    return [
        holding
        for holding in repo.list_holdings(
            conn,
            state=HoldingState.IN_CELLAR.value,
            active_only=True,
        )
        if holding.cellar_id is None
    ]


def unassigned_summary(conn) -> dict[str, int]:
    holdings = _unassigned_active_holdings(conn)
    with_location = [holding for holding in holdings if (holding.location or "").strip()]
    return {
        "holdings": len(holdings),
        "bottles": sum(holding.quantity for holding in holdings),
        "with_location_holdings": len(with_location),
        "with_location_bottles": sum(holding.quantity for holding in with_location),
    }


def reconcile_unassigned(
    conn,
    *,
    user_id: Optional[str],
    only_cellar_id: Optional[str] = None,
) -> ReconciliationResult:
    """Move every matchable unassigned holding to its rule-selected cellar.

    Matching is always evaluated against *all* cellars so the normal
    longest-rule-wins behavior is preserved. ``only_cellar_id`` limits which
    selected destination is applied; it is used after creating/editing one
    cellar so unrelated holdings are not unexpectedly moved.
    """
    result = ReconciliationResult()
    cellars = repo.list_cellars(conn)

    for holding in _unassigned_active_holdings(conn):
        location = (holding.location or "").strip()
        if not location:
            continue
        matched = cellar_rules.match_cellar_for_location(location, cellars)
        if matched is None:
            continue
        if only_cellar_id is not None and matched.id != only_cellar_id:
            continue

        quantity = holding.quantity
        holdings_service.move_bottles(
            conn,
            holding_id=holding.id,
            quantity=quantity,
            to_cellar_id=matched.id,
            to_location=holding.location,
            user_id=user_id,
            note="Automatic assignment from cellar location rule",
            expected_version=holding.version,
        )
        result.assigned_holdings += 1
        result.assigned_bottles += quantity

    remaining = _unassigned_active_holdings(conn)
    result.remaining_holdings = len(remaining)
    result.remaining_bottles = sum(holding.quantity for holding in remaining)
    return result
