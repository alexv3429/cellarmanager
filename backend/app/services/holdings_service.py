"""Add / move / remove bottle actions (requirement 5.a-c).

Each action mutates ``Holding`` rows and always appends a ``Movement`` to the
journal in the same transaction, so the journal is never out of sync with
the current state. Capacity checks are advisory (cellars are approximate,
per the spec) - operations succeed but return a warning message when they
push a cellar over its max capacity or threshold.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Optional

from app.core.domain import Holding, HoldingState, Movement, MovementAction, new_id, utcnow
from app.core.exceptions import ConflictError, NotFoundError, ValidationError
from app.storage import repositories as repo


@dataclass
class ActionResult:
    holding: Holding
    movement: Optional[Movement]
    warning: Optional[str] = None


def _capacity_warning(conn, cellar_id: Optional[str]) -> Optional[str]:
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


def add_bottles(
    conn, *, wine_id: str, cellar_id: Optional[str], location: Optional[str], quantity: int,
    price_bought: Optional[float] = None, acquired_date: Optional[date] = None,
    user_id: Optional[str] = None, note: Optional[str] = None, client_op_id: Optional[str] = None,
) -> ActionResult:
    if quantity <= 0:
        raise ValidationError("Quantity to add must be positive")
    wine = repo.get_wine(conn, wine_id)
    if wine is None:
        raise NotFoundError(f"Wine {wine_id} not found")

    existing = repo.find_active_holding(conn, wine_id, cellar_id, location)
    if existing:
        existing.quantity += quantity
        holding = repo.update_holding(conn, existing, expected_version=existing.version)
    else:
        holding = Holding(
            id=new_id(), wine_id=wine_id, cellar_id=cellar_id, location=location,
            quantity=quantity, state=HoldingState.IN_CELLAR.value,
            price_bought=price_bought, acquired_date=acquired_date,
        )
        repo.insert_holding(conn, holding)

    movement = repo.insert_movement(conn, Movement(
        id=new_id(), action=MovementAction.ADD.value, wine_id=wine_id, holding_id=holding.id,
        to_cellar_id=cellar_id, to_location=location, quantity_delta=quantity,
        user_id=user_id, note=note, client_op_id=client_op_id,
    ))
    return ActionResult(holding=holding, movement=movement, warning=_capacity_warning(conn, cellar_id))


def move_bottles(
    conn, *, holding_id: str, quantity: int, to_cellar_id: Optional[str], to_location: Optional[str],
    user_id: Optional[str] = None, note: Optional[str] = None, client_op_id: Optional[str] = None,
    expected_version: Optional[int] = None,
) -> ActionResult:
    if quantity <= 0:
        raise ValidationError("Quantity to move must be positive")
    source = repo.get_holding(conn, holding_id)
    if source is None:
        raise NotFoundError(f"Holding {holding_id} not found")
    if expected_version is not None and source.version != expected_version:
        raise ConflictError(f"Holding {holding_id} was modified concurrently", current=source)
    if source.quantity < quantity:
        raise ValidationError(f"Cannot move {quantity} bottles; only {source.quantity} available")

    from_cellar_id, from_location = source.cellar_id, source.location
    source.quantity -= quantity
    repo.update_holding(conn, source, expected_version=source.version)

    destination = repo.find_active_holding(conn, source.wine_id, to_cellar_id, to_location)
    if destination and destination.id != source.id:
        destination.quantity += quantity
        repo.update_holding(conn, destination, expected_version=destination.version)
        target_holding = destination
    elif destination is None:
        target_holding = Holding(
            id=new_id(), wine_id=source.wine_id, cellar_id=to_cellar_id, location=to_location,
            quantity=quantity, state=HoldingState.IN_CELLAR.value, price_bought=source.price_bought,
            acquired_date=source.acquired_date,
        )
        repo.insert_holding(conn, target_holding)
    else:
        # Moving within the exact same cellar/location is a no-op destination;
        # just restore the quantity we speculatively removed above.
        source.quantity += quantity
        repo.update_holding(conn, source, expected_version=source.version)
        target_holding = source

    movement = repo.insert_movement(conn, Movement(
        id=new_id(), action=MovementAction.MOVE.value, wine_id=source.wine_id, holding_id=target_holding.id,
        from_cellar_id=from_cellar_id, from_location=from_location,
        to_cellar_id=to_cellar_id, to_location=to_location, quantity_delta=quantity,
        user_id=user_id, note=note, client_op_id=client_op_id,
    ))
    return ActionResult(holding=target_holding, movement=movement, warning=_capacity_warning(conn, to_cellar_id))


_REMOVE_REASONS = {
    HoldingState.GIFTED, HoldingState.BROKEN, HoldingState.SOLD,
    HoldingState.LOST, HoldingState.DRUNK,
}


def remove_bottles(
    conn, *, holding_id: str, quantity: int, reason: HoldingState,
    user_id: Optional[str] = None, note: Optional[str] = None, client_op_id: Optional[str] = None,
    expected_version: Optional[int] = None,
) -> ActionResult:
    if reason not in _REMOVE_REASONS:
        raise ValidationError(f"'{reason}' is not a valid removal reason")
    if quantity <= 0:
        raise ValidationError("Quantity to remove must be positive")
    source = repo.get_holding(conn, holding_id)
    if source is None:
        raise NotFoundError(f"Holding {holding_id} not found")
    if expected_version is not None and source.version != expected_version:
        raise ConflictError(f"Holding {holding_id} was modified concurrently", current=source)
    if source.quantity < quantity:
        raise ValidationError(f"Cannot remove {quantity} bottles; only {source.quantity} available")

    source.quantity -= quantity
    repo.update_holding(conn, source, expected_version=source.version)

    removed_holding = Holding(
        id=new_id(), wine_id=source.wine_id, cellar_id=source.cellar_id, location=source.location,
        quantity=quantity, state=reason.value, price_bought=source.price_bought,
        acquired_date=source.acquired_date,
    )
    repo.insert_holding(conn, removed_holding)

    movement = repo.insert_movement(conn, Movement(
        id=new_id(), action=MovementAction.REMOVE.value, wine_id=source.wine_id, holding_id=removed_holding.id,
        from_cellar_id=source.cellar_id, from_location=source.location, quantity_delta=-quantity,
        user_id=user_id, note=note or reason.value, client_op_id=client_op_id,
    ))
    return ActionResult(holding=removed_holding, movement=movement)


def locations_for_wine(conn, wine_id: str) -> list[dict]:
    """All active (in-cellar) holdings of a given wine, across every cellar -
    requirement 10.b."""
    holdings = repo.list_holdings(conn, wine_id=wine_id, state=HoldingState.IN_CELLAR.value, active_only=True)
    results = []
    for h in holdings:
        cellar = repo.get_cellar(conn, h.cellar_id) if h.cellar_id else None
        results.append({
            "holding_id": h.id,
            "cellar_id": h.cellar_id,
            "cellar_name": cellar.name if cellar else None,
            "location": h.location,
            "quantity": h.quantity,
        })
    return results
