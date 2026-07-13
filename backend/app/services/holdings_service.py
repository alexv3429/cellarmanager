"""Transactional add / move / remove bottle actions.

The offline idempotency key is reserved before any quantity is changed and
completed in the same SQLite transaction. Replaying a completed request returns
the original result without touching stock; a real optimistic-concurrency
conflict remains a conflict for the client to resolve.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import date

from app.core.domain import Holding, HoldingState, Movement, MovementAction, new_id
from app.core.exceptions import ConflictError, NotFoundError, ValidationError
from app.storage import repositories as repo


@dataclass
class ActionResult:
    holding: Holding
    movement: Movement | None
    warning: str | None = None
    duplicate: bool = False


def _capacity_warning(conn, cellar_id: str | None) -> str | None:
    if not cellar_id:
        return None
    cellar = repo.get_cellar(conn, cellar_id)
    if not cellar or cellar.is_overflow or cellar.max_capacity <= 0:
        return None
    fill = repo.cellar_fill(conn, cellar_id)
    if fill > cellar.max_capacity:
        return f"'{cellar.name}' is now over its estimated max capacity ({fill}/{cellar.max_capacity})."
    if cellar.threshold and fill > cellar.threshold:
        return f"'{cellar.name}' is above its alert threshold ({fill}/{cellar.threshold})."
    return None


def _fingerprint(action: str, payload: dict) -> str:
    encoded = json.dumps(
        {"action": action, **payload}, sort_keys=True, separators=(",", ":"), default=str
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _reserve_or_replay(
    conn, *, client_op_id: str | None, action: str, payload: dict
) -> ActionResult | None:
    is_new, operation = repo.reserve_client_operation(
        conn, client_op_id, action, _fingerprint(action, payload)
    )
    if is_new:
        return None
    if not operation or not operation.get("holding_id"):
        raise ConflictError(f"Completed client operation {client_op_id} has no stored result")
    holding = repo.get_holding(conn, operation["holding_id"])
    movement = (
        repo.get_movement(conn, operation["movement_id"])
        if operation.get("movement_id")
        else repo.get_movement_by_client_op_id(conn, client_op_id)
    )
    if holding is None:
        raise ConflictError(f"Stored result for client operation {client_op_id} no longer exists")
    return ActionResult(holding=holding, movement=movement, duplicate=True)


def _complete(conn, client_op_id: str | None, holding: Holding, movement: Movement) -> None:
    repo.complete_client_operation(
        conn, client_op_id, holding_id=holding.id, movement_id=movement.id
    )


def _merge_purchase_metadata(
    destination: Holding,
    *,
    existing_quantity: int,
    incoming_quantity: int,
    incoming_price: float | None,
    incoming_date: date | None,
) -> None:
    """Merge acquisition metadata without pretending unknown costs are known.

    If both lots have known unit prices, keep a quantity-weighted average. If
    either side has an unknown price, the merged price becomes unknown rather
    than making total-value statistics falsely precise.
    """
    if existing_quantity <= 0:
        destination.price_bought = incoming_price
    elif destination.price_bought is not None and incoming_price is not None:
        total = existing_quantity + incoming_quantity
        destination.price_bought = round(
            (destination.price_bought * existing_quantity + incoming_price * incoming_quantity)
            / total,
            4,
        )
    elif incoming_quantity > 0:
        destination.price_bought = None

    if destination.acquired_date and incoming_date:
        destination.acquired_date = min(destination.acquired_date, incoming_date)
    elif destination.acquired_date is None:
        destination.acquired_date = incoming_date


def add_bottles(
    conn,
    *,
    wine_id: str,
    cellar_id: str | None,
    location: str | None,
    quantity: int,
    price_bought: float | None = None,
    acquired_date: date | None = None,
    user_id: str | None = None,
    note: str | None = None,
    client_op_id: str | None = None,
) -> ActionResult:
    replay = _reserve_or_replay(
        conn,
        client_op_id=client_op_id,
        action=MovementAction.ADD.value,
        payload={
            "wine_id": wine_id,
            "cellar_id": cellar_id,
            "location": location,
            "quantity": quantity,
            "price_bought": price_bought,
            "acquired_date": acquired_date,
        },
    )
    if replay:
        replay.warning = _capacity_warning(conn, replay.holding.cellar_id)
        return replay

    if quantity <= 0:
        raise ValidationError("Quantity to add must be positive")
    if price_bought is not None and price_bought < 0:
        raise ValidationError("Purchase price cannot be negative")
    wine = repo.get_wine(conn, wine_id)
    if wine is None:
        raise NotFoundError(f"Wine {wine_id} not found")
    if cellar_id and repo.get_cellar(conn, cellar_id) is None:
        raise NotFoundError(f"Cellar {cellar_id} not found")

    existing = repo.find_active_holding(conn, wine_id, cellar_id, location)
    if existing:
        old_quantity = existing.quantity
        _merge_purchase_metadata(
            existing,
            existing_quantity=old_quantity,
            incoming_quantity=quantity,
            incoming_price=price_bought,
            incoming_date=acquired_date,
        )
        existing.quantity += quantity
        holding = repo.update_holding(conn, existing, expected_version=existing.version)
    else:
        holding = Holding(
            id=new_id(),
            wine_id=wine_id,
            cellar_id=cellar_id,
            location=location,
            quantity=quantity,
            state=HoldingState.IN_CELLAR.value,
            price_bought=price_bought,
            acquired_date=acquired_date,
        )
        repo.insert_holding(conn, holding)

    movement = repo.insert_movement(
        conn,
        Movement(
            id=new_id(),
            action=MovementAction.ADD.value,
            wine_id=wine_id,
            holding_id=holding.id,
            to_cellar_id=cellar_id,
            to_location=location,
            quantity_delta=quantity,
            user_id=user_id,
            note=note,
            client_op_id=client_op_id,
        ),
    )
    if movement is None:
        raise ConflictError(f"Journal operation {client_op_id} already exists")
    _complete(conn, client_op_id, holding, movement)
    return ActionResult(
        holding=holding,
        movement=movement,
        warning=_capacity_warning(conn, cellar_id),
    )


def move_bottles(
    conn,
    *,
    holding_id: str,
    quantity: int,
    to_cellar_id: str | None,
    to_location: str | None,
    user_id: str | None = None,
    note: str | None = None,
    client_op_id: str | None = None,
    expected_version: int | None = None,
) -> ActionResult:
    replay = _reserve_or_replay(
        conn,
        client_op_id=client_op_id,
        action=MovementAction.MOVE.value,
        payload={
            "holding_id": holding_id,
            "quantity": quantity,
            "to_cellar_id": to_cellar_id,
            "to_location": to_location,
            "expected_version": expected_version,
        },
    )
    if replay:
        replay.warning = _capacity_warning(conn, replay.holding.cellar_id)
        return replay

    if quantity <= 0:
        raise ValidationError("Quantity to move must be positive")
    source = repo.get_holding(conn, holding_id)
    if source is None:
        raise NotFoundError(f"Holding {holding_id} not found")
    if source.state != HoldingState.IN_CELLAR.value or source.quantity <= 0:
        raise ValidationError("Only active bottles can be moved")
    if expected_version is not None and source.version != expected_version:
        raise ConflictError(f"Holding {holding_id} was modified concurrently", current=source)
    if source.quantity < quantity:
        raise ValidationError(f"Cannot move {quantity} bottles; only {source.quantity} available")
    if to_cellar_id and repo.get_cellar(conn, to_cellar_id) is None:
        raise NotFoundError(f"Cellar {to_cellar_id} not found")
    if source.cellar_id == to_cellar_id and (source.location or "") == (to_location or ""):
        raise ValidationError("Source and destination are the same")

    from_cellar_id, from_location = source.cellar_id, source.location
    source.quantity -= quantity
    repo.update_holding(conn, source, expected_version=source.version)

    destination = repo.find_active_holding(conn, source.wine_id, to_cellar_id, to_location)
    if destination:
        old_quantity = destination.quantity
        _merge_purchase_metadata(
            destination,
            existing_quantity=old_quantity,
            incoming_quantity=quantity,
            incoming_price=source.price_bought,
            incoming_date=source.acquired_date,
        )
        destination.quantity += quantity
        target_holding = repo.update_holding(
            conn, destination, expected_version=destination.version
        )
    else:
        target_holding = Holding(
            id=new_id(),
            wine_id=source.wine_id,
            cellar_id=to_cellar_id,
            location=to_location,
            quantity=quantity,
            state=HoldingState.IN_CELLAR.value,
            price_bought=source.price_bought,
            acquired_date=source.acquired_date,
        )
        repo.insert_holding(conn, target_holding)

    movement = repo.insert_movement(
        conn,
        Movement(
            id=new_id(),
            action=MovementAction.MOVE.value,
            wine_id=source.wine_id,
            holding_id=target_holding.id,
            from_cellar_id=from_cellar_id,
            from_location=from_location,
            to_cellar_id=to_cellar_id,
            to_location=to_location,
            quantity_delta=quantity,
            user_id=user_id,
            note=note,
            client_op_id=client_op_id,
        ),
    )
    if movement is None:
        raise ConflictError(f"Journal operation {client_op_id} already exists")
    _complete(conn, client_op_id, target_holding, movement)
    return ActionResult(
        holding=target_holding,
        movement=movement,
        warning=_capacity_warning(conn, to_cellar_id),
    )


_REMOVE_REASONS = {
    HoldingState.GIFTED,
    HoldingState.BROKEN,
    HoldingState.SOLD,
    HoldingState.LOST,
    HoldingState.DRUNK,
}


def remove_bottles(
    conn,
    *,
    holding_id: str,
    quantity: int,
    reason: HoldingState,
    user_id: str | None = None,
    note: str | None = None,
    client_op_id: str | None = None,
    expected_version: int | None = None,
) -> ActionResult:
    replay = _reserve_or_replay(
        conn,
        client_op_id=client_op_id,
        action=MovementAction.REMOVE.value,
        payload={
            "holding_id": holding_id,
            "quantity": quantity,
            "reason": reason.value if isinstance(reason, HoldingState) else str(reason),
            "expected_version": expected_version,
        },
    )
    if replay:
        return replay

    if reason not in _REMOVE_REASONS:
        raise ValidationError(f"'{reason}' is not a valid removal reason")
    if quantity <= 0:
        raise ValidationError("Quantity to remove must be positive")
    source = repo.get_holding(conn, holding_id)
    if source is None:
        raise NotFoundError(f"Holding {holding_id} not found")
    if source.state != HoldingState.IN_CELLAR.value or source.quantity <= 0:
        raise ValidationError("Only active bottles can be removed")
    if expected_version is not None and source.version != expected_version:
        raise ConflictError(f"Holding {holding_id} was modified concurrently", current=source)
    if source.quantity < quantity:
        raise ValidationError(f"Cannot remove {quantity} bottles; only {source.quantity} available")

    source.quantity -= quantity
    repo.update_holding(conn, source, expected_version=source.version)

    removed_holding = Holding(
        id=new_id(),
        wine_id=source.wine_id,
        cellar_id=source.cellar_id,
        location=source.location,
        quantity=quantity,
        state=reason.value,
        price_bought=source.price_bought,
        acquired_date=source.acquired_date,
    )
    repo.insert_holding(conn, removed_holding)

    movement = repo.insert_movement(
        conn,
        Movement(
            id=new_id(),
            action=MovementAction.REMOVE.value,
            wine_id=source.wine_id,
            holding_id=removed_holding.id,
            from_cellar_id=source.cellar_id,
            from_location=source.location,
            quantity_delta=-quantity,
            user_id=user_id,
            note=note or reason.value,
            client_op_id=client_op_id,
        ),
    )
    if movement is None:
        raise ConflictError(f"Journal operation {client_op_id} already exists")
    _complete(conn, client_op_id, removed_holding, movement)
    return ActionResult(holding=removed_holding, movement=movement)


def locations_for_wine(conn, wine_id: str) -> list[dict]:
    holdings = repo.list_holdings(
        conn,
        wine_id=wine_id,
        state=HoldingState.IN_CELLAR.value,
        active_only=True,
    )
    results = []
    for holding in holdings:
        cellar = repo.get_cellar(conn, holding.cellar_id) if holding.cellar_id else None
        results.append(
            {
                "holding_id": holding.id,
                "cellar_id": holding.cellar_id,
                "cellar_name": cellar.name if cellar else None,
                "location": holding.location,
                "quantity": holding.quantity,
            }
        )
    return results
