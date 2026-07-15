"""Pydantic v2 schemas: the HTTP-facing shape of things, kept separate from
the internal dataclasses in ``app.core.domain`` so the two can evolve
independently (e.g. the API can hide fields or add computed ones without
touching storage)."""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class WineIn(BaseModel):
    producer: str
    cuvee: str | None = None
    appellation: str | None = None
    vintage: int | None = None
    color: str = "other"
    area: str | None = None
    format: str = "75cl"
    drink_after: date | None = None
    drink_before: date | None = None
    market_value: float | None = None
    advice_experience: str | None = None
    advice_pairing: str | None = None
    notes: str | None = None


class WineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    producer: str
    cuvee: str | None
    appellation: str | None
    vintage: int | None
    color: str
    area: str | None
    format: str
    format_ml: int | None
    drink_after: date | None
    drink_after_confidence: float | None
    drink_after_source: str | None
    drink_before: date | None
    drink_before_confidence: float | None
    drink_before_source: str | None
    market_value: float | None
    market_value_confidence: float | None
    market_value_source: str | None
    market_value_updated_at: datetime | None
    advice_experience: str | None
    advice_pairing: str | None
    notes: str | None
    version: int


class CellarIn(BaseModel):
    name: str
    purpose_level: int | None = Field(default=None, ge=0, le=10)
    is_overflow: bool = False
    max_capacity: int = Field(default=0, ge=0)
    threshold: int = Field(default=0, ge=0)
    location_rule: str | None = None
    layout: str | None = None


class CellarOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    purpose_level: int | None
    is_overflow: bool
    max_capacity: int
    threshold: int
    location_rule: str | None
    layout: str | None
    current_fill: int = 0
    version: int
    reconciled_holdings: int = 0
    reconciled_bottles: int = 0


class HoldingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    wine_id: str
    cellar_id: str | None
    location: str | None
    quantity: int
    state: str
    price_bought: float | None
    acquired_date: date | None
    version: int


class AddBottlesIn(BaseModel):
    wine_id: str
    cellar_id: str | None = None
    location: str | None = None
    quantity: int = Field(gt=0)
    price_bought: float | None = None
    acquired_date: date | None = None
    note: str | None = None
    client_op_id: str | None = None


class MoveBottlesIn(BaseModel):
    holding_id: str
    quantity: int = Field(gt=0)
    to_cellar_id: str | None = None
    to_location: str | None = None
    note: str | None = None
    client_op_id: str | None = None
    expected_version: int | None = None


class RemoveBottlesIn(BaseModel):
    holding_id: str
    quantity: int = Field(gt=0)
    reason: str  # gifted|broken|sold|lost|drunk
    note: str | None = None
    client_op_id: str | None = None
    expected_version: int | None = None


class ActionOut(BaseModel):
    holding: HoldingOut
    warning: str | None = None
    duplicate: bool = False


class AcquisitionEditOut(BaseModel):
    id: str
    quantity: int
    allocation_quantity: int
    price_mode: str
    amount: float | None
    currency: str
    fees: float
    shipping: float
    effective_unit_cost: float | None
    purchase_date: date | None
    vendor: str | None


class BottleEditContextOut(BaseModel):
    wine: WineOut
    holding: HoldingOut
    acquisitions: list[AcquisitionEditOut]
    sweetness: str | None = None


class BottleEditIn(BaseModel):
    expected_wine_version: int = Field(ge=1)
    expected_holding_version: int = Field(ge=1)
    producer: str = Field(min_length=1, max_length=300)
    cuvee: str | None = Field(default=None, max_length=300)
    appellation: str | None = Field(default=None, max_length=300)
    vintage: int | None = Field(default=None, ge=1000, le=3000)
    color: str
    area: str | None = Field(default=None, max_length=300)
    sweetness: str | None = Field(default=None, max_length=100)
    format: str = Field(min_length=1, max_length=100)
    acquisition_id: str | None = None
    price_mode: str = "per_bottle"
    amount: float | None = Field(default=None, ge=0)
    currency: str = Field(default="EUR", min_length=3, max_length=3)
    purchase_date: date | None = None
    legacy_price_bought: float | None = Field(default=None, ge=0)
    legacy_acquired_date: date | None = None


class BottleEditOut(BaseModel):
    wine: WineOut
    holding: HoldingOut


class LoginIn(BaseModel):
    username: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    locale: str = "en"


class RegisterIn(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8)
    locale: str = "en"
    setup_token: str | None = None


class ExportRequest(BaseModel):
    columns: list[str]
    language: str = "en"
    cellar_id: str | None = None


class RecommendationRequestIn(BaseModel):
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
    limit: int = Field(default=20, ge=1, le=100)


class RecognizeMatchOut(BaseModel):
    wine_id: str
    distance: int
    confidence: float


class ErrorOut(BaseModel):
    detail: str
    field: str | None = None
