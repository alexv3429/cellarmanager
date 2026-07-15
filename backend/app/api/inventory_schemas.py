"""Strict schemas for the unified Add inventory workflow."""

from __future__ import annotations

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


PriceMode = Literal["per_bottle", "total"]
AcquisitionType = Literal["purchase", "gift", "inheritance", "cellar_import", "other"]
MediaCategory = Literal[
    "front_label",
    "back_label",
    "full_bottle",
    "capsule",
    "original_case",
    "receipt",
    "condition",
    "cellar_location",
    "other",
]


class WineIdentityIn(StrictModel):
    existing_wine_id: str | None = None
    producer: str | None = None
    cuvee: str | None = None
    vintage: int | None = Field(default=None, ge=1000, le=3000)
    non_vintage: bool = False
    wine_type: str = Field(default="other", min_length=1, max_length=50)
    format: str = "75cl"
    format_ml: int = Field(default=750, gt=0, le=30000)
    country: str | None = None
    region: str | None = None
    appellation: str | None = None
    classification: str | None = None
    vineyard: str | None = None
    sweetness: str | None = None
    alcohol_percentage: float | None = Field(default=None, ge=0, le=100)
    grapes: list[str] = Field(default_factory=list, max_length=50)
    certifications: list[str] = Field(default_factory=list, max_length=50)
    external_identifiers: dict[str, str] = Field(default_factory=dict)
    barcode: str | None = None
    notes: str | None = None
    field_sources: dict[str, Literal["user", "ai", "matched", "conflict", "unknown"]] = Field(
        default_factory=dict
    )

    @model_validator(mode="after")
    def validate_identity(self) -> WineIdentityIn:
        if self.existing_wine_id:
            return self
        if not self.producer or not self.producer.strip():
            raise ValueError("producer is required when creating a new wine")
        if self.non_vintage and self.vintage is not None:
            raise ValueError("vintage must be empty when non_vintage is true")
        return self


class AcquisitionIn(StrictModel):
    quantity: int = Field(gt=0, le=100000)
    price_mode: PriceMode = "per_bottle"
    amount: float | None = Field(default=None, ge=0)
    currency: str = Field(default="EUR", min_length=3, max_length=3)
    purchase_date: date | None = None
    vendor: str | None = None
    tax_included: bool | None = None
    fees: float = Field(default=0, ge=0)
    shipping: float = Field(default=0, ge=0)
    acquisition_type: AcquisitionType = "purchase"
    invoice_reference: str | None = None
    notes: str | None = None
    fill_level: str | None = None
    label_condition: str | None = None
    capsule_condition: str | None = None
    bottle_condition: str | None = None
    provenance: str | None = None
    storage_history: str | None = None
    original_case: bool | None = None
    serial_number: str | None = None
    personal_notes: str | None = None
    tags: list[str] = Field(default_factory=list, max_length=100)


class StorageAllocationIn(StrictModel):
    cellar_id: str | None = None
    location: str | None = None
    quantity: int = Field(gt=0, le=100000)


class ProposedEnrichmentIn(StrictModel):
    topic: str = Field(min_length=1, max_length=100)
    label: str = Field(min_length=1, max_length=200)
    value: Any
    confidence: float = Field(default=0.5, ge=0, le=1)
    rationale: str | None = None
    evidence_links: list[HttpUrl] = Field(default_factory=list, max_length=20)


class InventoryCreateIn(StrictModel):
    identity: WineIdentityIn
    acquisition: AcquisitionIn
    storage: StorageAllocationIn
    enrichment_candidates: list[ProposedEnrichmentIn] = Field(default_factory=list, max_length=100)
    client_op_id: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def quantities_match(self) -> InventoryCreateIn:
        if self.storage.quantity != self.acquisition.quantity:
            raise ValueError(
                "storage quantity must equal acquisition quantity in the first version"
            )
        return self


class DuplicateCheckIn(StrictModel):
    producer: str
    cuvee: str | None = None
    appellation: str | None = None
    vintage: int | None = None
    non_vintage: bool = False
    format: str = "75cl"


class ManualChatGPTIdentity(StrictModel):
    producer: str
    cuvee: str | None = None
    vintage: int | Literal["NV"] | None = None
    wine_type: str = Field(
        default="other",
        min_length=1,
        max_length=50,
        description="Wine colour or style, for example red, white, rosé, sparkling, orange or fortified.",
    )
    format: str = "75cl"
    format_ml: int = Field(default=750, gt=0, le=30000)
    country: str | None = None
    region: str | None = None
    appellation: str | None = None
    classification: str | None = None
    vineyard: str | None = None
    sweetness: str | None = None
    alcohol_percentage: float | None = Field(default=None, ge=0, le=100)
    grapes: list[str] = Field(default_factory=list, max_length=50)
    certifications: list[str] = Field(default_factory=list, max_length=50)
    external_identifiers: dict[str, str] = Field(default_factory=dict)
    barcode: str | None = None


class ManualChatGPTEnrichment(StrictModel):
    drinking_window_start: int | None = Field(
        default=None,
        ge=1900,
        le=3000,
        description="Best-supported first drinking year after research; null when no credible source exists.",
    )
    drinking_window_end: int | None = Field(
        default=None,
        ge=1900,
        le=3000,
        description="Best-supported final drinking year after research; null when no credible source exists.",
    )
    serving_advice: str | None = Field(
        default=None,
        description="Concise serving guidance such as temperature, decanting and glassware.",
    )
    pairings: list[str] = Field(
        default_factory=list,
        max_length=20,
        description="Specific food pairings supported by the wine style or researched sources.",
    )
    review_summary: str | None = Field(
        default=None,
        description="Brief synthesis of credible critic, producer or merchant tasting information; do not fabricate scores.",
    )

    @model_validator(mode="after")
    def validate_drinking_window(self) -> ManualChatGPTEnrichment:
        if (
            self.drinking_window_start is not None
            and self.drinking_window_end is not None
            and self.drinking_window_end < self.drinking_window_start
        ):
            raise ValueError("drinking_window_end must not be earlier than drinking_window_start")
        return self


class ManualChatGPTImport(StrictModel):
    identity: ManualChatGPTIdentity
    enrichment: ManualChatGPTEnrichment = Field(default_factory=ManualChatGPTEnrichment)
    confidence: dict[str, float] = Field(default_factory=dict)
    evidence_links: list[HttpUrl] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def confidence_range(self) -> ManualChatGPTImport:
        bad = [key for key, value in self.confidence.items() if value < 0 or value > 1]
        if bad:
            raise ValueError(f"confidence values must be between 0 and 1: {', '.join(bad)}")
        return self
