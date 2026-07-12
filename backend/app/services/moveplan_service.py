"""Move-plan advisor (requirement 5.e).

The algorithm is a deterministic heuristic, not machine learning - it is
meant to be explainable ("this bottle moved because...") and unit-testable,
not a black box:

1. Each cellar has a ``purpose_level`` from 0 (pure aging) to 10 (pure
   service); overflow cellars sit outside that scale and are treated as a
   last resort, to be emptied into a "real" cellar whenever room exists.
2. Each holding gets a "readiness" score on the same 0-10 scale, derived
   from its wine's drink-after/drink-before window relative to today (or a
   neutral default of 5 if no dates are known at all).
3. A holding is a move *candidate* when its cellar's purpose_level is far
   from its readiness score (it "doesn't belong there"), or its current
   cellar is over its alert threshold and needs to offload something.
4. Candidates are assigned to the cellar whose purpose_level is closest to
   their readiness score, among cellars with spare capacity, picked in a
   round-robin across wine colors so a service cellar doesn't fill up with
   a single color if several are competing for the same space.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Optional

from app.core.domain import Cellar, Holding, Wine

DEFAULT_MISMATCH_TOLERANCE = 3.0
NEUTRAL_READINESS = 5.0


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
    unplaceable: list[str] = field(default_factory=list)  # human-readable notes


@dataclass
class Readiness:
    score: float  # 0-10
    reason: str
    has_signal: bool  # False when this is a neutral default, not derived from real dates


def compute_readiness(wine: Wine, *, today: Optional[date] = None) -> Readiness:
    """Return a 0-10 readiness score (10 = should be in a service cellar
    now/soon; 0 = should be resting in an aging cellar) plus whether that
    score is backed by real drink-window data. A wine with no dates at all
    gets a neutral score but `has_signal=False`, so the move-plan doesn't
    shuffle bottles around based on a guess it has no real basis for -
    only an over-capacity cellar can trigger a move for such bottles."""
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
    return Readiness(NEUTRAL_READINESS, "no drinking-window dates on file - using a neutral default", False)


def _wine_label(wine: Wine) -> str:
    bits = [wine.producer]
    if wine.cuvee:
        bits.append(wine.cuvee)
    if wine.vintage:
        bits.append(str(wine.vintage))
    return " ".join(bits)


def suggest_move_plan(
    cellars: list[Cellar],
    holdings_with_wines: list[tuple[Holding, Wine]],
    *,
    today: Optional[date] = None,
    mismatch_tolerance: float = DEFAULT_MISMATCH_TOLERANCE,
) -> MovePlanResult:
    today = today or date.today()
    result = MovePlanResult()

    cellars_by_id = {c.id: c for c in cellars}
    real_cellars = [c for c in cellars if not c.is_overflow]
    fill: dict[str, int] = {c.id: 0 for c in cellars}
    for holding, _wine in holdings_with_wines:
        if holding.cellar_id and holding.quantity > 0:
            fill[holding.cellar_id] = fill.get(holding.cellar_id, 0) + holding.quantity

    for c in real_cellars:
        if c.threshold and fill.get(c.id, 0) > c.threshold:
            result.cellars_over_threshold.append(c.name)

    def remaining_capacity(cellar_id: str) -> int:
        c = cellars_by_id[cellar_id]
        if c.max_capacity <= 0:
            return 10 ** 6  # uncapped
        return max(0, c.max_capacity - fill.get(cellar_id, 0))

    candidates = []
    for holding, wine in holdings_with_wines:
        if holding.quantity <= 0 or not holding.cellar_id:
            continue
        current_cellar = cellars_by_id.get(holding.cellar_id)
        if current_cellar is None:
            continue
        readiness = compute_readiness(wine, today=today)
        if current_cellar.is_overflow:
            candidates.append((holding, wine, readiness.score, readiness.reason, True))
            continue
        mismatch = abs((current_cellar.purpose_level or NEUTRAL_READINESS) - readiness.score)
        over_threshold = bool(current_cellar.threshold) and fill.get(current_cellar.id, 0) > current_cellar.threshold
        # A bottle with no real drink-window data (has_signal=False) sits at a
        # neutral default score - that is an absence of information, not a
        # reason to move it. Only a genuinely over-capacity cellar should
        # dislodge it; a purpose-level "mismatch" against the neutral default
        # is not real signal.
        if (readiness.has_signal and mismatch > mismatch_tolerance) or over_threshold:
            candidates.append((holding, wine, readiness.score, readiness.reason, False))

    # Round-robin by color so limited space isn't monopolized by one color.
    candidates.sort(key=lambda item: -abs((cellars_by_id[item[0].cellar_id].purpose_level or NEUTRAL_READINESS) - item[2]))
    by_color: dict[str, list] = {}
    for item in candidates:
        by_color.setdefault(item[1].color, []).append(item)
    ordered = []
    while any(by_color.values()):
        for color in list(by_color.keys()):
            if by_color[color]:
                ordered.append(by_color[color].pop(0))

    for holding, wine, readiness, reason, from_overflow in ordered:
        best_cellar = None
        best_gap = None
        for c in real_cellars:
            if c.id == holding.cellar_id:
                continue
            if remaining_capacity(c.id) < holding.quantity:
                continue
            gap = abs((c.purpose_level or NEUTRAL_READINESS) - readiness)
            if best_gap is None or gap < best_gap:
                best_gap = gap
                best_cellar = c
        if best_cellar is None:
            result.unplaceable.append(
                f"{_wine_label(wine)}: no cellar has room to receive it right now ({reason})."
            )
            continue

        from_cellar = cellars_by_id.get(holding.cellar_id)
        result.steps.append(MoveStep(
            holding_id=holding.id, wine_id=wine.id, wine_label=_wine_label(wine),
            quantity=holding.quantity,
            from_cellar_id=holding.cellar_id, from_cellar_name=from_cellar.name if from_cellar else "?",
            to_cellar_id=best_cellar.id, to_cellar_name=best_cellar.name,
            readiness=round(readiness, 1),
            reason=("currently in overflow storage, " if from_overflow else "") + reason,
        ))
        fill[holding.cellar_id] = fill.get(holding.cellar_id, 0) - holding.quantity
        fill[best_cellar.id] = fill.get(best_cellar.id, 0) + holding.quantity

    return result
