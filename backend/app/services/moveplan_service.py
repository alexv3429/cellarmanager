"""Explainable, capacity-aware cellar movement planning.

Cellar purpose uses the same 0..10 scale as drinking readiness. The planner
preserves a legitimate level 0 (pure aging), can suggest partial moves when a
destination has only some free slots, and adds a small diversity penalty so a
service cellar is not filled with one color/area/appellation by accident.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import date
from typing import Optional

from app.core.domain import Cellar, Holding, Wine

DEFAULT_MISMATCH_TOLERANCE = 3.0
NEUTRAL_READINESS = 5.0
UNLIMITED_CAPACITY = 10**9


@dataclass
class MoveStep:
    holding_id: str
    wine_id: str
    wine_label: str
    quantity: int
    from_cellar_id: Optional[str]
    from_cellar_name: str
    to_cellar_id: str
    to_cellar_name: str
    readiness: float
    reason: str


@dataclass
class MovePlanResult:
    steps: list[MoveStep] = field(default_factory=list)
    cellars_over_threshold: list[str] = field(default_factory=list)
    unplaceable: list[str] = field(default_factory=list)


@dataclass
class Readiness:
    score: float
    reason: str
    has_signal: bool


def cellar_level(cellar: Cellar) -> float:
    """Return the configured level without treating valid zero as false."""
    return NEUTRAL_READINESS if cellar.purpose_level is None else float(cellar.purpose_level)


def compute_readiness(wine: Wine, *, today: Optional[date] = None) -> Readiness:
    today = today or date.today()
    after, before = wine.drink_after, wine.drink_before

    if before and before < today:
        return Readiness(10.0, "past its 'drink before' date - drink soon", True)
    if after and before and after <= before:
        span = (before - after).days or 1
        elapsed = (today - after).days
        score = max(0.0, min(10.0, 10.0 * elapsed / span))
        return Readiness(score, "in its drinking window", True)
    if before:
        days_left = (before - today).days
        if days_left <= 365:
            return Readiness(9.0, "'drink before' date is approaching", True)
        return Readiness(6.0, "has a 'drink before' date but still time", True)
    if after:
        days_away = (after - today).days
        if days_away > 730:
            return Readiness(0.0, "needs significant further aging", True)
        if days_away > 0:
            return Readiness(3.0, "not ready yet", True)
        return Readiness(8.0, "past its 'drink after' date", True)
    return Readiness(
        NEUTRAL_READINESS,
        "no drinking-window dates on file - using a neutral default",
        False,
    )


def _wine_label(wine: Wine) -> str:
    bits = [wine.producer]
    if wine.cuvee:
        bits.append(wine.cuvee)
    if wine.vintage:
        bits.append(str(wine.vintage))
    return " ".join(bits)


def _vintage_bucket(vintage: Optional[int]) -> str:
    return "NV" if vintage is None else f"{vintage // 5 * 5}-{vintage // 5 * 5 + 4}"


def suggest_move_plan(
    cellars: list[Cellar],
    holdings_with_wines: list[tuple[Holding, Wine]],
    *,
    today: Optional[date] = None,
    mismatch_tolerance: float = DEFAULT_MISMATCH_TOLERANCE,
) -> MovePlanResult:
    today = today or date.today()
    result = MovePlanResult()

    cellars_by_id = {cellar.id: cellar for cellar in cellars}
    real_cellars = [cellar for cellar in cellars if not cellar.is_overflow]
    fill: dict[str, int] = {cellar.id: 0 for cellar in cellars}
    mix: dict[str, dict[str, Counter]] = {
        cellar.id: {
            "color": Counter(),
            "area": Counter(),
            "appellation": Counter(),
            "vintage": Counter(),
        }
        for cellar in cellars
    }

    for holding, wine in holdings_with_wines:
        if not holding.cellar_id or holding.quantity <= 0 or holding.state != "in_cellar":
            continue
        fill[holding.cellar_id] = fill.get(holding.cellar_id, 0) + holding.quantity
        if holding.cellar_id in mix:
            mix[holding.cellar_id]["color"][wine.color or "other"] += holding.quantity
            mix[holding.cellar_id]["area"][wine.area or "unknown"] += holding.quantity
            mix[holding.cellar_id]["appellation"][wine.appellation or "unknown"] += holding.quantity
            mix[holding.cellar_id]["vintage"][_vintage_bucket(wine.vintage)] += holding.quantity

    for cellar in real_cellars:
        if cellar.threshold and fill.get(cellar.id, 0) > cellar.threshold:
            result.cellars_over_threshold.append(cellar.name)

    def remaining_capacity(cellar_id: str) -> int:
        cellar = cellars_by_id[cellar_id]
        if cellar.max_capacity <= 0:
            return UNLIMITED_CAPACITY
        return max(0, cellar.max_capacity - fill.get(cellar_id, 0))

    candidates = []
    for holding, wine in holdings_with_wines:
        if (
            holding.quantity <= 0
            or holding.state != "in_cellar"
            or not holding.cellar_id
        ):
            continue
        current = cellars_by_id.get(holding.cellar_id)
        if current is None:
            continue
        readiness = compute_readiness(wine, today=today)
        if current.is_overflow:
            candidates.append((holding, wine, readiness, True, float("inf")))
            continue
        mismatch = abs(cellar_level(current) - readiness.score)
        over_threshold = bool(current.threshold) and fill.get(current.id, 0) > current.threshold
        if (readiness.has_signal and mismatch > mismatch_tolerance) or over_threshold:
            candidates.append((holding, wine, readiness, False, mismatch))

    # Highest purpose/readiness mismatch first, but interleave colors to preserve mix.
    candidates.sort(key=lambda item: -item[4])
    by_color: dict[str, list] = {}
    for item in candidates:
        by_color.setdefault(item[1].color or "other", []).append(item)
    ordered = []
    while any(by_color.values()):
        for color in sorted(by_color):
            if by_color[color]:
                ordered.append(by_color[color].pop(0))

    for holding, wine, readiness, from_overflow, _mismatch in ordered:
        source = cellars_by_id.get(holding.cellar_id)
        source_overage = 0
        if source and source.threshold:
            source_overage = max(0, fill.get(source.id, 0) - source.threshold)

        destinations = []
        for cellar in real_cellars:
            if cellar.id == holding.cellar_id:
                continue
            capacity = remaining_capacity(cellar.id)
            if capacity <= 0:
                continue
            purpose_gap = abs(cellar_level(cellar) - readiness.score)
            destination_total = max(1, fill.get(cellar.id, 0))
            diversity_penalty = (
                mix[cellar.id]["color"][wine.color or "other"] / destination_total * 0.8
                + mix[cellar.id]["area"][wine.area or "unknown"] / destination_total * 0.35
                + mix[cellar.id]["appellation"][wine.appellation or "unknown"] / destination_total * 0.35
                + mix[cellar.id]["vintage"][_vintage_bucket(wine.vintage)] / destination_total * 0.2
            )
            destinations.append((purpose_gap + diversity_penalty, cellar, capacity))

        if not destinations:
            result.unplaceable.append(
                f"{_wine_label(wine)}: no cellar has room to receive it right now "
                f"({readiness.reason})."
            )
            continue

        destinations.sort(key=lambda item: (item[0], -item[2], item[1].name.lower()))
        _score, destination, capacity = destinations[0]
        quantity = min(holding.quantity, capacity)
        # If this candidate exists only because the source is over threshold,
        # move just enough to get below the threshold where possible.
        if source_overage > 0 and not readiness.has_signal and not from_overflow:
            quantity = min(quantity, source_overage)
        if quantity <= 0:
            continue

        reason = readiness.reason
        if from_overflow:
            reason = "currently in overflow storage, " + reason
        if quantity < holding.quantity:
            reason += f"; partial move because only {quantity} slot(s) are available"

        result.steps.append(
            MoveStep(
                holding_id=holding.id,
                wine_id=wine.id,
                wine_label=_wine_label(wine),
                quantity=quantity,
                from_cellar_id=holding.cellar_id,
                from_cellar_name=source.name if source else "?",
                to_cellar_id=destination.id,
                to_cellar_name=destination.name,
                readiness=round(readiness.score, 1),
                reason=reason,
            )
        )
        fill[holding.cellar_id] = fill.get(holding.cellar_id, 0) - quantity
        fill[destination.id] = fill.get(destination.id, 0) + quantity
        mix[destination.id]["color"][wine.color or "other"] += quantity
        mix[destination.id]["area"][wine.area or "unknown"] += quantity
        mix[destination.id]["appellation"][wine.appellation or "unknown"] += quantity
        mix[destination.id]["vintage"][_vintage_bucket(wine.vintage)] += quantity

    return result
