"""Transactional orchestration for creating inventory without conflating wine and purchase data."""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import date, datetime
from difflib import SequenceMatcher
from typing import Any

from app.api.inventory_schemas import InventoryCreateIn, ManualChatGPTImport
from app.core.domain import Wine, new_id, utcnow
from app.core.exceptions import NotFoundError, ValidationError
from app.services import holdings_service
from app.services.cellar_rules import (
    generate_locations,
    get_location_scheme,
    normalize_location_for_cellar,
    rule_matches,
)
from app.services.csv_io import parse_format_ml
from app.storage import inventory_repository as inventory_repo
from app.storage import repositories as repo


def _json_value(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, list):
        return [_json_value(item) for item in value]
    if isinstance(value, dict):
        return {key: _json_value(item) for key, item in value.items()}
    return value


def _model_dict(value: Any) -> dict[str, Any]:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if hasattr(value, "__dataclass_fields__"):
        return _json_value(asdict(value))
    return dict(value)


def _row_dict(row) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


def _effective_unit_cost(payload: InventoryCreateIn) -> float | None:
    acquisition = payload.acquisition
    if acquisition.amount is None:
        return None
    base = (
        acquisition.amount / acquisition.quantity
        if acquisition.price_mode == "total"
        else acquisition.amount
    )
    return round(base + (acquisition.fees + acquisition.shipping) / acquisition.quantity, 4)


def _validate_and_normalize_location(
    conn, cellar_id: str | None, location: str | None
) -> str | None:
    if not cellar_id:
        return location.strip() if location and location.strip() else None
    cellar = repo.get_cellar(conn, cellar_id)
    if cellar is None:
        raise NotFoundError(f"Cellar {cellar_id} not found")
    if not location or not location.strip():
        return None

    text = location.strip()
    scheme = get_location_scheme(cellar.layout)
    if scheme is not None:
        valid = set()
        for item in generate_locations(scheme):
            if item.get("import"):
                valid.add(str(item["import"]).casefold())
            if item.get("internal"):
                valid.add(str(item["internal"]).casefold())
        if text.casefold() not in valid:
            raise ValidationError(
                f"Location '{text}' is not valid for cellar '{cellar.name}'",
                field="storage.location",
            )
        return normalize_location_for_cellar(cellar, text)

    if cellar.location_rule and not rule_matches(cellar.location_rule, text):
        raise ValidationError(
            f"Location '{text}' does not match cellar '{cellar.name}' rules",
            field="storage.location",
        )
    return text


def duplicate_suggestions(
    conn, identity: dict[str, Any], *, limit: int = 5
) -> list[dict[str, Any]]:
    producer = (identity.get("producer") or "").strip()
    cuvee = (identity.get("cuvee") or "").strip()
    appellation = (identity.get("appellation") or "").strip()
    vintage = None if identity.get("non_vintage") else identity.get("vintage")
    format_name = (identity.get("format") or "75cl").strip()
    query = " ".join(part for part in [producer, cuvee, appellation] if part).casefold()

    suggestions: list[dict[str, Any]] = []
    for wine in repo.list_wines(conn):
        candidate = " ".join(
            part for part in [wine.producer, wine.cuvee or "", wine.appellation or ""] if part
        ).casefold()
        text_score = SequenceMatcher(None, query, candidate).ratio() if query else 0.0
        vintage_score = 1.0 if wine.vintage == vintage else (0.75 if vintage is None else 0.0)
        format_score = 1.0 if (wine.format or "").casefold() == format_name.casefold() else 0.25
        score = round(text_score * 0.72 + vintage_score * 0.2 + format_score * 0.08, 4)
        exact = (
            (wine.producer or "").strip().casefold() == producer.casefold()
            and (wine.cuvee or "").strip().casefold() == cuvee.casefold()
            and (wine.appellation or "").strip().casefold() == appellation.casefold()
            and wine.vintage == vintage
            and (wine.format or "").strip().casefold() == format_name.casefold()
        )
        if exact or score >= 0.55:
            suggestions.append(
                {
                    "wine_id": wine.id,
                    "producer": wine.producer,
                    "cuvee": wine.cuvee,
                    "appellation": wine.appellation,
                    "vintage": wine.vintage,
                    "format": wine.format,
                    "score": 1.0 if exact else score,
                    "exact": exact,
                }
            )
    suggestions.sort(key=lambda item: (item["exact"], item["score"]), reverse=True)
    return suggestions[:limit]


def _create_or_select_wine(conn, payload: InventoryCreateIn) -> tuple[Wine, bool]:
    identity = payload.identity
    if identity.existing_wine_id:
        wine = repo.get_wine(conn, identity.existing_wine_id)
        if wine is None:
            raise NotFoundError(f"Wine {identity.existing_wine_id} not found")
        return wine, False

    vintage = None if identity.non_vintage else identity.vintage
    format_ml = identity.format_ml or parse_format_ml(identity.format)
    wine = Wine(
        id=new_id(),
        producer=(identity.producer or "").strip(),
        cuvee=identity.cuvee,
        appellation=identity.appellation,
        vintage=vintage,
        color=identity.wine_type,
        area=identity.region or identity.country,
        format=identity.format,
        format_ml=format_ml,
        notes=identity.notes,
    )
    repo.insert_wine(conn, wine)
    inventory_repo.insert_identity_details(
        conn,
        wine_id=wine.id,
        details=identity.model_dump(mode="json"),
        now=utcnow().isoformat(),
    )
    return wine, True


def _existing_result(conn, acquisition_row) -> dict[str, Any]:
    allocation = inventory_repo.get_allocation_for_acquisition(conn, acquisition_row["id"])
    holding = repo.get_holding(conn, allocation["holding_id"]) if allocation else None
    wine = repo.get_wine(conn, acquisition_row["wine_id"])
    return {
        "wine": _model_dict(wine) if wine else None,
        "holding": _model_dict(holding) if holding else None,
        "acquisition": _row_dict(acquisition_row),
        "allocation": _row_dict(allocation),
        "media": [
            dict(row)
            for row in inventory_repo.list_media_for_acquisition(conn, acquisition_row["id"])
        ],
        "warning": None,
        "duplicate": True,
        "wine_created": False,
    }


def create_inventory(conn, *, payload: InventoryCreateIn, user_id: str) -> dict[str, Any]:
    """Create/select wine, acquisition, stock allocation and proposed AI data atomically."""
    if payload.client_op_id:
        existing = inventory_repo.acquisition_by_client_op(conn, payload.client_op_id)
        if existing is not None:
            return _existing_result(conn, existing)

    normalized_location = _validate_and_normalize_location(
        conn, payload.storage.cellar_id, payload.storage.location
    )
    wine, wine_created = _create_or_select_wine(conn, payload)
    unit_cost = _effective_unit_cost(payload)

    action = holdings_service.add_bottles(
        conn,
        wine_id=wine.id,
        cellar_id=payload.storage.cellar_id,
        location=normalized_location,
        quantity=payload.storage.quantity,
        price_bought=unit_cost,
        acquired_date=payload.acquisition.purchase_date,
        user_id=user_id,
        note=payload.acquisition.notes,
        client_op_id=payload.client_op_id,
    )

    now = utcnow().isoformat()
    acquisition_id = new_id()
    acquisition = payload.acquisition
    inventory_repo.insert_acquisition(
        conn,
        {
            "id": acquisition_id,
            "wine_id": wine.id,
            "user_id": user_id,
            "quantity": acquisition.quantity,
            "price_mode": acquisition.price_mode,
            "amount": acquisition.amount,
            "currency": acquisition.currency.upper(),
            "tax_included": None
            if acquisition.tax_included is None
            else int(acquisition.tax_included),
            "fees": acquisition.fees,
            "shipping": acquisition.shipping,
            "effective_unit_cost": unit_cost,
            "purchase_date": acquisition.purchase_date.isoformat()
            if acquisition.purchase_date
            else None,
            "vendor": acquisition.vendor,
            "acquisition_type": acquisition.acquisition_type,
            "invoice_reference": acquisition.invoice_reference,
            "notes": acquisition.notes,
            "fill_level": acquisition.fill_level,
            "label_condition": acquisition.label_condition,
            "capsule_condition": acquisition.capsule_condition,
            "bottle_condition": acquisition.bottle_condition,
            "provenance": acquisition.provenance,
            "storage_history": acquisition.storage_history,
            "original_case": None
            if acquisition.original_case is None
            else int(acquisition.original_case),
            "serial_number": acquisition.serial_number,
            "personal_notes": acquisition.personal_notes,
            "tags_json": json.dumps(acquisition.tags, ensure_ascii=False),
            "client_op_id": payload.client_op_id,
            "created_at": now,
        },
    )
    allocation_id = new_id()
    inventory_repo.insert_allocation(
        conn,
        {
            "id": allocation_id,
            "acquisition_id": acquisition_id,
            "holding_id": action.holding.id,
            "cellar_id": payload.storage.cellar_id,
            "location": normalized_location,
            "quantity": payload.storage.quantity,
            "created_at": now,
        },
    )

    for candidate in payload.enrichment_candidates:
        inventory_repo.insert_candidate(
            conn,
            {
                "id": new_id(),
                "wine_id": wine.id,
                "acquisition_id": acquisition_id,
                "topic": candidate.topic,
                "label": candidate.label,
                "value_json": json.dumps(candidate.value, ensure_ascii=False),
                "confidence": candidate.confidence,
                "rationale": candidate.rationale,
                "evidence_links_json": json.dumps(
                    [str(link) for link in candidate.evidence_links], ensure_ascii=False
                ),
                "status": "proposed",
                "created_at": now,
                "reviewed_at": None,
                "reviewer_id": None,
            },
        )

    acquisition_row = inventory_repo.get_acquisition(conn, acquisition_id)
    allocation_row = inventory_repo.get_allocation_for_acquisition(conn, acquisition_id)
    return {
        "wine": _model_dict(wine),
        "holding": _model_dict(action.holding),
        "acquisition": _row_dict(acquisition_row),
        "allocation": _row_dict(allocation_row),
        "media": [],
        "warning": action.warning,
        "duplicate": False,
        "wine_created": wine_created,
    }


def manual_import_to_prefill(value: ManualChatGPTImport) -> dict[str, Any]:
    identity = value.identity.model_dump(mode="json")
    vintage = identity.pop("vintage")
    identity["non_vintage"] = vintage == "NV"
    identity["vintage"] = None if vintage == "NV" else vintage
    identity["existing_wine_id"] = None
    identity["field_sources"] = {
        key: "ai" for key, item in identity.items() if item not in (None, "", [], {})
    }

    enrichment = value.enrichment.model_dump(mode="json")
    candidates = []
    for key, item in enrichment.items():
        if item in (None, "", []):
            continue
        candidates.append(
            {
                "topic": key,
                "label": key.replace("_", " ").title(),
                "value": item,
                "confidence": value.confidence.get(key, 0.5),
                "rationale": "Imported from manually reviewed ChatGPT JSON",
                "evidence_links": [str(link) for link in value.evidence_links],
            }
        )
    return {"identity": identity, "enrichment_candidates": candidates}
