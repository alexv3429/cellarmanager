"""Pydantic v2 schemas: the HTTP-facing shape of things, kept separate from
the internal dataclasses in ``app.core.domain`` so the two can evolve
independently (e.g. the API can hide fields or add computed ones without
touching storage)."""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class WineIn(BaseModel):
    producer: str
    cuvee: Optional[str] = None
    appellation: Optional[str] = None
    vintage: Optional[int] = None
    color: str = "other"
    area: Optional[str] = None
    format: str = "75cl"
    drink_after: Optional[date] = None
    drink_before: Optional[date] = None
    market_value: Optional[float] = None
    advice_experience: Optional[str] = None
    advice_pairing: Optional[str] = None
    notes: Optional[str] = None


class WineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    producer: str
    cuvee: Optional[str]
    appellation: Optional[str]
    vintage: Optional[int]
    color: str
    area: Optional[str]
    format: str
    format_ml: Optional[int]
    drink_after: Optional[date]
    drink_after_confidence: Optional[float]
    drink_after_source: Optional[str]
    drink_before: Optional[date]
    drink_before_confidence: Optional[float]
    drink_before_source: Optional[str]
    market_value: Optional[float]
    market_value_confidence: Optional[float]
    market_value_source: Optional[str]
    market_value_updated_at: Optional[datetime]
    advice_experience: Optional[str]
    advice_pairing: Optional[str]
    notes: Optional[str]
    version: int


class CellarIn(BaseModel):
    name: str
    purpose_level: Optional[int] = Field(default=None, ge=0, le=10)
    is_overflow: bool = False
    max_capacity: int = Field(default=0, ge=0)
    threshold: int = Field(default=0, ge=0)
    location_rule: Optional[str] = None
    layout: Optional[str] = None


class CellarOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    purpose_level: Optional[int]
    is_overflow: bool
    max_capacity: int
    threshold: int
    location_rule: Optional[str]
    layout: Optional[str]
    current_fill: int = 0


class HoldingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    wine_id: str
    cellar_id: Optional[str]
    location: Optional[str]
    quantity: int
    state: str
    price_bought: Optional[float]
    acquired_date: Optional[date]
    version: int


class AddBottlesIn(BaseModel):
    wine_id: str
    cellar_id: Optional[str] = None
    location: Optional[str] = None
    quantity: int = Field(gt=0)
    price_bought: Optional[float] = None
    acquired_date: Optional[date] = None
    note: Optional[str] = None
    client_op_id: Optional[str] = None


class MoveBottlesIn(BaseModel):
    holding_id: str
    quantity: int = Field(gt=0)
    to_cellar_id: Optional[str] = None
    to_location: Optional[str] = None
    note: Optional[str] = None
    client_op_id: Optional[str] = None
    expected_version: Optional[int] = None


class RemoveBottlesIn(BaseModel):
    holding_id: str
    quantity: int = Field(gt=0)
    reason: str  # gifted|broken|sold|lost|drunk
    note: Optional[str] = None
    client_op_id: Optional[str] = None
    expected_version: Optional[int] = None


class ActionOut(BaseModel):
    holding: HoldingOut
    warning: Optional[str] = None


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


class ExportRequest(BaseModel):
    columns: list[str]
    language: str = "en"
    cellar_id: Optional[str] = None


class RecommendationRequestIn(BaseModel):
    cellar_id: Optional[str] = None
    color: Optional[str] = None
    vintage: Optional[int] = None
    vintage_before: Optional[int] = None
    vintage_after: Optional[int] = None
    appellation: Optional[str] = None
    on_date: Optional[date] = None
    dish: Optional[str] = None
    mood: Optional[str] = None
    limit: int = 20


class RecognizeMatchOut(BaseModel):
    wine_id: str
    distance: int
    confidence: float


class ErrorOut(BaseModel):
    detail: str
    field: Optional[str] = None
