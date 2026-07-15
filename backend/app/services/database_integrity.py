"""Fast, read-only database checks used before and after sensitive edits."""

from __future__ import annotations

import sqlite3

from app.core.domain import HoldingState, WineColor
from app.core.exceptions import ValidationError


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    return (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
        ).fetchone()
        is not None
    )


def _first_bad_id(conn: sqlite3.Connection, query: str, params: tuple = ()) -> str | None:
    row = conn.execute(query, params).fetchone()
    return str(row[0]) if row else None


def assert_database_valid(conn: sqlite3.Connection) -> None:
    """Raise before a mutation if SQLite or core domain invariants are invalid.

    ``quick_check`` detects structural corruption, ``foreign_key_check`` catches
    broken relationships, and the targeted queries protect invariants that may
    pre-date newer CHECK constraints. The same function is intentionally run
    again before commit so the whole edit can be rolled back if it introduced
    an invalid state.
    """

    quick_rows = [str(row[0]) for row in conn.execute("PRAGMA quick_check").fetchall()]
    if quick_rows != ["ok"]:
        raise ValidationError(
            "Database quick check failed: " + "; ".join(quick_rows[:5]),
            field="database",
        )

    foreign_rows = conn.execute("PRAGMA foreign_key_check").fetchall()
    if foreign_rows:
        first = foreign_rows[0]
        raise ValidationError(
            f"Database foreign-key check failed for table {first[0]} row {first[1]}",
            field="database",
        )

    colors = tuple(item.value for item in WineColor)
    color_placeholders = ",".join("?" for _ in colors)
    bad = _first_bad_id(
        conn,
        f"""
        SELECT id FROM wines
        WHERE trim(producer) = ''
           OR trim(format) = ''
           OR color NOT IN ({color_placeholders})
        LIMIT 1
        """,
        colors,
    )
    if bad:
        raise ValidationError(f"Database contains an invalid wine record ({bad})", field="database")

    states = tuple(item.value for item in HoldingState)
    state_placeholders = ",".join("?" for _ in states)
    bad = _first_bad_id(
        conn,
        f"""
        SELECT id FROM holdings
        WHERE quantity < 0
           OR state NOT IN ({state_placeholders})
           OR (price_bought IS NOT NULL AND price_bought < 0)
        LIMIT 1
        """,
        states,
    )
    if bad:
        raise ValidationError(
            f"Database contains an invalid holding record ({bad})", field="database"
        )

    if _table_exists(conn, "acquisitions"):
        bad = _first_bad_id(
            conn,
            """
            SELECT id FROM acquisitions
            WHERE quantity <= 0
               OR price_mode NOT IN ('per_bottle', 'total')
               OR (amount IS NOT NULL AND amount < 0)
               OR fees < 0
               OR shipping < 0
               OR (effective_unit_cost IS NOT NULL AND effective_unit_cost < 0)
               OR length(trim(currency)) <> 3
               OR trim(currency) GLOB '*[^A-Za-z]*'
            LIMIT 1
            """,
        )
        if bad:
            raise ValidationError(
                f"Database contains an invalid acquisition record ({bad})",
                field="database",
            )

    if _table_exists(conn, "acquisition_allocations"):
        bad = _first_bad_id(
            conn,
            """
            SELECT aa.id
            FROM acquisition_allocations aa
            JOIN acquisitions a ON a.id = aa.acquisition_id
            WHERE aa.quantity <= 0
               OR (
                    SELECT coalesce(sum(total.quantity), 0)
                    FROM acquisition_allocations total
                    WHERE total.acquisition_id = aa.acquisition_id
                  ) > a.quantity
            LIMIT 1
            """,
        )
        if bad:
            raise ValidationError(
                f"Database contains an invalid acquisition allocation ({bad})",
                field="database",
            )
