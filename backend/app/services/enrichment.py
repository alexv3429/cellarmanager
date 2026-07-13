"""Fetching drinking-window dates, market value, and tasting advice, with a
confidence score, compared against whatever is already on file
(requirement 5.f / 5.g).

Per feedback, this does not ask you to pick one data source: it fetches
from every registered provider and computes a single "best window" /
"best value" by combining them - weighting each source by its own
confidence, and adjusting the combined confidence up when independent
sources agree closely, or down when they disagree. That combined estimate
is then compared against whatever is already on the wine record using the
same "never silently overwrite a manual value" rule as before.

IMPORTANT / honesty note: the multi-source *fetch-and-combine mechanism*
below is real, complete code with full test coverage. What's still a
placeholder is the data underneath: this ships with several
``MockEnrichmentProvider`` instances (different simulated "profiles" so the
aggregation logic has something realistic - and disagreeing - to combine),
not real internet-connected sources. Real wine data sites (Wine-Searcher,
iDealwine, Vivino, CellarTracker...) each have their own terms of service,
some require a paid/licensed API, and scraping HTML directly is fragile and
may violate those terms - picking which ones to use is a decision (and
possibly a contract) for you to make, not a default this codebase should
bake in. To go live: implement ``EnrichmentProvider`` (two methods) against
each source you're licensed to use, and list them in
``get_active_providers()`` below - the aggregation, merge, and journal
logic already works for any number of providers, real or mock.
"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date

from app.core.domain import Wine, utcnow

MANUAL_CONFIDENCE = 1.0

# Sources agreeing within this many days of each other are treated as
# "essentially in agreement" and do not erode combined confidence.
AGREEMENT_TOLERANCE_DAYS = 180.0
# Sources agreeing within this relative spread (fraction of the mean value)
# are treated as "essentially in agreement" for numeric values like price.
AGREEMENT_TOLERANCE_RELATIVE = 0.15


@dataclass
class DrinkingWindowResult:
    drink_after: date | None
    drink_before: date | None
    confidence: float  # 0..1
    source: str


@dataclass
class MarketInfoResult:
    market_value: float | None
    advice_pairing: str | None
    advice_experience: str | None
    confidence: float
    source: str


class EnrichmentProvider(ABC):
    name: str = "base"

    @abstractmethod
    def fetch_drinking_window(self, wine: Wine) -> DrinkingWindowResult | None: ...

    @abstractmethod
    def fetch_market_info(self, wine: Wine) -> MarketInfoResult | None: ...


class MockEnrichmentProvider(EnrichmentProvider):
    """Deterministic placeholder data, useful for demos, UI development, and
    exercising the aggregation/merge logic in tests. NOT connected to the
    internet and NOT a source of real wine facts - do not use its output as
    real advice. Three differently-biased profiles are registered below so
    the aggregation logic has genuinely disagreeing estimates to combine,
    the way real independent sources would disagree.
    """

    PROFILES = {
        # (aging-window years from vintage, price-per-year-of-age, confidence)
        "conservative": {
            "after_years": 3,
            "before_years": 7,
            "price_base": 14.0,
            "price_per_year": 0.4,
            "confidence": 0.35,
        },
        "generous": {
            "after_years": 1,
            "before_years": 12,
            "price_base": 18.0,
            "price_per_year": 0.7,
            "confidence": 0.3,
        },
        "community": {
            "after_years": 2,
            "before_years": 9,
            "price_base": 16.0,
            "price_per_year": 0.55,
            "confidence": 0.45,
        },
    }

    def __init__(self, profile: str = "community"):
        self.profile = profile
        self.name = f"mock-{profile}"
        self._settings = self.PROFILES[profile]

    def fetch_drinking_window(self, wine: Wine) -> DrinkingWindowResult | None:
        if not wine.vintage:
            return None
        s = self._settings
        return DrinkingWindowResult(
            drink_after=date(wine.vintage + s["after_years"], 1, 1),
            drink_before=date(wine.vintage + s["before_years"], 1, 1),
            confidence=s["confidence"],
            source=self.name,
        )

    def fetch_market_info(self, wine: Wine) -> MarketInfoResult | None:
        s = self._settings
        base = s["price_base"]
        if wine.vintage:
            base += max(0, (2030 - wine.vintage)) * s["price_per_year"]
        return MarketInfoResult(
            market_value=round(base, 2),
            advice_pairing=None,
            advice_experience=None,
            confidence=s["confidence"],
            source=self.name,
        )


def get_active_providers() -> list[EnrichmentProvider]:
    """Return configured providers.

    Demonstration providers are disabled by default because their deterministic
    output is not real internet wine data. Developers may explicitly enable
    them with ``WINECELLAR_ENABLE_DEMO_ENRICHMENT=true`` while building a UI.
    Production deployments should register licensed provider implementations
    here instead.
    """
    enabled = os.environ.get("WINECELLAR_ENABLE_DEMO_ENRICHMENT", "false").strip().lower()
    if enabled in {"1", "true", "yes", "on"}:
        return [
            MockEnrichmentProvider("conservative"),
            MockEnrichmentProvider("generous"),
            MockEnrichmentProvider("community"),
        ]
    return []


# ---------------------------------------------------------------------------
# aggregation: combine several providers' results into one best estimate
# ---------------------------------------------------------------------------


@dataclass
class AggregatedDrinkingWindow:
    drink_after: date | None
    drink_before: date | None
    confidence: float
    sources: list[str] = field(default_factory=list)
    source_count: int = 0
    per_source: list[DrinkingWindowResult] = field(default_factory=list)

    @property
    def source(self) -> str:
        return "+".join(self.sources) if self.sources else "no-source"


@dataclass
class AggregatedMarketInfo:
    market_value: float | None
    advice_pairing: str | None
    advice_experience: str | None
    confidence: float
    sources: list[str] = field(default_factory=list)
    source_count: int = 0
    per_source: list[MarketInfoResult] = field(default_factory=list)

    @property
    def source(self) -> str:
        return "+".join(self.sources) if self.sources else "no-source"


def _weighted_date_bound(pairs: list[tuple[date, float]]) -> tuple[date | None, float]:
    """Weighted-mean date plus the weighted standard deviation (in days),
    from (date, confidence) pairs. Returns (None, 0.0) if empty."""
    if not pairs:
        return None, 0.0
    total_weight = sum(w for _, w in pairs)
    if total_weight <= 0:
        total_weight = len(pairs)
        pairs = [(d, 1.0) for d, _ in pairs]
    mean_ordinal = sum(d.toordinal() * w for d, w in pairs) / total_weight
    variance = sum(w * (d.toordinal() - mean_ordinal) ** 2 for d, w in pairs) / total_weight
    return date.fromordinal(round(mean_ordinal)), variance**0.5


def _agreement_adjustment(spread: float, tolerance: float, n_sources: int) -> float:
    """A signed confidence adjustment: sources that agree closely earn a
    small bonus (more independent agreement = more trustworthy); sources
    that disagree a lot lose confidence, even if their individual
    confidences were reasonable - disagreement itself is informative."""
    if n_sources <= 1:
        return 0.0
    penalty = max(0.0, (spread - tolerance) / (tolerance * 4)) if tolerance > 0 else 0.0
    bonus = min(0.15, 0.05 * (n_sources - 1)) if spread <= tolerance else 0.0
    return bonus - penalty


def aggregate_drinking_windows(
    results: list[DrinkingWindowResult | None],
) -> AggregatedDrinkingWindow | None:
    """Combine every provider's drinking-window estimate into one. Bounds
    are combined independently (some providers may only offer one of the
    two), each as a confidence-weighted mean, with the combined confidence
    nudged by how much the contributing sources agree with each other."""
    usable = [r for r in results if r is not None and (r.drink_after or r.drink_before)]
    if not usable:
        return None

    after_pairs = [(r.drink_after, r.confidence) for r in usable if r.drink_after]
    before_pairs = [(r.drink_before, r.confidence) for r in usable if r.drink_before]
    after_date, after_spread = _weighted_date_bound(after_pairs)
    before_date, before_spread = _weighted_date_bound(before_pairs)

    avg_confidence = sum(r.confidence for r in usable) / len(usable)
    adjustment = 0.0
    if after_pairs:
        adjustment += _agreement_adjustment(
            after_spread, AGREEMENT_TOLERANCE_DAYS, len(after_pairs)
        )
    if before_pairs:
        adjustment += _agreement_adjustment(
            before_spread, AGREEMENT_TOLERANCE_DAYS, len(before_pairs)
        )
    combined_confidence = max(0.05, min(0.95, avg_confidence + adjustment))

    return AggregatedDrinkingWindow(
        drink_after=after_date,
        drink_before=before_date,
        confidence=round(combined_confidence, 3),
        sources=[r.source for r in usable],
        source_count=len(usable),
        per_source=usable,
    )


def aggregate_market_info(results: list[MarketInfoResult | None]) -> AggregatedMarketInfo | None:
    usable = [r for r in results if r is not None and r.market_value is not None]
    if not usable:
        return None

    total_weight = sum(r.confidence for r in usable) or len(usable)
    weights = [(r.market_value, r.confidence or 1.0) for r in usable]
    mean_value = sum(v * w for v, w in weights) / total_weight
    variance = sum(w * (v - mean_value) ** 2 for v, w in weights) / total_weight
    std = variance**0.5
    (std / mean_value) if mean_value else 0.0
    tolerance = AGREEMENT_TOLERANCE_RELATIVE * (mean_value or 1.0)

    avg_confidence = sum(r.confidence for r in usable) / len(usable)
    adjustment = _agreement_adjustment(std, tolerance, len(usable))
    combined_confidence = max(0.05, min(0.95, avg_confidence + adjustment))

    # Prose advice: take it from whichever single source offered the richest
    # answer (highest confidence among those that provided any text),
    # rather than trying to merge sentences from several sources.
    with_advice = [r for r in usable if r.advice_pairing or r.advice_experience]
    best_advice = max(with_advice, key=lambda r: r.confidence, default=None)

    return AggregatedMarketInfo(
        market_value=round(mean_value, 2),
        confidence=round(combined_confidence, 3),
        advice_pairing=best_advice.advice_pairing if best_advice else None,
        advice_experience=best_advice.advice_experience if best_advice else None,
        sources=[r.source for r in usable],
        source_count=len(usable),
        per_source=usable,
    )


def fetch_and_aggregate_drinking_window(
    wine: Wine, providers: list[EnrichmentProvider]
) -> AggregatedDrinkingWindow | None:
    return aggregate_drinking_windows([p.fetch_drinking_window(wine) for p in providers])


def fetch_and_aggregate_market_info(
    wine: Wine, providers: list[EnrichmentProvider]
) -> AggregatedMarketInfo | None:
    return aggregate_market_info([p.fetch_market_info(wine) for p in providers])


# ---------------------------------------------------------------------------
# merge against whatever is already on the wine record
# ---------------------------------------------------------------------------


@dataclass
class MergeDecision:
    applied: bool
    new_value: object
    new_confidence: float | None
    new_source: str | None
    note: str


def merge_value(
    *,
    existing_value: object,
    existing_confidence: float | None,
    fetched_value: object,
    fetched_confidence: float,
    fetched_source: str,
    confidence_margin: float = 0.05,
) -> MergeDecision:
    """Decide whether a freshly fetched (already-aggregated) value should
    replace what's on file.

    Rules, in order:
    1. Nothing usable was fetched -> refuse.
    2. No existing value at all -> always take the fetched one.
    3. Existing value is manual (confidence == 1.0) -> never auto-overwrite;
       the user must explicitly request a refresh (caller's responsibility -
       this function just refuses).
    4. Otherwise, replace only if the fetched confidence clearly exceeds the
       existing one (by more than `confidence_margin`); a close call is
       surfaced but not applied, so the person can decide by hand.
    """
    if fetched_value is None:
        return MergeDecision(
            False, existing_value, existing_confidence, None, "fetched value unavailable"
        )
    if existing_value is None:
        return MergeDecision(
            True,
            fetched_value,
            fetched_confidence,
            fetched_source,
            "no existing value; filled from fetch",
        )
    if existing_confidence is not None and existing_confidence >= MANUAL_CONFIDENCE:
        return MergeDecision(
            False,
            existing_value,
            existing_confidence,
            None,
            "existing value is manual; not auto-overwritten",
        )
    existing_confidence = existing_confidence or 0.0
    if fetched_confidence > existing_confidence + confidence_margin:
        return MergeDecision(
            True,
            fetched_value,
            fetched_confidence,
            fetched_source,
            "fetched value has higher confidence",
        )
    return MergeDecision(
        False,
        existing_value,
        existing_confidence,
        None,
        "fetched value's confidence is not clearly better; kept existing value for review",
    )


def apply_drinking_window_enrichment(
    wine: Wine, fetched: AggregatedDrinkingWindow
) -> list[MergeDecision]:
    decisions = []
    d = merge_value(
        existing_value=wine.drink_after,
        existing_confidence=wine.drink_after_confidence,
        fetched_value=fetched.drink_after,
        fetched_confidence=fetched.confidence,
        fetched_source=fetched.source,
    )
    decisions.append(d)
    if d.applied:
        wine.drink_after, wine.drink_after_confidence, wine.drink_after_source = (
            fetched.drink_after,
            fetched.confidence,
            fetched.source,
        )

    d2 = merge_value(
        existing_value=wine.drink_before,
        existing_confidence=wine.drink_before_confidence,
        fetched_value=fetched.drink_before,
        fetched_confidence=fetched.confidence,
        fetched_source=fetched.source,
    )
    decisions.append(d2)
    if d2.applied:
        wine.drink_before, wine.drink_before_confidence, wine.drink_before_source = (
            fetched.drink_before,
            fetched.confidence,
            fetched.source,
        )
    return decisions


def apply_market_info_enrichment(wine: Wine, fetched: AggregatedMarketInfo) -> MergeDecision:
    decision = merge_value(
        existing_value=wine.market_value,
        existing_confidence=wine.market_value_confidence,
        fetched_value=fetched.market_value,
        fetched_confidence=fetched.confidence,
        fetched_source=fetched.source,
    )
    if decision.applied:
        wine.market_value = fetched.market_value
        wine.market_value_confidence = fetched.confidence
        wine.market_value_source = fetched.source
        wine.market_value_updated_at = utcnow()
    if fetched.advice_pairing and not wine.advice_pairing:
        wine.advice_pairing = fetched.advice_pairing
    if fetched.advice_experience and not wine.advice_experience:
        wine.advice_experience = fetched.advice_experience
    return decision
