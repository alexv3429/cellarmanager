"""SQLite connection management.

For a personal/family-scale wine cellar (hundreds to low thousands of rows)
a single SQLite file is simple, fast, and trivially backed up. Each worker
thread gets its own connection (SQLite connections must not be shared across
threads), while a single in-memory database (used by the test suite) keeps
one shared connection so every caller sees the same data.

If this project ever needs to scale beyond one household/server, swap this
module for SQLAlchemy + PostgreSQL: every other module only calls functions
in ``app.storage.repositories``, never raw SQL, so the change is localized.
"""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

SCHEMA_PATH = Path(__file__).parent / "schema.sql"


class Database:
    def __init__(self, path: str):
        self.path = path
        self._is_memory = path == ":memory:"
        if not self._is_memory:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        self._memory_conn: sqlite3.Connection | None = None
        if self._is_memory:
            self._memory_conn = self._new_connection()
            self._init_schema(self._memory_conn)

    def _new_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _init_schema(self, conn: sqlite3.Connection) -> None:
        self._assert_integrity(conn, stage="before schema migration")
        try:
            # sqlite3.executescript commits any pending transaction before it
            # starts. Put BEGIN inside the script so schema creation, additive
            # migration and profile backfill remain one rollbackable unit.
            schema = SCHEMA_PATH.read_text(encoding="utf-8")
            conn.executescript(f"BEGIN IMMEDIATE;\n{schema}")
            self._migrate_wine_valuation_columns(conn)
            # Accepted profiles may predate the Wine compatibility fields.
            from app.services.market_valuation_service import (
                backfill_accepted_market_valuations,
            )

            backfill_accepted_market_valuations(conn)
            self._assert_integrity(conn, stage="after valuation migration")
        except Exception:
            conn.rollback()
            raise
        else:
            conn.commit()

    @staticmethod
    def _assert_integrity(conn: sqlite3.Connection, *, stage: str) -> None:
        result = conn.execute("PRAGMA integrity_check").fetchone()
        if result is None or result[0] != "ok":
            detail = result[0] if result else "no result"
            raise sqlite3.DatabaseError(f"SQLite integrity check failed {stage}: {detail}")
        violations = conn.execute("PRAGMA foreign_key_check").fetchall()
        if violations:
            first = violations[0]
            raise sqlite3.DatabaseError(
                f"SQLite foreign-key check failed {stage}: "
                f"table={first[0]} rowid={first[1]} parent={first[2]}"
            )

    @staticmethod
    def _migrate_wine_valuation_columns(conn: sqlite3.Connection) -> None:
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(wines)")}
        additions = {
            "market_value_currency": "TEXT",
            "market_value_basis": "TEXT",
            "quick_sale_value": "REAL",
            "quick_sale_currency": "TEXT",
            "quick_sale_confidence": "REAL",
            "quick_sale_source": "TEXT",
            "quick_sale_updated_at": "TEXT",
        }
        for name, sql_type in additions.items():
            if name not in columns:
                conn.execute(f"ALTER TABLE wines ADD COLUMN {name} {sql_type}")

        # Legacy research values were retail replacement estimates. Other
        # existing values are manual; their currency remains explicitly unknown.
        conn.execute(
            """
            UPDATE wines
            SET market_value_basis = CASE
                WHEN coalesce(market_value_source, '') LIKE 'research:%'
                    THEN 'replacement_value'
                ELSE 'manual'
            END
            WHERE market_value IS NOT NULL AND market_value_basis IS NULL
            """
        )

    def connect(self) -> sqlite3.Connection:
        """Return a connection valid for use on the current thread."""
        if self._is_memory:
            assert self._memory_conn is not None
            return self._memory_conn
        if not hasattr(self._local, "conn"):
            conn = self._new_connection()
            self._init_schema(conn)
            self._local.conn = conn
        return self._local.conn

    @contextmanager
    def session(self) -> Iterator[sqlite3.Connection]:
        """Context manager that commits on success and rolls back on error."""
        conn = self.connect()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    def close_thread_connection(self) -> None:
        if not self._is_memory and hasattr(self._local, "conn"):
            self._local.conn.close()
            del self._local.conn

    def close_all(self) -> None:
        if self._is_memory and self._memory_conn is not None:
            self._memory_conn.close()
        else:
            self.close_thread_connection()
