"""Persistence helpers for evidence-backed Internet enrichment.

The main repository module deliberately stays focused on cellar inventory. This
module owns the durable research queue, evidence, candidates, market
observations, accepted profiles and external wine identifiers.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from typing import Any


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _loads(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return default


def create_job(
    conn: sqlite3.Connection,
    *,
    job_id: str,
    wine_id: str,
    user_id: str,
    provider: str,
    topics: list[str],
    locale: str,
    auto_apply: bool,
    model: str | None,
) -> dict[str, Any]:
    created_at = _now()
    conn.execute(
        """
        INSERT INTO enrichment_jobs (
            id, wine_id, user_id, provider, topics_json, locale, auto_apply,
            status, model, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
        """,
        (
            job_id,
            wine_id,
            user_id,
            provider,
            json.dumps(topics, ensure_ascii=False),
            locale,
            1 if auto_apply else 0,
            model,
            created_at,
        ),
    )
    return get_job(conn, job_id) or {}


def set_job_running(conn: sqlite3.Connection, job_id: str) -> None:
    conn.execute(
        """
        UPDATE enrichment_jobs
        SET status='running', started_at=?, error_code=NULL, error_message=NULL
        WHERE id=?
        """,
        (_now(), job_id),
    )


def complete_job(
    conn: sqlite3.Connection,
    job_id: str,
    *,
    summary: str,
    usage: dict[str, Any] | None,
    raw_response_json: str | None,
) -> None:
    usage = usage or {}
    conn.execute(
        """
        UPDATE enrichment_jobs
        SET status='completed', completed_at=?, summary=?, usage_json=?,
            input_tokens=?, output_tokens=?, total_tokens=?, raw_response_json=?
        WHERE id=?
        """,
        (
            _now(),
            summary,
            json.dumps(usage, ensure_ascii=False),
            int(usage.get("input_tokens") or 0),
            int(usage.get("output_tokens") or 0),
            int(usage.get("total_tokens") or 0),
            raw_response_json,
            job_id,
        ),
    )


def fail_job(
    conn: sqlite3.Connection,
    job_id: str,
    *,
    code: str,
    message: str,
) -> None:
    conn.execute(
        """
        UPDATE enrichment_jobs
        SET status='failed', completed_at=?, error_code=?, error_message=?
        WHERE id=?
        """,
        (_now(), code, message[:2000], job_id),
    )


def get_job(conn: sqlite3.Connection, job_id: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM enrichment_jobs WHERE id=?", (job_id,)).fetchone()
    if not row:
        return None
    result = dict(row)
    result["topics"] = _loads(result.pop("topics_json", None), [])
    result["usage"] = _loads(result.pop("usage_json", None), {})
    result["auto_apply"] = bool(result.get("auto_apply"))
    return result


def get_job_with_results(conn: sqlite3.Connection, job_id: str) -> dict[str, Any] | None:
    job = get_job(conn, job_id)
    if job is None:
        return None
    job["sources"] = list_sources(conn, job_id)
    job["candidates"] = list_candidates(conn, job_id)
    job["market_observations"] = list_market_observations(conn, job_id)
    return job


def list_jobs_for_wine(
    conn: sqlite3.Connection,
    wine_id: str,
    *,
    limit: int = 20,
) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT * FROM enrichment_jobs
        WHERE wine_id=?
        ORDER BY created_at DESC
        LIMIT ?
        """,
        (wine_id, limit),
    ).fetchall()
    return [get_job_with_results(conn, row["id"]) for row in rows]


def insert_source(
    conn: sqlite3.Connection,
    *,
    source_id: str,
    job_id: str,
    url: str,
    title: str | None,
    publisher: str | None,
    domain: str,
    source_type: str,
    retrieved_at: str,
    published_at: str | None,
    excerpt: str | None,
    content_hash: str | None,
    reliability: float,
    identity_score: float,
    metadata: dict[str, Any] | None = None,
) -> None:
    conn.execute(
        """
        INSERT OR IGNORE INTO enrichment_sources (
            id, job_id, url, title, publisher, domain, source_type,
            retrieved_at, published_at, excerpt, content_hash, reliability,
            identity_score, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            source_id,
            job_id,
            url,
            title,
            publisher,
            domain,
            source_type,
            retrieved_at,
            published_at,
            (excerpt or "")[:1000] or None,
            content_hash,
            reliability,
            identity_score,
            json.dumps(metadata or {}, ensure_ascii=False),
        ),
    )


def list_sources(conn: sqlite3.Connection, job_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT * FROM enrichment_sources
        WHERE job_id=?
        ORDER BY reliability DESC, domain, url
        """,
        (job_id,),
    ).fetchall()
    results = []
    for row in rows:
        item = dict(row)
        item["metadata"] = _loads(item.pop("metadata_json", None), {})
        results.append(item)
    return results


def insert_candidate(
    conn: sqlite3.Connection,
    *,
    candidate_id: str,
    job_id: str,
    wine_id: str,
    topic: str,
    label: str,
    value: dict[str, Any] | list[Any],
    confidence: float,
    method: str,
    rationale: str,
    source_ids: list[str],
) -> None:
    conn.execute(
        """
        INSERT INTO enrichment_candidates (
            id, job_id, wine_id, topic, label, value_json, confidence,
            method, rationale, source_ids_json, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?)
        """,
        (
            candidate_id,
            job_id,
            wine_id,
            topic,
            label,
            json.dumps(value, ensure_ascii=False),
            confidence,
            method,
            rationale[:4000],
            json.dumps(source_ids),
            _now(),
        ),
    )


def _row_to_candidate(row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    item["value"] = _loads(item.pop("value_json", None), {})
    item["source_ids"] = _loads(item.pop("source_ids_json", None), [])
    return item


def get_candidate(conn: sqlite3.Connection, candidate_id: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM enrichment_candidates WHERE id=?", (candidate_id,)).fetchone()
    return _row_to_candidate(row) if row else None


def list_candidates(conn: sqlite3.Connection, job_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT * FROM enrichment_candidates
        WHERE job_id=?
        ORDER BY topic, confidence DESC, created_at
        """,
        (job_id,),
    ).fetchall()
    return [_row_to_candidate(row) for row in rows]


def decide_candidate(
    conn: sqlite3.Connection,
    candidate_id: str,
    *,
    status: str,
    reviewer_id: str,
) -> None:
    conn.execute(
        """
        UPDATE enrichment_candidates
        SET status=?, reviewed_at=?, reviewer_id=?
        WHERE id=?
        """,
        (status, _now(), reviewer_id, candidate_id),
    )


def insert_market_observation(
    conn: sqlite3.Connection,
    *,
    observation_id: str,
    job_id: str,
    wine_id: str,
    source_id: str | None,
    amount: float,
    currency: str,
    offer_type: str,
    bottle_count: int,
    format_ml: int | None,
    tax_included: bool | None,
    in_stock: bool | None,
    exact_match: bool,
    observed_at: str | None,
    notes: str | None,
) -> None:
    conn.execute(
        """
        INSERT INTO market_observations (
            id, job_id, wine_id, source_id, amount, currency, offer_type,
            bottle_count, format_ml, tax_included, in_stock, exact_match,
            observed_at, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            observation_id,
            job_id,
            wine_id,
            source_id,
            amount,
            currency.upper(),
            offer_type,
            max(1, bottle_count),
            format_ml,
            None if tax_included is None else (1 if tax_included else 0),
            None if in_stock is None else (1 if in_stock else 0),
            1 if exact_match else 0,
            observed_at,
            (notes or "")[:1000] or None,
            _now(),
        ),
    )


def list_market_observations(conn: sqlite3.Connection, job_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT * FROM market_observations
        WHERE job_id=?
        ORDER BY currency, amount
        """,
        (job_id,),
    ).fetchall()
    results = []
    for row in rows:
        item = dict(row)
        for key in ("tax_included", "in_stock", "exact_match"):
            if item[key] is not None:
                item[key] = bool(item[key])
        results.append(item)
    return results


def upsert_profile_topic(
    conn: sqlite3.Connection,
    *,
    wine_id: str,
    topic: str,
    value: Any,
    candidate_id: str,
) -> None:
    row = conn.execute(
        "SELECT profile_json, version FROM wine_enrichment_profiles WHERE wine_id=?",
        (wine_id,),
    ).fetchone()
    profile = _loads(row["profile_json"], {}) if row else {}
    profile[topic] = {
        "value": value,
        "candidate_id": candidate_id,
        "accepted_at": _now(),
    }
    if row:
        conn.execute(
            """
            UPDATE wine_enrichment_profiles
            SET profile_json=?, updated_at=?, version=version+1
            WHERE wine_id=?
            """,
            (json.dumps(profile, ensure_ascii=False), _now(), wine_id),
        )
    else:
        conn.execute(
            """
            INSERT INTO wine_enrichment_profiles (
                wine_id, profile_json, updated_at, version
            ) VALUES (?, ?, ?, 1)
            """,
            (wine_id, json.dumps(profile, ensure_ascii=False), _now()),
        )


def get_profile(conn: sqlite3.Connection, wine_id: str) -> dict[str, Any]:
    row = conn.execute(
        "SELECT * FROM wine_enrichment_profiles WHERE wine_id=?", (wine_id,)
    ).fetchone()
    if not row:
        return {"wine_id": wine_id, "profile": {}, "version": 0}
    return {
        "wine_id": wine_id,
        "profile": _loads(row["profile_json"], {}),
        "updated_at": row["updated_at"],
        "version": row["version"],
    }


def upsert_external_identifier(
    conn: sqlite3.Connection,
    *,
    wine_id: str,
    scheme: str,
    value: str,
    confidence: float,
    source_id: str | None,
) -> None:
    conn.execute(
        """
        INSERT INTO wine_external_identifiers (
            wine_id, scheme, value, confidence, source_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(wine_id, scheme) DO UPDATE SET
            value=excluded.value,
            confidence=excluded.confidence,
            source_id=excluded.source_id,
            updated_at=excluded.updated_at
        """,
        (wine_id, scheme.lower(), value, confidence, source_id, _now()),
    )


def list_external_identifiers(conn: sqlite3.Connection, wine_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT * FROM wine_external_identifiers
        WHERE wine_id=? ORDER BY scheme
        """,
        (wine_id,),
    ).fetchall()
    return [dict(row) for row in rows]


def jobs_created_since(conn: sqlite3.Connection, since_iso: str) -> int:
    row = conn.execute(
        "SELECT COUNT(*) AS n FROM enrichment_jobs WHERE created_at>=?", (since_iso,)
    ).fetchone()
    return int(row["n"])


def automatic_jobs_created_since(conn: sqlite3.Connection, since_iso: str) -> int:
    """Count only jobs that can consume automatic provider capacity."""
    row = conn.execute(
        """
        SELECT COUNT(*) AS n
        FROM enrichment_jobs
        WHERE created_at>=? AND provider!='manual_chatgpt'
        """,
        (since_iso,),
    ).fetchone()
    return int(row["n"])


def cap_candidate_confidence_for_job(
    conn: sqlite3.Connection,
    job_id: str,
    maximum: float,
) -> None:
    """Lower candidate confidence for a job without increasing any value."""
    maximum = max(0.0, min(1.0, float(maximum)))
    conn.execute(
        """
        UPDATE enrichment_candidates
        SET confidence=CASE WHEN confidence>? THEN ? ELSE confidence END
        WHERE job_id=?
        """,
        (maximum, maximum, job_id),
    )


def tokens_used_since(conn: sqlite3.Connection, since_iso: str) -> int:
    row = conn.execute(
        """
        SELECT COALESCE(SUM(total_tokens), 0) AS n
        FROM enrichment_jobs
        WHERE created_at>=? AND status='completed'
        """,
        (since_iso,),
    ).fetchone()
    return int(row["n"])


def get_profiles(conn: sqlite3.Connection, wine_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Return accepted enrichment profile payloads keyed by wine id."""
    if not wine_ids:
        return {}
    placeholders = ",".join("?" for _ in wine_ids)
    rows = conn.execute(
        f"SELECT wine_id, profile_json FROM wine_enrichment_profiles "
        f"WHERE wine_id IN ({placeholders})",
        wine_ids,
    ).fetchall()
    return {row["wine_id"]: _loads(row["profile_json"], {}) for row in rows}
