""""Which wine should I open?" recommendation engine (requirement 10.a).

Hard filters (cellar, color, vintage, appellation, drink-window) narrow the
candidate list first; a simple bag-of-words keyword overlap then scores
free-text criteria (dish, mood) against each wine's advice fields. This is
plain, explainable information retrieval - not a claimed "AI sommelier" -
and every result carries the reasons it matched so the ranking is never a
black box.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date
from typing import Optional

from app.core.domain import Cellar, Holding, Wine

_STOPWORDS = {
    "the", "a", "an", "with", "and", "or", "of", "for", "to", "in", "on", "avec", "et", "ou",
    "de", "du", "des", "le", "la", "les", "un", "une", "pour", "au", "aux",
}


def _tokenize(text: str) -> set[str]:
    normalized = unicodedata.normalize("NFKD", text.lower())
    normalized = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    tokens = re.findall(r"[a-z0-9]+", normalized)
    return {t for t in tokens if t not in _STOPWORDS and len(t) > 1}


@dataclass
class RecommendationCriteria:
    cellar_id: Optional[str] = None
    color: Optional[str] = None
    vintage: Optional[int] = None
    vintage_before: Optional[int] = None  # e.g. "2015 or older"
    vintage_after: Optional[int] = None
    appellation: Optional[str] = None
    on_date: Optional[date] = None  # must be inside the wine's drink window (if the wine has one)
    dish: Optional[str] = None
    mood: Optional[str] = None


@dataclass
class Recommendation:
    wine: Wine
    holding: Holding
    score: float
    reasons: list[str] = field(default_factory=list)


def recommend_wines(
    holdings_with_wines: list[tuple[Holding, Wine]],
    criteria: RecommendationCriteria,
    *,
    today: Optional[date] = None,
    limit: int = 20,
) -> list[Recommendation]:
    today = today or date.today()
    dish_tokens = _tokenize(criteria.dish) if criteria.dish else set()
    mood_tokens = _tokenize(criteria.mood) if criteria.mood else set()

    results: list[Recommendation] = []
    for holding, wine in holdings_with_wines:
        if holding.quantity <= 0 or holding.state != "in_cellar":
            continue
        if criteria.cellar_id and holding.cellar_id != criteria.cellar_id:
            continue
        if criteria.color and wine.color != criteria.color:
            continue
        if criteria.vintage is not None and wine.vintage != criteria.vintage:
            continue
        if criteria.vintage_before is not None and (wine.vintage or 0) > criteria.vintage_before:
            continue
        if criteria.vintage_after is not None and (wine.vintage or 9999) < criteria.vintage_after:
            continue
        if criteria.appellation and (not wine.appellation or criteria.appellation.strip().lower() not in wine.appellation.lower()):
            continue
        if criteria.on_date and wine.drink_after and criteria.on_date < wine.drink_after:
            continue
        if criteria.on_date and wine.drink_before and criteria.on_date > wine.drink_before:
            continue

        score = 0.0
        reasons: list[str] = []

        if dish_tokens:
            target = _tokenize(wine.advice_pairing or "")
            overlap = dish_tokens & target
            if overlap:
                score += 3.0 * len(overlap)
                reasons.append(f"matches dish keywords: {', '.join(sorted(overlap))}")
        if mood_tokens:
            target = _tokenize(f"{wine.advice_experience or ''} {wine.notes or ''}")
            overlap = mood_tokens & target
            if overlap:
                score += 2.0 * len(overlap)
                reasons.append(f"matches mood keywords: {', '.join(sorted(overlap))}")

        # Gentle nudge for wines that are urgent to drink, so they surface
        # even without a dish/mood query.
        if wine.drink_before:
            days_left = (wine.drink_before - today).days
            if days_left < 0:
                score += 1.5
                reasons.append("past its 'drink before' date")
            elif days_left < 180:
                score += 1.0
                reasons.append("best enjoyed soon")

        if not dish_tokens and not mood_tokens and not reasons:
            reasons.append("matches your filters")

        results.append(Recommendation(wine=wine, holding=holding, score=score, reasons=reasons))

    def sort_key(r: Recommendation):
        urgency = 0
        if r.wine.drink_before:
            urgency = -(r.wine.drink_before - today).days
        return (-r.score, -urgency, r.wine.producer.lower())

    results.sort(key=sort_key)
    return results[:limit]
