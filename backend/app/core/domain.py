"""Framework-agnostic domain model for the wine cellar application.

These are plain dataclasses with no dependency on the web framework or the
persistence layer. Keeping them here means the business logic in
``app.services`` can be unit tested without spinning up FastAPI or a real
HTTP server - only the standard library is required.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from enum import StrEnum


def new_id() -> str:
    """Generate a new opaque, URL-safe identifier."""
    return uuid.uuid4().hex


def utcnow() -> datetime:
    return datetime.now(UTC)


class WineColor(StrEnum):
    RED = "red"
    WHITE = "white"
    ROSE = "rose"
    SPARKLING = "sparkling"
    ORANGE = "orange"
    FORTIFIED = "fortified"
    OTHER = "other"


class HoldingState(StrEnum):
    IN_CELLAR = "in_cellar"
    GIFTED = "gifted"
    BROKEN = "broken"
    SOLD = "sold"
    LOST = "lost"
    DRUNK = "drunk"

    @classmethod
    def removed_states(cls) -> set[HoldingState]:
        return {cls.GIFTED, cls.BROKEN, cls.SOLD, cls.LOST, cls.DRUNK}


class MovementAction(StrEnum):
    IMPORT = "import"
    ADD = "add"
    MOVE = "move"
    REMOVE = "remove"
    UPDATE = "update"
    ENRICH = "enrich"
    CREATE_CELLAR = "create_cellar"
    UPDATE_CELLAR = "update_cellar"


# Purpose-level scale for cellars: 0 = pure aging, 10 = pure service.
# Overflow cellars sit outside this scale entirely (see Cellar.is_overflow).
PURPOSE_LEVEL_MIN = 0
PURPOSE_LEVEL_MAX = 10


@dataclass
class Wine:
    """A distinct wine 'reference': one row of catalog identity + tasting metadata.

    Two CSV rows describing the same producer/cuvee/appellation/vintage/format
    resolve to the same Wine (see ``identity_key``); quantities and physical
    locations live on ``Holding`` instead, so the same wine can exist in
    several cellars/locations at once without duplicating its metadata.
    """

    id: str
    producer: str
    cuvee: str | None = None
    appellation: str | None = None
    vintage: int | None = None
    color: str = WineColor.OTHER.value
    area: str | None = None
    format: str = "75cl"
    format_ml: int | None = None
    drink_after: date | None = None
    drink_after_confidence: float | None = None
    drink_after_source: str | None = None
    drink_before: date | None = None
    drink_before_confidence: float | None = None
    drink_before_source: str | None = None
    market_value: float | None = None
    market_value_currency: str | None = None
    market_value_basis: str | None = None
    market_value_confidence: float | None = None
    market_value_source: str | None = None
    market_value_updated_at: datetime | None = None
    quick_sale_value: float | None = None
    quick_sale_currency: str | None = None
    quick_sale_confidence: float | None = None
    quick_sale_source: str | None = None
    quick_sale_updated_at: datetime | None = None
    advice_experience: str | None = None
    advice_pairing: str | None = None
    notes: str | None = None
    created_at: datetime = field(default_factory=utcnow)
    updated_at: datetime = field(default_factory=utcnow)
    version: int = 1

    def identity_key(self) -> tuple:
        """Fields that determine whether two CSV rows describe 'the same wine'."""
        return (
            (self.producer or "").strip().lower(),
            (self.cuvee or "").strip().lower(),
            (self.appellation or "").strip().lower(),
            self.vintage,
            (self.format or "").strip().lower(),
        )


@dataclass
class Cellar:
    """A physical (or virtual) storage location for bottles."""

    id: str
    name: str
    purpose_level: int | None = None  # 0..10, None when is_overflow=True
    is_overflow: bool = False
    max_capacity: int = 0
    threshold: int = 0
    location_rule: str | None = None
    layout: str | None = None  # JSON-encoded rack layout, see services.cellar_rules
    created_at: datetime = field(default_factory=utcnow)
    updated_at: datetime = field(default_factory=utcnow)
    version: int = 1


@dataclass
class Holding:
    """A quantity of a given Wine sitting in a given Cellar/location/state.

    A single Wine can have several Holdings (split across cellars, or split
    because part of a lot was gifted/sold/etc. while the rest remains).
    """

    id: str
    wine_id: str
    cellar_id: str | None = None
    location: str | None = None
    quantity: int = 0
    state: str = HoldingState.IN_CELLAR.value
    price_bought: float | None = None
    acquired_date: date | None = None
    created_at: datetime = field(default_factory=utcnow)
    updated_at: datetime = field(default_factory=utcnow)
    version: int = 1


@dataclass
class Movement:
    """One line of the cellar journal: an immutable record of something that happened."""

    id: str
    action: str
    wine_id: str | None = None
    holding_id: str | None = None
    from_cellar_id: str | None = None
    from_location: str | None = None
    to_cellar_id: str | None = None
    to_location: str | None = None
    quantity_delta: int = 0
    occurred_at: datetime = field(default_factory=utcnow)
    recorded_at: datetime = field(default_factory=utcnow)
    user_id: str | None = None
    note: str | None = None
    details_json: str | None = None
    client_op_id: str | None = None


@dataclass
class User:
    id: str
    username: str
    password_hash: str
    password_salt: str
    locale: str = "en"
    created_at: datetime = field(default_factory=utcnow)
