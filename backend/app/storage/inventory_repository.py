"""Persistence helpers for acquisitions, allocations, media and identity details."""

from __future__ import annotations

import json
import sqlite3
from typing import Any


def insert_identity_details(
    conn: sqlite3.Connection, *, wine_id: str, details: dict[str, Any], now: str
) -> None:
    conn.execute(
        """
        INSERT INTO wine_identity_details (
            wine_id, country, region, classification, vineyard, sweetness,
            alcohol_percentage, grapes_json, certifications_json,
            external_identifiers_json, barcode, field_sources_json, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(wine_id) DO UPDATE SET
            country=excluded.country,
            region=excluded.region,
            classification=excluded.classification,
            vineyard=excluded.vineyard,
            sweetness=excluded.sweetness,
            alcohol_percentage=excluded.alcohol_percentage,
            grapes_json=excluded.grapes_json,
            certifications_json=excluded.certifications_json,
            external_identifiers_json=excluded.external_identifiers_json,
            barcode=excluded.barcode,
            field_sources_json=excluded.field_sources_json,
            updated_at=excluded.updated_at
        """,
        (
            wine_id,
            details.get("country"),
            details.get("region"),
            details.get("classification"),
            details.get("vineyard"),
            details.get("sweetness"),
            details.get("alcohol_percentage"),
            json.dumps(details.get("grapes") or [], ensure_ascii=False),
            json.dumps(details.get("certifications") or [], ensure_ascii=False),
            json.dumps(details.get("external_identifiers") or {}, ensure_ascii=False),
            details.get("barcode"),
            json.dumps(details.get("field_sources") or {}, ensure_ascii=False),
            now,
        ),
    )


def insert_acquisition(conn: sqlite3.Connection, values: dict[str, Any]) -> None:
    columns = ", ".join(values)
    placeholders = ", ".join("?" for _ in values)
    conn.execute(
        f"INSERT INTO acquisitions ({columns}) VALUES ({placeholders})",
        tuple(values.values()),
    )


def insert_allocation(conn: sqlite3.Connection, values: dict[str, Any]) -> None:
    columns = ", ".join(values)
    placeholders = ", ".join("?" for _ in values)
    conn.execute(
        f"INSERT INTO acquisition_allocations ({columns}) VALUES ({placeholders})",
        tuple(values.values()),
    )


def insert_candidate(conn: sqlite3.Connection, values: dict[str, Any]) -> None:
    columns = ", ".join(values)
    placeholders = ", ".join("?" for _ in values)
    conn.execute(
        f"INSERT INTO inventory_ai_candidates ({columns}) VALUES ({placeholders})",
        tuple(values.values()),
    )


def insert_media(conn: sqlite3.Connection, values: dict[str, Any]) -> None:
    columns = ", ".join(values)
    placeholders = ", ".join("?" for _ in values)
    conn.execute(
        f"INSERT INTO media_files ({columns}) VALUES ({placeholders})",
        tuple(values.values()),
    )


def acquisition_by_client_op(conn: sqlite3.Connection, client_op_id: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM acquisitions WHERE client_op_id = ?", (client_op_id,)
    ).fetchone()


def get_acquisition(conn: sqlite3.Connection, acquisition_id: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM acquisitions WHERE id = ?", (acquisition_id,)).fetchone()


def get_allocation_for_acquisition(
    conn: sqlite3.Connection, acquisition_id: str
) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM acquisition_allocations WHERE acquisition_id = ? ORDER BY created_at LIMIT 1",
        (acquisition_id,),
    ).fetchone()


def get_media(conn: sqlite3.Connection, media_id: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM media_files WHERE id = ?", (media_id,)).fetchone()


def list_media_for_acquisition(conn: sqlite3.Connection, acquisition_id: str) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM media_files WHERE acquisition_id = ? ORDER BY created_at",
        (acquisition_id,),
    ).fetchall()
