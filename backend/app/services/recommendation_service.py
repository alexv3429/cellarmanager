"""Explainable "which wine should I open?" recommendations.

Cellar, color, vintage, appellation and date remain hard filters. Dish and
occasion normally influence ranking rather than eliminating otherwise valid
bottles. Accepted evidence-backed enrichment profiles are used when available;
plain user-entered advice remains a supported fallback.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from app.core.domain import Holding, Wine

_STOPWORDS = {
    "the",
    "a",
    "an",
    "with",
    "and",
    "or",
    "of",
    "for",
    "to",
    "in",
    "on",
    "avec",
    "et",
    "ou",
    "de",
    "du",
    "des",
    "le",
    "la",
    "les",
    "un",
    "une",
    "pour",
    "au",
    "aux",
}

_OCCASION_ALIASES = {
    "casual": {"casual", "relaxed", "simple", "decontracte", "informal"},
    "everyday": {"everyday", "daily", "weeknight", "quotidien", "semaine"},
    "important": {"important", "formal", "special", "elegant", "prestige"},
    "celebration": {
        "celebration",
        "celebrate",
        "festive",
        "birthday",
        "wedding",
        "anniversaire",
        "mariage",
        "fete",
    },
    "discovery": {"discovery", "discover", "unusual", "decouverte", "original"},
}

_DISH_CATEGORY_ALIASES = {
    "meat": {
        "beef",
        "steak",
        "lamb",
        "duck",
        "pork",
        "veal",
        "boeuf",
        "agneau",
        "canard",
        "porc",
        "viande",
    },
    "fish": {
        "fish",
        "salmon",
        "tuna",
        "shellfish",
        "poisson",
        "saumon",
        "thon",
        "crustace",
    },
    "vegetarian": {
        "vegetarian",
        "vegetable",
        "mushroom",
        "legume",
        "champignon",
        "vegan",
    },
    "cheese": {"cheese", "fromage"},
    "dessert": {"dessert", "chocolate", "cake", "chocolat", "gateau"},
    "casual": {"pizza", "burger", "barbecue", "bbq", "tapas"},
}


def _tokenize(text: str) -> set[str]:
    normalized = unicodedata.normalize("NFKD", text.lower())
    normalized = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    tokens = re.findall(r"[a-z0-9]+", normalized)
    return {token for token in tokens if token not in _STOPWORDS and len(token) > 1}


def _canonical_occasion(value: str | None) -> str | None:
    tokens = _tokenize(value or "")
    for occasion, aliases in _OCCASION_ALIASES.items():
        if occasion in tokens or tokens & aliases:
            return occasion
    return None


def _dish_categories(tokens: set[str]) -> set[str]:
    return {category for category, aliases in _DISH_CATEGORY_ALIASES.items() if tokens & aliases}


def _profile_value(profile: dict[str, Any], key: str, default: Any = None) -> Any:
    item = profile.get(key)
    if not isinstance(item, dict):
        return default
    return item.get("value", default)


def _accepted_pairings(profile: dict[str, Any]) -> list[dict[str, Any]]:
    value = _profile_value(profile, "pairing:dish_pairings", [])
    return value if isinstance(value, list) else []


def _market_amount(profile: dict[str, Any], wine: Wine) -> float | None:
    value = _profile_value(profile, "market_value:replacement_value", {})
    if isinstance(value, dict) and value.get("amount") is not None:
        try:
            return float(value["amount"])
        except (TypeError, ValueError):
            pass
    return wine.market_value


def _best_review_ratio(profile: dict[str, Any]) -> float | None:
    reviews = _profile_value(profile, "reviews:critical_reviews", [])
    ratios = []
    for review in reviews if isinstance(reviews, list) else []:
        score = review.get("score")
        scale = review.get("scale") or 100
        if score is None:
            continue
        try:
            ratios.append(float(score) / float(scale))
        except (TypeError, ValueError, ZeroDivisionError):
            continue
    return max(ratios) if ratios else None


@dataclass
class RecommendationCriteria:
    cellar_id: str | None = None
    color: str | None = None
    vintage: int | None = None
    vintage_before: int | None = None
    vintage_after: int | None = None
    appellation: str | None = None
    on_date: date | None = None
    dish: str | None = None
    mood: str | None = None
    strict_text_match: bool = False


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
    today: date | None = None,
    limit: int = 20,
    enrichment_profiles: dict[str, dict[str, Any]] | None = None,
    diagnostics: dict[str, Any] | None = None,
) -> list[Recommendation]:
    today = today or date.today()
    profiles = enrichment_profiles or {}
    dish_tokens = _tokenize(criteria.dish) if criteria.dish else set()
    requested_dish_categories = _dish_categories(dish_tokens)
    mood_tokens = _tokenize(criteria.mood) if criteria.mood else set()
    occasion = _canonical_occasion(criteria.mood)
    counts: dict[str, int] = {
        "examined": 0,
        "eligible": 0,
        "returned": 0,
        "rejected_inactive": 0,
        "rejected_cellar": 0,
        "rejected_color": 0,
        "rejected_vintage": 0,
        "rejected_appellation": 0,
        "rejected_drinking_window": 0,
        "rejected_strict_dish": 0,
    }

    def reject(reason: str) -> None:
        key = f"rejected_{reason}"
        counts[key] = counts.get(key, 0) + 1

    results: list[Recommendation] = []
    for holding, wine in holdings_with_wines:
        counts["examined"] += 1
        if holding.quantity <= 0 or holding.state != "in_cellar":
            reject("inactive")
            continue
        if criteria.cellar_id and holding.cellar_id != criteria.cellar_id:
            reject("cellar")
            continue
        if criteria.color and wine.color != criteria.color:
            reject("color")
            continue
        if criteria.vintage is not None and wine.vintage != criteria.vintage:
            reject("vintage")
            continue
        if criteria.vintage_before is not None:
            if wine.vintage is None or wine.vintage > criteria.vintage_before:
                reject("vintage")
                continue
        if criteria.vintage_after is not None:
            if wine.vintage is None or wine.vintage < criteria.vintage_after:
                reject("vintage")
                continue
        if criteria.appellation and (
            not wine.appellation
            or criteria.appellation.strip().lower() not in wine.appellation.lower()
        ):
            reject("appellation")
            continue
        if criteria.on_date and wine.drink_after and criteria.on_date < wine.drink_after:
            reject("drinking_window")
            continue
        if criteria.on_date and wine.drink_before and criteria.on_date > wine.drink_before:
            reject("drinking_window")
            continue

        profile = profiles.get(wine.id, {})
        score = 0.0
        reasons: list[str] = []

        pairings = _accepted_pairings(profile)
        pairing_text = " ".join(
            f"{item.get('dish', '')} {item.get('category', '')} {item.get('rationale', '')}"
            for item in pairings
        )
        dish_target = _tokenize(f"{wine.advice_pairing or ''} {pairing_text}")
        dish_overlap = dish_tokens & dish_target
        pairing_categories = {
            str(item.get("category")) for item in pairings if item.get("category")
        }
        category_overlap = requested_dish_categories & pairing_categories
        if dish_overlap:
            score += 3.0 * len(dish_overlap)
            reasons.append(f"matches dish terms: {', '.join(sorted(dish_overlap))}")
        if category_overlap:
            score += 2.5 * len(category_overlap)
            reasons.append(f"matches pairing category: {', '.join(sorted(category_overlap))}")

        mood_target = _tokenize(f"{wine.advice_experience or ''} {wine.notes or ''} {pairing_text}")
        mood_overlap = mood_tokens & mood_target
        if mood_overlap:
            score += 2.0 * len(mood_overlap)
            reasons.append(f"matches occasion terms: {', '.join(sorted(mood_overlap))}")

        if occasion in {"casual", "everyday"}:
            amount = _market_amount(profile, wine)
            if amount is not None and amount <= 40:
                score += 1.25
                reasons.append("sensible value for an informal occasion")
            if holding.quantity >= 2:
                score += 1.0
                reasons.append("several bottles are available")
            maturity = _profile_value(profile, "maturity:maturity", {})
            if isinstance(maturity, dict) and maturity.get("state") in {
                "ready",
                "drink_soon",
                "approaching_window",
            }:
                score += 1.0
                reasons.append("maturity suits drinking now")
            if "casual" in pairing_categories:
                score += 1.5
                reasons.append("accepted pairing data marks it as casual-friendly")
        elif occasion in {"important", "celebration"}:
            amount = _market_amount(profile, wine)
            if amount is not None and amount >= 45:
                score += 1.0
                reasons.append("value is consistent with a special bottle")
            review_ratio = _best_review_ratio(profile)
            if review_ratio is not None and review_ratio >= 0.9:
                score += 1.25
                reasons.append("strong accepted critical score")
            if "celebration" in pairing_categories:
                score += 1.5
                reasons.append("accepted pairing data suits a celebration")
        elif occasion == "discovery":
            composition = _profile_value(profile, "composition:composition", {})
            if isinstance(composition, dict) and composition.get("grapes"):
                score += 1.0
                reasons.append("enriched composition makes it a good discovery choice")
            if wine.color in {"orange", "fortified", "other"}:
                score += 1.0
                reasons.append("unusual style for discovery")
            if "regional" in pairing_categories:
                score += 0.75
                reasons.append("regional pairing information is available")

        if criteria.strict_text_match and dish_tokens and not (dish_overlap or category_overlap):
            reject("strict_dish")
            continue

        if wine.drink_before:
            days_left = (wine.drink_before - today).days
            if days_left < 0:
                score += 1.5
                reasons.append("past its 'drink before' date")
            elif days_left < 180:
                score += 1.0
                reasons.append("best enjoyed soon")

        if not reasons:
            reasons.append("matches your cellar and wine filters")

        counts["eligible"] += 1
        results.append(Recommendation(wine=wine, holding=holding, score=score, reasons=reasons))

    def sort_key(result: Recommendation):
        urgency = 0
        if result.wine.drink_before:
            urgency = -(result.wine.drink_before - today).days
        return (-result.score, -urgency, result.wine.producer.lower())

    results.sort(key=sort_key)
    selected = results[:limit]
    counts["returned"] = len(selected)
    if diagnostics is not None:
        diagnostics.clear()
        diagnostics.update(counts)
    return selected
