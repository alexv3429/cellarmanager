"""SQLite-backed repositories.

Deliberately implemented with the standard-library ``sqlite3`` module rather
than an ORM: the data volume for a personal/family wine cellar is small, and
depending only on the standard library means the whole persistence layer can
be exercised in unit tests with zero extra installation.

Every function takes an open ``sqlite3.Connection`` as its first argument so
callers (services, tests) control transaction boundaries via
``Database.session()``.
"""
from __future__ import annotations

import sqlite3
from datetime import date, datetime
from typing import Optional

from app.core.domain import Cellar, Holding, Movement, User, Wine, utcnow
from app.core.exceptions import ConflictError, NotFoundError

# ---------------------------------------------------------------------------
# serialization helpers
# ---------------------------------------------------------------------------


def _d(value: Optional[date]) -> Optional[str]:
    return value.isoformat() if value else None


def _dt(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _parse_date(value: Optional[str]) -> Optional[date]:
    return date.fromisoformat(value) if value else None


def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    return datetime.fromisoformat(value) if value else None


def _bool(value) -> int:
    return 1 if value else 0


# ---------------------------------------------------------------------------
# wines
# ---------------------------------------------------------------------------

def _row_to_wine(row: sqlite3.Row) -> Wine:
    return Wine(
        id=row["id"],
        producer=row["producer"],
        cuvee=row["cuvee"],
        appellation=row["appellation"],
        vintage=row["vintage"],
        color=row["color"],
        area=row["area"],
        format=row["format"],
        format_ml=row["format_ml"],
        drink_after=_parse_date(row["drink_after"]),
        drink_after_confidence=row["drink_after_confidence"],
        drink_after_source=row["drink_after_source"],
        drink_before=_parse_date(row["drink_before"]),
        drink_before_confidence=row["drink_before_confidence"],
        drink_before_source=row["drink_before_source"],
        market_value=row["market_value"],
        market_value_confidence=row["market_value_confidence"],
        market_value_source=row["market_value_source"],
        market_value_updated_at=_parse_dt(row["market_value_updated_at"]),
        advice_experience=row["advice_experience"],
        advice_pairing=row["advice_pairing"],
        notes=row["notes"],
        created_at=_parse_dt(row["created_at"]),
        updated_at=_parse_dt(row["updated_at"]),
        version=row["version"],
    )


def insert_wine(conn: sqlite3.Connection, wine: Wine) -> Wine:
    conn.execute(
        """
        INSERT INTO wines (
            id, producer, cuvee, appellation, vintage, color, area, format, format_ml,
            drink_after, drink_after_confidence, drink_after_source,
            drink_before, drink_before_confidence, drink_before_source,
            market_value, market_value_confidence, market_value_source, market_value_updated_at,
            advice_experience, advice_pairing, notes, created_at, updated_at, version
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            wine.id, wine.producer, wine.cuvee, wine.appellation, wine.vintage,
            wine.color, wine.area, wine.format, wine.format_ml,
            _d(wine.drink_after), wine.drink_after_confidence, wine.drink_after_source,
            _d(wine.drink_before), wine.drink_before_confidence, wine.drink_before_source,
            wine.market_value, wine.market_value_confidence, wine.market_value_source,
            _dt(wine.market_value_updated_at),
            wine.advice_experience, wine.advice_pairing, wine.notes,
            _dt(wine.created_at), _dt(wine.updated_at), wine.version,
        ),
    )
    return wine


def get_wine(conn: sqlite3.Connection, wine_id: str) -> Optional[Wine]:
    row = conn.execute("SELECT * FROM wines WHERE id = ?", (wine_id,)).fetchone()
    return _row_to_wine(row) if row else None


def find_wine_by_identity(
    conn: sqlite3.Connection,
    producer: str,
    cuvee: Optional[str],
    appellation: Optional[str],
    vintage: Optional[int],
    format: str,
) -> Optional[Wine]:
    row = conn.execute(
        """
        SELECT * FROM wines
        WHERE lower(trim(producer)) = lower(trim(?))
          AND lower(trim(coalesce(cuvee, ''))) = lower(trim(coalesce(?, '')))
          AND lower(trim(coalesce(appellation, ''))) = lower(trim(coalesce(?, '')))
          AND vintage IS ?
          AND lower(trim(format)) = lower(trim(?))
        """,
        (producer, cuvee, appellation, vintage, format),
    ).fetchone()
    return _row_to_wine(row) if row else None


def list_wines(conn: sqlite3.Connection, search: Optional[str] = None) -> list[Wine]:
    if search:
        like = f"%{search.strip().lower()}%"
        rows = conn.execute(
            """
            SELECT * FROM wines
            WHERE lower(producer) LIKE ? OR lower(coalesce(cuvee,'')) LIKE ?
               OR lower(coalesce(appellation,'')) LIKE ? OR lower(coalesce(area,'')) LIKE ?
            ORDER BY producer, cuvee
            """,
            (like, like, like, like),
        ).fetchall()
    else:
        rows = conn.execute("SELECT * FROM wines ORDER BY producer, cuvee").fetchall()
    return [_row_to_wine(r) for r in rows]


def list_wines_by_ids(conn: sqlite3.Connection, wine_ids: list[str]) -> dict[str, Wine]:
    if not wine_ids:
        return {}
    placeholders = ",".join("?" for _ in wine_ids)
    rows = conn.execute(f"SELECT * FROM wines WHERE id IN ({placeholders})", wine_ids).fetchall()
    return {r["id"]: _row_to_wine(r) for r in rows}


def update_wine(conn: sqlite3.Connection, wine: Wine, expected_version: int) -> Wine:
    now = utcnow()
    cur = conn.execute(
        """
        UPDATE wines SET
            producer=?, cuvee=?, appellation=?, vintage=?, color=?, area=?, format=?, format_ml=?,
            drink_after=?, drink_after_confidence=?, drink_after_source=?,
            drink_before=?, drink_before_confidence=?, drink_before_source=?,
            market_value=?, market_value_confidence=?, market_value_source=?, market_value_updated_at=?,
            advice_experience=?, advice_pairing=?, notes=?, updated_at=?, version=version+1
        WHERE id=? AND version=?
        """,
        (
            wine.producer, wine.cuvee, wine.appellation, wine.vintage, wine.color, wine.area,
            wine.format, wine.format_ml,
            _d(wine.drink_after), wine.drink_after_confidence, wine.drink_after_source,
            _d(wine.drink_before), wine.drink_before_confidence, wine.drink_before_source,
            wine.market_value, wine.market_value_confidence, wine.market_value_source,
            _dt(wine.market_value_updated_at),
            wine.advice_experience, wine.advice_pairing, wine.notes, _dt(now),
            wine.id, expected_version,
        ),
    )
    if cur.rowcount == 0:
        current = get_wine(conn, wine.id)
        if current is None:
            raise NotFoundError(f"Wine {wine.id} not found")
        raise ConflictError(f"Wine {wine.id} was modified concurrently", current=current)
    wine.version = expected_version + 1
    wine.updated_at = now
    return wine


# ---------------------------------------------------------------------------
# cellars
# ---------------------------------------------------------------------------

def _row_to_cellar(row: sqlite3.Row) -> Cellar:
    return Cellar(
        id=row["id"],
        name=row["name"],
        purpose_level=row["purpose_level"],
        is_overflow=bool(row["is_overflow"]),
        max_capacity=row["max_capacity"],
        threshold=row["threshold"],
        location_rule=row["location_rule"],
        layout=row["layout"],
        created_at=_parse_dt(row["created_at"]),
        updated_at=_parse_dt(row["updated_at"]),
    )


def insert_cellar(conn: sqlite3.Connection, cellar: Cellar) -> Cellar:
    try:
        conn.execute(
            """
            INSERT INTO cellars (
                id, name, purpose_level, is_overflow, max_capacity, threshold,
                location_rule, layout, created_at, updated_at, version
            ) VALUES (?,?,?,?,?,?,?,?,?,?,1)
            """,
            (
                cellar.id, cellar.name, cellar.purpose_level, _bool(cellar.is_overflow),
                cellar.max_capacity, cellar.threshold, cellar.location_rule, cellar.layout,
                _dt(cellar.created_at), _dt(cellar.updated_at),
            ),
        )
    except sqlite3.IntegrityError as exc:
        raise ConflictError(f"A cellar named '{cellar.name}' already exists") from exc
    return cellar


def get_cellar(conn: sqlite3.Connection, cellar_id: str) -> Optional[Cellar]:
    row = conn.execute("SELECT * FROM cellars WHERE id = ?", (cellar_id,)).fetchone()
    return _row_to_cellar(row) if row else None


def get_cellar_by_name(conn: sqlite3.Connection, name: str) -> Optional[Cellar]:
    row = conn.execute(
        "SELECT * FROM cellars WHERE lower(trim(name)) = lower(trim(?))", (name,)
    ).fetchone()
    return _row_to_cellar(row) if row else None


def list_cellars(conn: sqlite3.Connection) -> list[Cellar]:
    rows = conn.execute("SELECT * FROM cellars ORDER BY is_overflow, purpose_level, name").fetchall()
    return [_row_to_cellar(r) for r in rows]


def update_cellar(conn: sqlite3.Connection, cellar: Cellar, expected_version: int) -> Cellar:
    now = utcnow()
    try:
        cur = conn.execute(
            """
            UPDATE cellars SET
                name=?, purpose_level=?, is_overflow=?, max_capacity=?, threshold=?,
                location_rule=?, layout=?, updated_at=?, version=version+1
            WHERE id=? AND version=?
            """,
            (
                cellar.name, cellar.purpose_level, _bool(cellar.is_overflow),
                cellar.max_capacity, cellar.threshold, cellar.location_rule, cellar.layout,
                _dt(now), cellar.id, expected_version,
            ),
        )
    except sqlite3.IntegrityError as exc:
        raise ConflictError(f"A cellar named '{cellar.name}' already exists") from exc
    if cur.rowcount == 0:
        current = get_cellar(conn, cellar.id)
        if current is None:
            raise NotFoundError(f"Cellar {cellar.id} not found")
        raise ConflictError(f"Cellar {cellar.id} was modified concurrently", current=current)
    cellar.updated_at = now
    return cellar


def delete_cellar(conn: sqlite3.Connection, cellar_id: str) -> None:
    try:
        cur = conn.execute("DELETE FROM cellars WHERE id = ?", (cellar_id,))
    except sqlite3.IntegrityError as exc:
        raise ConflictError(
            "This cellar still has bottles in it. Move or remove them before deleting it."
        ) from exc
    if cur.rowcount == 0:
        raise NotFoundError(f"Cellar {cellar_id} not found")


def cellar_fill(conn: sqlite3.Connection, cellar_id: str) -> int:
    """Current number of bottles physically in a cellar (active holdings only)."""
    row = conn.execute(
        "SELECT COALESCE(SUM(quantity), 0) AS n FROM holdings WHERE cellar_id = ? AND state = 'in_cellar'",
        (cellar_id,),
    ).fetchone()
    return int(row["n"])


# ---------------------------------------------------------------------------
# holdings
# ---------------------------------------------------------------------------

def _row_to_holding(row: sqlite3.Row) -> Holding:
    return Holding(
        id=row["id"],
        wine_id=row["wine_id"],
        cellar_id=row["cellar_id"],
        location=row["location"],
        quantity=row["quantity"],
        state=row["state"],
        price_bought=row["price_bought"],
        acquired_date=_parse_date(row["acquired_date"]),
        created_at=_parse_dt(row["created_at"]),
        updated_at=_parse_dt(row["updated_at"]),
        version=row["version"],
    )


def insert_holding(conn: sqlite3.Connection, holding: Holding) -> Holding:
    conn.execute(
        """
        INSERT INTO holdings (
            id, wine_id, cellar_id, location, quantity, state,
            price_bought, acquired_date, created_at, updated_at, version
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            holding.id, holding.wine_id, holding.cellar_id, holding.location,
            holding.quantity, holding.state, holding.price_bought,
            _d(holding.acquired_date), _dt(holding.created_at), _dt(holding.updated_at),
            holding.version,
        ),
    )
    return holding


def get_holding(conn: sqlite3.Connection, holding_id: str) -> Optional[Holding]:
    row = conn.execute("SELECT * FROM holdings WHERE id = ?", (holding_id,)).fetchone()
    return _row_to_holding(row) if row else None


def find_active_holding(
    conn: sqlite3.Connection, wine_id: str, cellar_id: Optional[str], location: Optional[str]
) -> Optional[Holding]:
    """Find an existing IN_CELLAR holding of the same wine at the same spot,
    so add/import/move operations can merge into it instead of fragmenting
    quantities across many near-duplicate rows."""
    row = conn.execute(
        """
        SELECT * FROM holdings
        WHERE wine_id = ? AND state = 'in_cellar'
          AND cellar_id IS ?
          AND coalesce(location,'') = coalesce(?, '')
        LIMIT 1
        """,
        (wine_id, cellar_id, location),
    ).fetchone()
    return _row_to_holding(row) if row else None


def list_holdings(
    conn: sqlite3.Connection,
    wine_id: Optional[str] = None,
    cellar_id: Optional[str] = None,
    state: Optional[str] = None,
    active_only: bool = False,
) -> list[Holding]:
    clauses = []
    params: list = []
    if wine_id:
        clauses.append("wine_id = ?")
        params.append(wine_id)
    if cellar_id:
        clauses.append("cellar_id = ?")
        params.append(cellar_id)
    if state:
        clauses.append("state = ?")
        params.append(state)
    if active_only:
        clauses.append("quantity > 0")
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = conn.execute(f"SELECT * FROM holdings {where} ORDER BY created_at", params).fetchall()
    return [_row_to_holding(r) for r in rows]


def update_holding(conn: sqlite3.Connection, holding: Holding, expected_version: int) -> Holding:
    now = utcnow()
    cur = conn.execute(
        """
        UPDATE holdings SET
            cellar_id=?, location=?, quantity=?, state=?, price_bought=?, acquired_date=?,
            updated_at=?, version=version+1
        WHERE id=? AND version=?
        """,
        (
            holding.cellar_id, holding.location, holding.quantity, holding.state,
            holding.price_bought, _d(holding.acquired_date), _dt(now),
            holding.id, expected_version,
        ),
    )
    if cur.rowcount == 0:
        current = get_holding(conn, holding.id)
        if current is None:
            raise NotFoundError(f"Holding {holding.id} not found")
        raise ConflictError(f"Holding {holding.id} was modified concurrently", current=current)
    holding.version = expected_version + 1
    holding.updated_at = now
    return holding


def list_holdings_with_wines(
    conn: sqlite3.Connection, cellar_id: Optional[str] = None, active_only: bool = True
) -> list[tuple[Holding, Wine]]:
    """Convenience join used heavily by stats/recommendations/export."""
    clauses = []
    params: list = []
    if cellar_id:
        clauses.append("h.cellar_id = ?")
        params.append(cellar_id)
    if active_only:
        clauses.append("h.quantity > 0")
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = conn.execute(
        f"""
        SELECT h.*, w.* , h.id as h_id, w.id as w_id
        FROM holdings h JOIN wines w ON w.id = h.wine_id
        {where}
        ORDER BY w.producer, w.cuvee
        """,
        params,
    ).fetchall()
    results = []
    for r in rows:
        holding = Holding(
            id=r["h_id"], wine_id=r["wine_id"], cellar_id=r["cellar_id"], location=r["location"],
            quantity=r["quantity"], state=r["state"], price_bought=r["price_bought"],
            acquired_date=_parse_date(r["acquired_date"]), created_at=_parse_dt(r["created_at"]),
            updated_at=_parse_dt(r["updated_at"]), version=r["version"],
        )
        wine = Wine(
            id=r["w_id"], producer=r["producer"], cuvee=r["cuvee"], appellation=r["appellation"],
            vintage=r["vintage"], color=r["color"], area=r["area"], format=r["format"],
            format_ml=r["format_ml"], drink_after=_parse_date(r["drink_after"]),
            drink_after_confidence=r["drink_after_confidence"], drink_after_source=r["drink_after_source"],
            drink_before=_parse_date(r["drink_before"]), drink_before_confidence=r["drink_before_confidence"],
            drink_before_source=r["drink_before_source"], market_value=r["market_value"],
            market_value_confidence=r["market_value_confidence"], market_value_source=r["market_value_source"],
            market_value_updated_at=_parse_dt(r["market_value_updated_at"]),
            advice_experience=r["advice_experience"], advice_pairing=r["advice_pairing"], notes=r["notes"],
        )
        results.append((holding, wine))
    return results


# ---------------------------------------------------------------------------
# movements (the journal)
# ---------------------------------------------------------------------------

def _row_to_movement(row: sqlite3.Row) -> Movement:
    return Movement(
        id=row["id"],
        action=row["action"],
        wine_id=row["wine_id"],
        holding_id=row["holding_id"],
        from_cellar_id=row["from_cellar_id"],
        from_location=row["from_location"],
        to_cellar_id=row["to_cellar_id"],
        to_location=row["to_location"],
        quantity_delta=row["quantity_delta"],
        occurred_at=_parse_dt(row["occurred_at"]),
        recorded_at=_parse_dt(row["recorded_at"]),
        user_id=row["user_id"],
        note=row["note"],
        details_json=row["details_json"],
        client_op_id=row["client_op_id"],
    )


def insert_movement(conn: sqlite3.Connection, movement: Movement) -> Optional[Movement]:
    """Insert a journal entry. Returns None (silently) if ``client_op_id`` was
    already recorded before - this is what makes replaying a queued offline
    action safe to retry without double-applying it."""
    try:
        conn.execute(
            """
            INSERT INTO movements (
                id, action, wine_id, holding_id, from_cellar_id, from_location,
                to_cellar_id, to_location, quantity_delta, occurred_at, recorded_at,
                user_id, note, details_json, client_op_id
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                movement.id, movement.action, movement.wine_id, movement.holding_id,
                movement.from_cellar_id, movement.from_location, movement.to_cellar_id,
                movement.to_location, movement.quantity_delta, _dt(movement.occurred_at),
                _dt(movement.recorded_at), movement.user_id, movement.note,
                movement.details_json, movement.client_op_id,
            ),
        )
    except sqlite3.IntegrityError:
        if movement.client_op_id is not None:
            return None  # already processed - idempotent no-op
        raise
    return movement


def list_movements(
    conn: sqlite3.Connection,
    wine_id: Optional[str] = None,
    cellar_id: Optional[str] = None,
    holding_id: Optional[str] = None,
    since: Optional[datetime] = None,
    limit: int = 200,
) -> list[Movement]:
    clauses = []
    params: list = []
    if wine_id:
        clauses.append("wine_id = ?")
        params.append(wine_id)
    if holding_id:
        clauses.append("holding_id = ?")
        params.append(holding_id)
    if cellar_id:
        clauses.append("(from_cellar_id = ? OR to_cellar_id = ?)")
        params.extend([cellar_id, cellar_id])
    if since:
        clauses.append("occurred_at >= ?")
        params.append(_dt(since))
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.append(limit)
    rows = conn.execute(
        f"SELECT * FROM movements {where} ORDER BY occurred_at DESC LIMIT ?", params
    ).fetchall()
    return [_row_to_movement(r) for r in rows]


# ---------------------------------------------------------------------------
# users
# ---------------------------------------------------------------------------

def _row_to_user(row: sqlite3.Row) -> User:
    return User(
        id=row["id"], username=row["username"], password_hash=row["password_hash"],
        password_salt=row["password_salt"], locale=row["locale"],
        created_at=_parse_dt(row["created_at"]),
    )


def insert_user(conn: sqlite3.Connection, user: User) -> User:
    try:
        conn.execute(
            "INSERT INTO users (id, username, password_hash, password_salt, locale, created_at) "
            "VALUES (?,?,?,?,?,?)",
            (user.id, user.username, user.password_hash, user.password_salt, user.locale,
             _dt(user.created_at)),
        )
    except sqlite3.IntegrityError as exc:
        raise ConflictError(f"Username '{user.username}' is already taken") from exc
    return user


def get_user(conn: sqlite3.Connection, user_id: str) -> Optional[User]:
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return _row_to_user(row) if row else None


def get_user_by_username(conn: sqlite3.Connection, username: str) -> Optional[User]:
    row = conn.execute(
        "SELECT * FROM users WHERE lower(username) = lower(?)", (username,)
    ).fetchone()
    return _row_to_user(row) if row else None


def count_users(conn: sqlite3.Connection) -> int:
    return int(conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"])


def list_users(conn: sqlite3.Connection) -> list[User]:
    rows = conn.execute("SELECT * FROM users ORDER BY username").fetchall()
    return [_row_to_user(r) for r in rows]


# ---------------------------------------------------------------------------
# photo hashes (bottle-photo recognition)
# ---------------------------------------------------------------------------

def insert_photo_hash(conn: sqlite3.Connection, hash_id: str, wine_id: str, phash: str) -> None:
    conn.execute(
        "INSERT INTO photo_hashes (id, wine_id, phash, created_at) VALUES (?,?,?,?)",
        (hash_id, wine_id, phash, _dt(utcnow())),
    )


def list_photo_hashes(conn: sqlite3.Connection, wine_id: Optional[str] = None) -> list[tuple[str, str]]:
    if wine_id:
        rows = conn.execute(
            "SELECT wine_id, phash FROM photo_hashes WHERE wine_id = ?", (wine_id,)
        ).fetchall()
    else:
        rows = conn.execute("SELECT wine_id, phash FROM photo_hashes").fetchall()
    return [(r["wine_id"], r["phash"]) for r in rows]
