"""Read and write wine sweetness without duplicating the core wine record.

Sweetness belongs to the extended wine identity stored in
``wine_identity_details``.  The focused helpers below deliberately update only
that column so CSV imports and typo corrections cannot erase grapes, country,
classification, barcode or other identity details.
"""

from __future__ import annotations

import sqlite3

from app.core.domain import utcnow


def get_wine_sweetness(conn: sqlite3.Connection, wine_id: str) -> str | None:
    row = conn.execute(
        "SELECT sweetness FROM wine_identity_details WHERE wine_id = ?",
        (wine_id,),
    ).fetchone()
    return row[0] if row else None


def set_wine_sweetness(
    conn: sqlite3.Connection,
    *,
    wine_id: str,
    sweetness: str | None,
) -> None:
    """Set or clear sweetness while preserving every other identity detail."""
    value = sweetness.strip() if sweetness and sweetness.strip() else None
    conn.execute(
        """
        INSERT INTO wine_identity_details (wine_id, sweetness, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(wine_id) DO UPDATE SET
            sweetness = excluded.sweetness,
            updated_at = excluded.updated_at
        """,
        (wine_id, value, utcnow().isoformat()),
    )
