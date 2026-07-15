from __future__ import annotations

import sqlite3

from app.services import csv_io, sweetness_service
from app.storage.database import Database


def _mapping() -> dict[str, str]:
    return {
        "producer": "column_1",
        "cuvee": "column_2",
        "appellation": "column_3",
        "vintage": "column_4",
        "color": "column_5",
        "area": "column_6",
        "format": "column_7",
    }


def test_combined_colour_preserves_sweetness() -> None:
    assert csv_io.parse_color_and_sweetness("blanc moelleux") == ("white", "moelleux")
    assert csv_io.parse_color_and_sweetness("sweet red") == ("red", "sweet")
    assert csv_io.parse_color_and_sweetness("rouge liquoreux") == ("red", "liquoreux")
    assert csv_io.parse_color_and_sweetness("white", "demi-sec") == ("white", "demi-sec")
    assert csv_io.parse_color_and_sweetness("blanc sec") == ("white", "sec")


def test_csv_import_stores_sweetness_separately() -> None:
    db = Database(":memory:")
    conn = db.connect()
    raw = (
        b"Producer,Cuvee,Appellation,Vintage,Color,Area,Format\n"
        b"Example,Reserve,Test AOC,2020,blanc moelleux,Test,75cl\n"
    )
    report = csv_io.import_csv(raw, conn=conn, user_id=None, mapping=_mapping())
    assert report.imported == 1
    wine_id = report.created_wine_ids[0]
    wine = conn.execute("SELECT color FROM wines WHERE id = ?", (wine_id,)).fetchone()
    assert wine["color"] == "white"
    assert sweetness_service.get_wine_sweetness(conn, wine_id) == "moelleux"


def test_explicit_sweetness_column_takes_precedence_during_import() -> None:
    db = Database(":memory:")
    conn = db.connect()
    raw = (
        b"Producer,Cuvee,Appellation,Vintage,Color,Area,Format,Sweetness\n"
        b"Example,Reserve,Test AOC,2020,sweet white,Test,75cl,demi-sec\n"
    )
    mapping = _mapping()
    mapping["sweetness"] = "column_8"
    report = csv_io.import_csv(raw, conn=conn, user_id=None, mapping=mapping)
    wine_id = report.created_wine_ids[0]
    assert sweetness_service.get_wine_sweetness(conn, wine_id) == "demi-sec"


def test_sweetness_update_preserves_other_identity_details() -> None:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE wines (id TEXT PRIMARY KEY);
        CREATE TABLE wine_identity_details (
            wine_id TEXT PRIMARY KEY REFERENCES wines(id),
            country TEXT,
            region TEXT,
            classification TEXT,
            vineyard TEXT,
            sweetness TEXT,
            alcohol_percentage REAL,
            grapes_json TEXT NOT NULL DEFAULT '[]',
            certifications_json TEXT NOT NULL DEFAULT '[]',
            external_identifiers_json TEXT NOT NULL DEFAULT '{}',
            barcode TEXT,
            field_sources_json TEXT NOT NULL DEFAULT '{}',
            updated_at TEXT NOT NULL
        );
        INSERT INTO wines (id) VALUES ('w1');
        INSERT INTO wine_identity_details (
            wine_id, country, sweetness, grapes_json, certifications_json,
            external_identifiers_json, field_sources_json, updated_at
        ) VALUES ('w1', 'France', 'dry', '["Chenin"]', '[]', '{}', '{}', 'old');
        """
    )
    sweetness_service.set_wine_sweetness(conn, wine_id="w1", sweetness="moelleux")
    row = conn.execute("SELECT * FROM wine_identity_details WHERE wine_id='w1'").fetchone()
    assert row["sweetness"] == "moelleux"
    assert row["country"] == "France"
    assert row["grapes_json"] == '["Chenin"]'

    sweetness_service.set_wine_sweetness(conn, wine_id="w1", sweetness=None)
    row = conn.execute("SELECT * FROM wine_identity_details WHERE wine_id='w1'").fetchone()
    assert row["sweetness"] is None
    assert row["country"] == "France"
