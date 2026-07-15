"""Regression tests for colour import aliases and transactional bottle edits."""

from __future__ import annotations

import sqlite3
from datetime import date
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.core.domain import Holding, Wine, utcnow
from app.core.exceptions import ValidationError
from app.services.bottle_edit_service import edit_bottle, get_edit_context
from app.services.csv_io import is_recognized_color, normalize_color
from app.storage import repositories as repo


@pytest.mark.parametrize(
    ("label", "expected"),
    [
        ("blanc moelleux", "white"),
        ("Blanc liquoreux", "white"),
        ("sweet white", "white"),
        ("rouge moelleux", "red"),
        ("Sweet Red", "red"),
        ("vin rouge doux", "red"),
        ("moelleux blanc", "white"),
        ("doux rouge", "red"),
        ("sparkling white", "sparkling"),
    ],
)
def test_sweet_colour_labels_are_normalized(label: str, expected: str) -> None:
    assert normalize_color(label) == expected
    assert is_recognized_color(label)


def test_ambiguous_mixed_colour_is_not_guessed() -> None:
    assert normalize_color("red / white") == "other"
    assert not is_recognized_color("red / white")


def _connection() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    schema = Path(__file__).parents[1] / "app" / "storage" / "schema.sql"
    conn.executescript(schema.read_text(encoding="utf-8"))
    return conn


def _payload(**overrides):
    values = {
        "expected_wine_version": 1,
        "expected_holding_version": 1,
        "producer": "Corrected Producer",
        "cuvee": "Corrected Cuvée",
        "appellation": "Test Appellation",
        "vintage": 2020,
        "color": "white",
        "area": "Test Region",
        "format": "75cl",
        "acquisition_id": "acq-1",
        "price_mode": "total",
        "amount": 180.0,
        "currency": "eur",
        "purchase_date": date(2024, 5, 12),
        "legacy_price_bought": None,
        "legacy_acquired_date": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _seed(conn: sqlite3.Connection) -> tuple[Wine, Holding]:
    wine = Wine(
        id="wine-1",
        producer="Typo Producer",
        cuvee="Typo Cuvee",
        appellation="Test Appellation",
        vintage=2020,
        color="red",
        area="Test Region",
        format="75cl",
        format_ml=750,
    )
    holding = Holding(
        id="holding-1",
        wine_id=wine.id,
        quantity=6,
        price_bought=20.0,
        acquired_date=date(2023, 1, 1),
    )
    repo.insert_wine(conn, wine)
    repo.insert_holding(conn, holding)
    now = utcnow().isoformat()
    conn.execute(
        """
        INSERT INTO acquisitions (
            id, wine_id, quantity, price_mode, amount, currency, tax_included,
            fees, shipping, effective_unit_cost, purchase_date, acquisition_type,
            tags_json, created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            "acq-1",
            wine.id,
            6,
            "total",
            120.0,
            "EUR",
            1,
            0.0,
            0.0,
            20.0,
            "2023-01-01",
            "purchase",
            "[]",
            now,
        ),
    )
    conn.execute(
        """
        INSERT INTO acquisition_allocations (
            id, acquisition_id, holding_id, cellar_id, location, quantity, created_at
        ) VALUES (?,?,?,?,?,?,?)
        """,
        ("allocation-1", "acq-1", holding.id, None, None, 6, now),
    )
    conn.commit()
    return wine, holding


def test_edit_updates_identity_purchase_holding_and_journal_atomically() -> None:
    conn = _connection()
    _seed(conn)

    result = edit_bottle(
        conn,
        holding_id="holding-1",
        payload=_payload(),
        user_id="user-1",
    )
    conn.commit()

    assert result.wine.producer == "Corrected Producer"
    assert result.wine.color == "white"
    assert result.wine.version == 2
    assert result.holding.price_bought == 30.0
    assert result.holding.acquired_date == date(2024, 5, 12)
    assert result.holding.version == 2

    acquisition = conn.execute("SELECT * FROM acquisitions WHERE id = 'acq-1'").fetchone()
    assert acquisition["amount"] == 180.0
    assert acquisition["currency"] == "EUR"
    assert acquisition["effective_unit_cost"] == 30.0
    assert acquisition["purchase_date"] == "2024-05-12"

    movement = conn.execute(
        """
        SELECT action, quantity_delta, details_json
        FROM movements
        ORDER BY recorded_at DESC
        LIMIT 1
        """
    ).fetchone()
    assert movement["action"] == "update"
    assert movement["quantity_delta"] == 0
    assert "Corrected Producer" in movement["details_json"]
    assert '"before"' in movement["details_json"]
    assert '"after"' in movement["details_json"]

    context = get_edit_context(conn, "holding-1")
    assert context["acquisitions"][0]["allocation_quantity"] == 6


def test_invalid_database_is_rejected_before_any_edit() -> None:
    conn = _connection()
    _seed(conn)
    conn.execute("UPDATE wines SET color = 'invalid-colour' WHERE id = 'wine-1'")
    conn.commit()

    with pytest.raises(ValidationError, match="invalid wine record"):
        edit_bottle(
            conn,
            holding_id="holding-1",
            payload=_payload(),
            user_id="user-1",
        )
    conn.rollback()

    row = conn.execute("SELECT producer, version FROM wines WHERE id = 'wine-1'").fetchone()
    assert row["producer"] == "Typo Producer"
    assert row["version"] == 1


def test_normalized_purchase_cannot_be_bypassed_with_legacy_fields() -> None:
    conn = _connection()
    _seed(conn)

    with pytest.raises(ValidationError, match="Select the acquisition lot"):
        edit_bottle(
            conn,
            holding_id="holding-1",
            payload=_payload(
                acquisition_id=None,
                legacy_price_bought=99.0,
                legacy_acquired_date=date(2025, 1, 1),
            ),
            user_id="user-1",
        )
    conn.rollback()

    holding = conn.execute(
        "SELECT price_bought, acquired_date, version FROM holdings WHERE id = 'holding-1'"
    ).fetchone()
    acquisition = conn.execute(
        "SELECT amount, purchase_date FROM acquisitions WHERE id = 'acq-1'"
    ).fetchone()
    assert dict(holding) == {
        "price_bought": 20.0,
        "acquired_date": "2023-01-01",
        "version": 1,
    }
    assert dict(acquisition) == {"amount": 120.0, "purchase_date": "2023-01-01"}


def test_edit_updates_sweetness_field() -> None:
    conn = _connection()
    _seed(conn)

    edit_bottle(
        conn,
        holding_id="holding-1",
        payload=_payload(sweetness="moelleux"),
        user_id="user-1",
    )
    conn.commit()

    context = get_edit_context(conn, "holding-1")
    assert context["sweetness"] == "moelleux"
