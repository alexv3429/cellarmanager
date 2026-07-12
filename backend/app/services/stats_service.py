"""Cellar statistics (requirement 5.d).

All functions take already-fetched (Wine, Holding) pairs rather than a
database connection, so the aggregation logic itself is pure and trivial to
unit test with hand-built fixtures. The API layer is responsible for the one
query that joins holdings to wines (see ``repositories.list_holdings_with_wines``).
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import date
from typing import Optional

from app.core.domain import Holding, Wine


@dataclass
class Breakdown:
    counts: dict[str, int] = field(default_factory=dict)
    percentages: dict[str, float] = field(default_factory=dict)


@dataclass
class DrinkWindowBuckets:
    overdue: int = 0          # drink_before has passed
    ready_now: int = 0        # inside [drink_after, drink_before] today, or no drink_after set and drink_before is far off
    not_ready_yet: int = 0    # drink_after is in the future
    no_date_info: int = 0


@dataclass
class StatsResult:
    total_bottles: int = 0
    distinct_wines: int = 0
    by_color: Breakdown = field(default_factory=Breakdown)
    by_vintage: Breakdown = field(default_factory=Breakdown)
    by_area: Breakdown = field(default_factory=Breakdown)
    by_appellation: Breakdown = field(default_factory=Breakdown)
    total_value_bought: float = 0.0
    total_value_market: float = 0.0
    drink_window: DrinkWindowBuckets = field(default_factory=DrinkWindowBuckets)


def _breakdown(counter: Counter, total: int) -> Breakdown:
    counts = dict(counter)
    pct = {k: round(100.0 * v / total, 1) for k, v in counts.items()} if total else {}
    return Breakdown(counts=counts, percentages=pct)


def compute_stats(pairs: list[tuple[Wine, Holding]], *, today: Optional[date] = None) -> StatsResult:
    """`pairs` can be any (wine, holding) pairs you have handy - e.g. every
    holding in a cellar regardless of state. This function itself narrows to
    holdings that are actually ``in_cellar`` right now, since "how many
    bottles do I have" should never count ones already gifted/sold/lost/
    drunk/broken (those still carry a positive quantity on their own
    removal-holding row, by design, so the journal keeps full history)."""
    today = today or date.today()
    result = StatsResult()
    color_counter: Counter = Counter()
    vintage_counter: Counter = Counter()
    area_counter: Counter = Counter()
    appellation_counter: Counter = Counter()
    wine_ids_seen: set[str] = set()

    for wine, holding in pairs:
        qty = holding.quantity
        if qty <= 0 or holding.state != "in_cellar":
            continue
        result.total_bottles += qty
        wine_ids_seen.add(wine.id)
        color_counter[wine.color] += qty
        vintage_counter[str(wine.vintage) if wine.vintage else "NV"] += qty
        if wine.area:
            area_counter[wine.area] += qty
        if wine.appellation:
            appellation_counter[wine.appellation] += qty
        if holding.price_bought is not None:
            result.total_value_bought += holding.price_bought * qty
        if wine.market_value is not None:
            result.total_value_market += wine.market_value * qty

        if wine.drink_before and wine.drink_before < today:
            result.drink_window.overdue += qty
        elif wine.drink_after and wine.drink_after > today:
            result.drink_window.not_ready_yet += qty
        elif wine.drink_before or wine.drink_after:
            result.drink_window.ready_now += qty
        else:
            result.drink_window.no_date_info += qty

    result.distinct_wines = len(wine_ids_seen)
    result.by_color = _breakdown(color_counter, result.total_bottles)
    result.by_vintage = _breakdown(vintage_counter, result.total_bottles)
    result.by_area = _breakdown(area_counter, result.total_bottles)
    result.by_appellation = _breakdown(appellation_counter, result.total_bottles)
    result.total_value_bought = round(result.total_value_bought, 2)
    result.total_value_market = round(result.total_value_market, 2)
    return result


def compute_stats_per_cellar(
    pairs_by_cellar: dict[Optional[str], list[tuple[Wine, Holding]]], *, today: Optional[date] = None
) -> dict[Optional[str], StatsResult]:
    return {cellar_id: compute_stats(pairs, today=today) for cellar_id, pairs in pairs_by_cellar.items()}
