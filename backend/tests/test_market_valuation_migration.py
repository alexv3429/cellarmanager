from __future__ import annotations

import sqlite3
from pathlib import Path

from app.storage.database import Database

SCHEMA_PATH = Path(__file__).parents[1] / "app" / "storage" / "schema.sql"


def test_startup_adds_valuation_columns_to_legacy_database(tmp_path) -> None:
    path = tmp_path / "legacy.sqlite3"
    conn = sqlite3.connect(path)
    conn.execute(
        """CREATE TABLE wines (
            id TEXT PRIMARY KEY, producer TEXT NOT NULL, cuvee TEXT, appellation TEXT,
            vintage INTEGER, color TEXT NOT NULL DEFAULT 'other', area TEXT,
            format TEXT NOT NULL DEFAULT '75cl', format_ml INTEGER,
            drink_after TEXT, drink_after_confidence REAL, drink_after_source TEXT,
            drink_before TEXT, drink_before_confidence REAL, drink_before_source TEXT,
            market_value REAL, market_value_confidence REAL, market_value_source TEXT,
            market_value_updated_at TEXT, advice_experience TEXT, advice_pairing TEXT,
            notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1
        )"""
    )
    conn.execute(
        "INSERT INTO wines (id,producer,market_value,market_value_source,created_at,updated_at) VALUES ('manual','A',10,'user','2026-01-01','2026-01-01')"
    )
    conn.execute(
        "INSERT INTO wines (id,producer,market_value,market_value_source,created_at,updated_at) VALUES ('research','B',20,'research:old-job','2026-01-01','2026-01-01')"
    )
    conn.commit()
    conn.close()

    db = Database(str(path))
    migrated = db.connect()
    columns = {row["name"] for row in migrated.execute("PRAGMA table_info(wines)")}
    assert {
        "market_value_currency",
        "market_value_basis",
        "quick_sale_value",
    } <= columns
    rows = {row["id"]: row for row in migrated.execute("SELECT * FROM wines")}
    assert rows["manual"]["market_value_basis"] == "manual"
    assert rows["research"]["market_value_basis"] == "replacement_value"
    db.close_all()


def test_startup_refuses_invalid_database_before_migration(tmp_path) -> None:
    path = tmp_path / "invalid.sqlite3"
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        PRAGMA foreign_keys=OFF;
        CREATE TABLE wines (id TEXT PRIMARY KEY);
        CREATE TABLE holdings (
            id TEXT PRIMARY KEY,
            wine_id TEXT NOT NULL REFERENCES wines(id)
        );
        INSERT INTO holdings (id, wine_id) VALUES ('orphan', 'missing');
        """
    )
    conn.close()

    db = Database(str(path))
    try:
        db.connect()
    except sqlite3.DatabaseError as exc:
        assert "foreign-key check failed before schema migration" in str(exc)
    else:  # pragma: no cover - makes the failure message explicit
        raise AssertionError("invalid database was accepted")

    conn = sqlite3.connect(path)
    columns = {row[1] for row in conn.execute("PRAGMA table_info(wines)")}
    conn.close()
    assert "market_value_currency" not in columns
