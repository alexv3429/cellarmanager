from __future__ import annotations

import pytest
from pydantic import ValidationError as PydanticValidationError

from app.api.inventory_schemas import InventoryCreateIn, ManualChatGPTImport
from app.core.domain import User, new_id
from app.services import inventory_service
from app.storage import repositories as repo
from app.storage.database import Database


def _payload(*, client_op_id: str = "inventory-test-1") -> InventoryCreateIn:
    return InventoryCreateIn.model_validate(
        {
            "identity": {
                "producer": "Alvina Pernot",
                "cuvee": "Puligny-Montrachet Clos des Noyers Brets",
                "vintage": 2021,
                "wine_type": "white",
                "format": "75cl",
                "format_ml": 750,
                "country": "France",
                "region": "Burgundy",
                "appellation": "Puligny-Montrachet",
                "grapes": ["Chardonnay"],
            },
            "acquisition": {
                "quantity": 6,
                "price_mode": "total",
                "amount": 450,
                "currency": "GBP",
                "tax_included": False,
                "fees": 20,
                "shipping": 15,
                "acquisition_type": "purchase",
                "purchase_date": "2026-07-14",
                "vendor": "Example Merchant",
            },
            "storage": {"cellar_id": None, "location": "A12", "quantity": 6},
            "client_op_id": client_op_id,
        }
    )


def test_inventory_preserves_acquisition_and_is_idempotent(tmp_path):
    db = Database(str(tmp_path / "cellar.db"))
    conn = db.connect()
    user = User(id=new_id(), username="owner", password_hash="x", password_salt="y")
    repo.insert_user(conn, user)
    conn.commit()

    first = inventory_service.create_inventory(conn, payload=_payload(), user_id=user.id)
    conn.commit()
    replay = inventory_service.create_inventory(conn, payload=_payload(), user_id=user.id)
    conn.commit()

    assert replay["duplicate"] is True
    assert replay["acquisition"]["id"] == first["acquisition"]["id"]
    assert conn.execute("SELECT count(*) FROM acquisitions").fetchone()[0] == 1
    assert conn.execute("SELECT count(*) FROM wines").fetchone()[0] == 1
    assert conn.execute("SELECT count(*) FROM acquisition_allocations").fetchone()[0] == 1
    acquisition = conn.execute("SELECT * FROM acquisitions").fetchone()
    assert acquisition["price_mode"] == "total"
    assert acquisition["amount"] == 450
    assert acquisition["currency"] == "GBP"
    assert acquisition["effective_unit_cost"] == pytest.approx((450 + 20 + 15) / 6, abs=0.0001)


def test_separate_purchases_share_identity_but_not_acquisition(tmp_path):
    db = Database(str(tmp_path / "cellar.db"))
    conn = db.connect()
    user = User(id=new_id(), username="owner", password_hash="x", password_salt="y")
    repo.insert_user(conn, user)
    conn.commit()

    first = inventory_service.create_inventory(
        conn, payload=_payload(client_op_id="one"), user_id=user.id
    )
    conn.commit()
    second_payload = _payload(client_op_id="two")
    second_payload.identity.existing_wine_id = first["wine"]["id"]
    second_payload.identity.producer = None
    second = inventory_service.create_inventory(conn, payload=second_payload, user_id=user.id)
    conn.commit()

    assert second["wine"]["id"] == first["wine"]["id"]
    assert conn.execute("SELECT count(*) FROM wines").fetchone()[0] == 1
    assert conn.execute("SELECT count(*) FROM acquisitions").fetchone()[0] == 2
    assert conn.execute("SELECT quantity FROM holdings").fetchone()[0] == 12


def test_manual_chatgpt_schema_rejects_owner_owned_facts():
    with pytest.raises(PydanticValidationError):
        ManualChatGPTImport.model_validate(
            {
                "identity": {"producer": "Example", "wine_type": "red"},
                "enrichment": {},
                "confidence": {},
                "evidence_links": [],
                "quantity": 6,
            }
        )


def test_manual_chatgpt_enrichment_becomes_editable_candidates():
    payload = ManualChatGPTImport.model_validate(
        {
            "identity": {
                "producer": "Domaine Burgaud",
                "cuvee": "Cote Rotie",
                "vintage": 2020,
                "wine_type": "red",
                "format": "75cl",
                "format_ml": 750,
            },
            "enrichment": {
                "drinking_window_start": 2026,
                "drinking_window_end": 2038,
                "serving_advice": "Decant for one hour and serve at 16 C.",
                "pairings": ["roast lamb", "game"],
                "review_summary": "Structured Syrah with savoury and dark-fruit notes.",
            },
            "confidence": {
                "drinking_window_start": 0.8,
                "drinking_window_end": 0.75,
                "pairings": 0.7,
            },
            "evidence_links": ["https://example.com/wine"],
        }
    )

    prefill = inventory_service.manual_import_to_prefill(payload)
    candidates = {item["topic"]: item for item in prefill["enrichment_candidates"]}

    assert candidates["drinking_window_start"]["value"] == 2026
    assert candidates["drinking_window_end"]["value"] == 2038
    assert candidates["pairings"]["value"] == ["roast lamb", "game"]
    assert candidates["pairings"]["confidence"] == 0.7
    assert candidates["pairings"]["evidence_links"] == ["https://example.com/wine"]


def test_manual_chatgpt_rejects_reversed_drinking_window():
    with pytest.raises(PydanticValidationError):
        ManualChatGPTImport.model_validate(
            {
                "identity": {"producer": "Example", "wine_type": "red"},
                "enrichment": {
                    "drinking_window_start": 2035,
                    "drinking_window_end": 2028,
                },
            }
        )


def test_inventory_accepts_custom_wine_type():
    payload = _payload(client_op_id="custom-style")
    payload.identity.wine_type = "vin_jaune"
    assert payload.identity.wine_type == "vin_jaune"
