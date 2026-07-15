"""Transactional editing of wine identity and purchase facts for one holding."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict, dataclass
from datetime import date
from typing import TYPE_CHECKING, Any

from app.core.domain import Movement, MovementAction, WineColor, new_id
from app.core.exceptions import ConflictError, NotFoundError, ValidationError
from app.services import sweetness_service
from app.services.csv_io import parse_format_ml
from app.services.database_integrity import assert_database_valid
from app.storage import repositories as repo

if TYPE_CHECKING:
    from app.api.schemas import BottleEditIn
    from app.core.domain import Holding, Wine


@dataclass
class BottleEditResult:
    wine: Wine
    holding: Holding


def _date_text(value: date | None) -> str | None:
    return value.isoformat() if value else None


def _linked_acquisitions(conn: sqlite3.Connection, holding_id: str) -> list[dict[str, Any]]:
    if (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='acquisitions'"
        ).fetchone()
        is None
    ):
        return []
    rows = conn.execute(
        """
        SELECT a.*, aa.quantity AS allocation_quantity
        FROM acquisition_allocations aa
        JOIN acquisitions a ON a.id = aa.acquisition_id
        WHERE aa.holding_id = ?
        ORDER BY a.created_at, a.id
        """,
        (holding_id,),
    ).fetchall()
    return [dict(row) for row in rows]


def get_edit_context(conn: sqlite3.Connection, holding_id: str) -> dict[str, Any]:
    holding = repo.get_holding(conn, holding_id)
    if holding is None:
        raise NotFoundError(f"Holding {holding_id} not found")
    wine = repo.get_wine(conn, holding.wine_id)
    if wine is None:
        raise NotFoundError(f"Wine {holding.wine_id} not found")
    result = {
        "wine": wine,
        "holding": holding,
        "acquisitions": _linked_acquisitions(conn, holding_id),
    }
    result["sweetness"] = sweetness_service.get_wine_sweetness(conn, wine.id)
    return result


def _normalize_optional(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    return text or None


def _validate_identity(payload: BottleEditIn) -> None:
    if not payload.producer.strip():
        raise ValidationError("Producer is required", field="producer")
    if not payload.format.strip():
        raise ValidationError("Bottle format is required", field="format")
    if payload.color not in {color.value for color in WineColor}:
        raise ValidationError(f"Unsupported wine color '{payload.color}'", field="color")


def _reject_duplicate_identity(
    conn: sqlite3.Connection, wine_id: str, payload: BottleEditIn
) -> None:
    duplicate = conn.execute(
        """
        SELECT id FROM wines
        WHERE id <> ?
          AND lower(trim(producer)) = lower(trim(?))
          AND lower(trim(coalesce(cuvee, ''))) = lower(trim(coalesce(?, '')))
          AND lower(trim(coalesce(appellation, ''))) = lower(trim(coalesce(?, '')))
          AND vintage IS ?
          AND lower(trim(format)) = lower(trim(?))
        LIMIT 1
        """,
        (
            wine_id,
            payload.producer,
            payload.cuvee,
            payload.appellation,
            payload.vintage,
            payload.format,
        ),
    ).fetchone()
    if duplicate:
        raise ConflictError(
            "The edited identity matches another wine. "
            "Use that existing wine or merge the records first."
        )


def _effective_unit_cost(
    *,
    quantity: int,
    price_mode: str,
    amount: float | None,
    fees: float,
    shipping: float,
) -> float | None:
    if amount is None:
        return None
    if amount < 0 or fees < 0 or shipping < 0:
        raise ValidationError("Purchase amounts cannot be negative", field="amount")
    base = amount / quantity if price_mode == "total" else amount
    return round(base + (fees + shipping) / quantity, 4)


def _adjust_holding_average(
    holding: Holding,
    *,
    old_unit: float | None,
    new_unit: float | None,
    allocation_quantity: int,
) -> None:
    if holding.quantity <= 0 or allocation_quantity >= holding.quantity:
        holding.price_bought = new_unit
        return
    if new_unit is None:
        # A mixed holding containing one unknown-cost lot has no defensible
        # aggregate cost. Keeping a stale average would be misleading.
        holding.price_bought = None
        return
    if holding.price_bought is None or old_unit is None:
        # The previous aggregate was already unknown; one corrected component
        # is insufficient to reconstruct the other lots.
        holding.price_bought = None
        return
    total = holding.price_bought * holding.quantity
    total -= old_unit * allocation_quantity
    total += new_unit * allocation_quantity
    holding.price_bought = round(total / holding.quantity, 4)


def _update_acquisition(
    conn: sqlite3.Connection,
    *,
    holding: Holding,
    acquisition_id: str,
    price_mode: str,
    amount: float | None,
    currency: str,
    purchase_date: date | None,
) -> dict[str, Any]:
    row = conn.execute(
        """
        SELECT a.*, aa.quantity AS allocation_quantity
        FROM acquisition_allocations aa
        JOIN acquisitions a ON a.id = aa.acquisition_id
        WHERE aa.holding_id = ? AND a.id = ?
        """,
        (holding.id, acquisition_id),
    ).fetchone()
    if row is None:
        raise ValidationError(
            "The selected acquisition is not allocated to this holding",
            field="acquisition_id",
        )
    acquisition = dict(row)
    if price_mode not in {"per_bottle", "total"}:
        raise ValidationError("Invalid price mode", field="price_mode")
    currency = currency.strip().upper()
    if len(currency) != 3 or not currency.isalpha():
        raise ValidationError("Currency must be a three-letter code", field="currency")

    new_unit = _effective_unit_cost(
        quantity=int(acquisition["quantity"]),
        price_mode=price_mode,
        amount=amount,
        fees=float(acquisition["fees"] or 0),
        shipping=float(acquisition["shipping"] or 0),
    )
    _adjust_holding_average(
        holding,
        old_unit=acquisition["effective_unit_cost"],
        new_unit=new_unit,
        allocation_quantity=int(acquisition["allocation_quantity"]),
    )
    conn.execute(
        """
        UPDATE acquisitions
        SET price_mode = ?, amount = ?, currency = ?, purchase_date = ?,
            effective_unit_cost = ?
        WHERE id = ?
        """,
        (
            price_mode,
            amount,
            currency,
            _date_text(purchase_date),
            new_unit,
            acquisition_id,
        ),
    )

    dates = [
        item[0]
        for item in conn.execute(
            """
            SELECT a.purchase_date
            FROM acquisition_allocations aa
            JOIN acquisitions a ON a.id = aa.acquisition_id
            WHERE aa.holding_id = ? AND a.purchase_date IS NOT NULL
            """,
            (holding.id,),
        ).fetchall()
    ]
    holding.acquired_date = date.fromisoformat(min(dates)) if dates else None
    acquisition_after = dict(acquisition)
    acquisition_after.update(
        price_mode=price_mode,
        amount=amount,
        currency=currency,
        purchase_date=_date_text(purchase_date),
        effective_unit_cost=new_unit,
    )
    return {"before": acquisition, "after": acquisition_after}


def edit_bottle(
    conn: sqlite3.Connection,
    *,
    holding_id: str,
    payload: BottleEditIn,
    user_id: str,
) -> BottleEditResult:
    """Edit shared wine identity and one holding/acquisition in one transaction."""

    assert_database_valid(conn)
    holding = repo.get_holding(conn, holding_id)
    if holding is None:
        raise NotFoundError(f"Holding {holding_id} not found")
    wine = repo.get_wine(conn, holding.wine_id)
    if wine is None:
        raise NotFoundError(f"Wine {holding.wine_id} not found")
    if wine.version != payload.expected_wine_version:
        raise ConflictError(f"Wine {wine.id} was modified concurrently", current=wine)
    if holding.version != payload.expected_holding_version:
        raise ConflictError(f"Holding {holding.id} was modified concurrently", current=holding)

    _validate_identity(payload)
    _reject_duplicate_identity(conn, wine.id, payload)
    before = {"wine": asdict(wine), "holding": asdict(holding)}
    before["sweetness"] = sweetness_service.get_wine_sweetness(conn, wine.id)

    wine.producer = payload.producer.strip()
    wine.cuvee = _normalize_optional(payload.cuvee)
    wine.appellation = _normalize_optional(payload.appellation)
    wine.vintage = payload.vintage
    wine.color = payload.color
    wine.area = _normalize_optional(payload.area)
    wine.format = payload.format.strip()
    wine.format_ml = parse_format_ml(wine.format)

    linked_acquisitions = _linked_acquisitions(conn, holding.id)
    acquisition_change = None
    if linked_acquisitions and not payload.acquisition_id:
        raise ValidationError(
            "Select the acquisition lot whose purchase details should be changed",
            field="acquisition_id",
        )
    if payload.acquisition_id:
        acquisition_change = _update_acquisition(
            conn,
            holding=holding,
            acquisition_id=payload.acquisition_id,
            price_mode=payload.price_mode,
            amount=payload.amount,
            currency=payload.currency,
            purchase_date=payload.purchase_date,
        )
    else:
        if payload.legacy_price_bought is not None and payload.legacy_price_bought < 0:
            raise ValidationError("Purchase price cannot be negative", field="legacy_price_bought")
        holding.price_bought = payload.legacy_price_bought
        holding.acquired_date = payload.legacy_acquired_date

    repo.update_wine(conn, wine, expected_version=payload.expected_wine_version)
    repo.update_holding(conn, holding, expected_version=payload.expected_holding_version)
    sweetness_service.set_wine_sweetness(
        conn,
        wine_id=wine.id,
        sweetness=_normalize_optional(getattr(payload, "sweetness", before["sweetness"])),
    )

    details = {
        "before": before,
        "after": {"wine": asdict(wine), "holding": asdict(holding)},
        "acquisition": acquisition_change,
    }
    details["after"]["sweetness"] = sweetness_service.get_wine_sweetness(conn, wine.id)
    movement = Movement(
        id=new_id(),
        action=MovementAction.UPDATE.value,
        wine_id=wine.id,
        holding_id=holding.id,
        from_cellar_id=holding.cellar_id,
        from_location=holding.location,
        to_cellar_id=holding.cellar_id,
        to_location=holding.location,
        quantity_delta=0,
        user_id=user_id,
        note="Bottle details corrected",
        details_json=json.dumps(details, default=str, ensure_ascii=False),
    )
    repo.insert_movement(conn, movement)
    assert_database_valid(conn)
    return BottleEditResult(wine=wine, holding=holding)
