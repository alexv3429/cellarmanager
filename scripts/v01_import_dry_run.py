#!/usr/bin/env python3
"""Deterministic, read-only CellarManager v0.1 -> v0.2 import dry-run.

The command never writes to PostgreSQL and opens the v0.1 SQLite source read-only.
It creates a consistent temporary SQLite snapshot, exports every source table as
JSONL for full accounting, builds the normalized v0.2 core import plan, and
emits reconciliation reports.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sqlite3
import tempfile
import uuid
from collections import Counter, defaultdict
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

CURRENT_STATE = "in_cellar"
LOCATION_NAMESPACE = uuid.UUID("13e0a8f6-e2a8-5d54-b90c-b97f413490fe")

# Fields represented directly by the current v0.2 normalized core. Everything
# else remains present in the raw source export and is called out as deferred.
V02_WINE_SOURCE_FIELDS = {
    "id",
    "producer",
    "cuvee",
    "appellation",
    "vintage",
    "color",
    "area",
    "format_ml",
    "created_at",
}
V02_CELLAR_SOURCE_FIELDS = {"id", "name", "created_at"}
V02_HOLDING_SOURCE_FIELDS = {
    "id",
    "wine_id",
    "cellar_id",
    "location",
    "quantity",
    "state",
    "updated_at",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a read-only v0.1 -> v0.2 import plan")
    parser.add_argument(
        "--source",
        type=Path,
        required=True,
        help="Path to the authoritative v0.1 winecellar.db",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("/tmp/cellarmanager-v01-import-dry-run"),
        help="Output directory",
    )
    parser.add_argument(
        "--household-id",
        help=(
            "Optional target v0.2 household UUID. If omitted, household_id "
            "is left null in the normalized plan and bound during apply."
        ),
    )
    return parser.parse_args()


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value).strip())


def text_key(value: Any) -> str:
    return clean_text(value).casefold()


def canonical_uuid(value: Any) -> str:
    return str(uuid.UUID(str(value)))


def deterministic_location_uuid(cellar_id: str, code: str) -> str:
    return str(
        uuid.uuid5(
            LOCATION_NAMESPACE,
            f"{canonical_uuid(cellar_id)}|{text_key(code)}",
        )
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def query_rows(
    conn: sqlite3.Connection,
    sql: str,
    params: Iterable[Any] = (),
) -> list[dict[str, Any]]:
    cursor = conn.execute(sql, tuple(params))
    names = [item[0] for item in cursor.description]
    return [dict(zip(names, row, strict=True)) for row in cursor.fetchall()]


def quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def source_tables(conn: sqlite3.Connection) -> list[str]:
    return [
        row["name"]
        for row in query_rows(
            conn,
            """
            select name
            from sqlite_master
            where type = 'table'
              and name not like 'sqlite_%'
            order by name
            """,
        )
    ]


def table_columns(conn: sqlite3.Connection, table: str) -> list[dict[str, Any]]:
    return query_rows(conn, f"pragma table_info({quote_identifier(table)})")


def table_pk_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    return [
        item["name"]
        for item in sorted(
            table_columns(conn, table),
            key=lambda item: int(item["pk"] or 0),
        )
        if int(item["pk"] or 0) > 0
    ]


def snapshot_database(source: Path, target: Path) -> None:
    source_uri = f"file:{source.as_posix()}?mode=ro"
    source_conn = sqlite3.connect(source_uri, uri=True, timeout=30)
    target_conn = sqlite3.connect(target)
    try:
        source_conn.backup(target_conn)
    finally:
        target_conn.close()
        source_conn.close()


def stable_table_rows(conn: sqlite3.Connection, table: str) -> list[dict[str, Any]]:
    pk_columns = table_pk_columns(conn, table)
    order_by = (
        ", ".join(quote_identifier(column) for column in pk_columns) if pk_columns else "rowid"
    )
    return query_rows(
        conn,
        f"select * from {quote_identifier(table)} order by {order_by}",
    )


def write_jsonl(path: Path, items: list[dict[str, Any]]) -> str:
    with path.open("w", encoding="utf-8") as handle:
        for item in items:
            handle.write(
                json.dumps(item, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            )
            handle.write("\n")
    return sha256_file(path)


def export_all_source_tables(
    conn: sqlite3.Connection,
    export_dir: Path,
) -> dict[str, Any]:
    export_dir.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, Any] = {}

    for table in source_tables(conn):
        items = stable_table_rows(conn, table)
        export_path = export_dir / f"{table}.jsonl"
        export_hash = write_jsonl(export_path, items)
        schema_row = conn.execute(
            "select sql from sqlite_master where type='table' and name=?",
            (table,),
        ).fetchone()
        manifest[table] = {
            "rows": len(items),
            "columns": [item["name"] for item in table_columns(conn, table)],
            "primary_key": table_pk_columns(conn, table),
            "schema_sql": schema_row[0] if schema_row else None,
            "export_file": str(export_path.name),
            "export_sha256": export_hash,
        }

    return manifest


def populated_deferred_fields(
    rows: list[dict[str, Any]],
    represented: set[str],
) -> dict[str, int]:
    if not rows:
        return {}

    counts: dict[str, int] = {}
    for column in rows[0]:
        if column in represented:
            continue
        count = sum(
            1 for row in rows if row.get(column) is not None and clean_text(row.get(column)) != ""
        )
        if count:
            counts[column] = count
    return counts


def build_locations(
    source_cellars: list[dict[str, Any]],
    household_id: str | None,
) -> tuple[
    list[dict[str, Any]],
    dict[tuple[str, str], dict[str, Any]],
    dict[str, dict[str, Any]],
    list[dict[str, Any]],
]:
    target_locations: list[dict[str, Any]] = []
    aliases: dict[tuple[str, str], dict[str, Any]] = {}
    unspecified: dict[str, dict[str, Any]] = {}
    blockers: list[dict[str, Any]] = []

    for cellar in source_cellars:
        cellar_id = canonical_uuid(cellar["id"])
        try:
            layout = json.loads(cellar["layout"]) if cellar.get("layout") else {}
        except json.JSONDecodeError as error:
            blockers.append(
                {
                    "type": "INVALID_CELLAR_LAYOUT_JSON",
                    "cellar_id": cellar_id,
                    "cellar_name": cellar.get("name"),
                    "error": str(error),
                }
            )
            continue

        positions = layout.get("location_catalog", {}).get("positions", [])
        seen_target_codes: set[str] = set()

        for position in positions:
            internal = clean_text(position.get("internal"))
            import_code = clean_text(position.get("import"))
            code = internal or import_code
            if not code:
                blockers.append(
                    {
                        "type": "LOCATION_WITHOUT_CODE",
                        "cellar_id": cellar_id,
                        "cellar_name": cellar.get("name"),
                        "position": position,
                    }
                )
                continue

            normalized_code = text_key(code)
            if normalized_code in seen_target_codes:
                blockers.append(
                    {
                        "type": "DUPLICATE_LOCATION_CODE",
                        "cellar_id": cellar_id,
                        "cellar_name": cellar.get("name"),
                        "code": code,
                    }
                )
                continue
            seen_target_codes.add(normalized_code)

            target = {
                "id": deterministic_location_uuid(cellar_id, code),
                "household_id": household_id,
                "cellar_id": cellar_id,
                "code": code,
                "created_at": cellar.get("created_at"),
                "source": {
                    "internal": internal or None,
                    "import": import_code or None,
                    "label": position.get("label"),
                    "unspecified": bool(position.get("unspecified")),
                },
            }
            target_locations.append(target)

            for alias in {internal, import_code, code}:
                alias_key = text_key(alias)
                if not alias_key:
                    continue
                key = (cellar_id, alias_key)
                existing = aliases.get(key)
                if existing and existing["id"] != target["id"]:
                    blockers.append(
                        {
                            "type": "AMBIGUOUS_LOCATION_ALIAS",
                            "cellar_id": cellar_id,
                            "alias": alias,
                            "location_ids": [existing["id"], target["id"]],
                        }
                    )
                aliases[key] = target

            if position.get("unspecified"):
                if cellar_id in unspecified:
                    blockers.append(
                        {
                            "type": "MULTIPLE_UNSPECIFIED_LOCATIONS",
                            "cellar_id": cellar_id,
                        }
                    )
                unspecified[cellar_id] = target

    target_locations.sort(key=lambda item: (item["cellar_id"], text_key(item["code"])))
    return target_locations, aliases, unspecified, blockers


def wine_identity_key(wine: dict[str, Any]) -> tuple[Any, ...]:
    return (
        text_key(wine["producer"]),
        text_key(wine["cuvee"]),
        wine["vintage"],
        text_key(wine["color"]),
        wine["format_ml"],
    )


def build_normalized_plan(
    conn: sqlite3.Connection,
    household_id: str | None,
) -> dict[str, Any]:
    source_wines = stable_table_rows(conn, "wines")
    source_cellars = stable_table_rows(conn, "cellars")
    source_holdings = stable_table_rows(conn, "holdings")

    blockers: list[dict[str, Any]] = []

    target_wines: list[dict[str, Any]] = []
    identity_groups: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)

    for source_wine in source_wines:
        try:
            wine_id = canonical_uuid(source_wine["id"])
        except (ValueError, AttributeError) as error:
            blockers.append(
                {
                    "type": "INVALID_WINE_UUID",
                    "source_id": source_wine.get("id"),
                    "error": str(error),
                }
            )
            continue

        producer = clean_text(source_wine.get("producer"))
        cuvee = clean_text(source_wine.get("cuvee"))
        color = clean_text(source_wine.get("color")).lower()
        vintage = source_wine.get("vintage")
        format_ml = source_wine.get("format_ml")

        if not producer:
            blockers.append({"type": "BLANK_PRODUCER", "wine_id": wine_id})
        if not cuvee:
            blockers.append({"type": "BLANK_CUVEE", "wine_id": wine_id})
        if not color:
            blockers.append({"type": "BLANK_COLOR", "wine_id": wine_id})
        if vintage is not None and not (1800 <= int(vintage) <= 2200):
            blockers.append({"type": "INVALID_VINTAGE", "wine_id": wine_id, "vintage": vintage})
        if isinstance(format_ml, bool) or not isinstance(format_ml, int) or format_ml <= 0:
            blockers.append(
                {
                    "type": "INVALID_FORMAT_ML",
                    "wine_id": wine_id,
                    "format_ml": format_ml,
                }
            )

        target_wine = {
            "id": wine_id,
            "household_id": household_id,
            "producer": producer,
            "cuvee": cuvee,
            "vintage": vintage,
            "color": color,
            "appellation": clean_text(source_wine.get("appellation")) or None,
            "area": clean_text(source_wine.get("area")) or None,
            "format_ml": format_ml,
            "created_at": source_wine.get("created_at"),
        }
        target_wines.append(target_wine)
        identity_groups[wine_identity_key(target_wine)].append(target_wine)

    target_cellars: list[dict[str, Any]] = []
    valid_source_cellars: list[dict[str, Any]] = []
    for source_cellar in source_cellars:
        try:
            cellar_id = canonical_uuid(source_cellar["id"])
        except (ValueError, AttributeError) as error:
            blockers.append(
                {
                    "type": "INVALID_CELLAR_UUID",
                    "source_id": source_cellar.get("id"),
                    "error": str(error),
                }
            )
            continue

        name = clean_text(source_cellar.get("name"))
        if not name:
            blockers.append({"type": "BLANK_CELLAR_NAME", "cellar_id": cellar_id})

        canonical_source = dict(source_cellar)
        canonical_source["id"] = cellar_id
        valid_source_cellars.append(canonical_source)
        target_cellars.append(
            {
                "id": cellar_id,
                "household_id": household_id,
                "name": name,
                "created_at": source_cellar.get("created_at"),
            }
        )

    (
        target_locations,
        location_aliases,
        unspecified_by_cellar,
        location_blockers,
    ) = build_locations(valid_source_cellars, household_id)
    blockers.extend(location_blockers)

    target_wine_ids = {item["id"] for item in target_wines}
    target_cellar_ids = {item["id"] for item in target_cellars}
    target_holdings: list[dict[str, Any]] = []
    target_positions: set[tuple[str, str]] = set()
    skipped_holdings: list[dict[str, Any]] = []
    blank_location_targets: Counter[str] = Counter()

    for source_holding in source_holdings:
        quantity = int(source_holding.get("quantity") or 0)
        state = source_holding.get("state")

        if state != CURRENT_STATE or quantity <= 0:
            skipped_holdings.append(
                {
                    "id": canonical_uuid(source_holding["id"]),
                    "wine_id": canonical_uuid(source_holding["wine_id"]),
                    "state": state,
                    "quantity": quantity,
                    "reason": (
                        "NON_CURRENT_STATE"
                        if state != CURRENT_STATE
                        else "ZERO_OR_NEGATIVE_QUANTITY"
                    ),
                }
            )
            continue

        try:
            holding_id = canonical_uuid(source_holding["id"])
            wine_id = canonical_uuid(source_holding["wine_id"])
            cellar_id = canonical_uuid(source_holding["cellar_id"])
        except (ValueError, AttributeError, TypeError) as error:
            blockers.append(
                {
                    "type": "INVALID_CURRENT_HOLDING_UUID",
                    "source_holding_id": source_holding.get("id"),
                    "error": str(error),
                }
            )
            continue

        if wine_id not in target_wine_ids:
            blockers.append(
                {"type": "UNKNOWN_HOLDING_WINE", "holding_id": holding_id, "wine_id": wine_id}
            )
            continue
        if cellar_id not in target_cellar_ids:
            blockers.append(
                {
                    "type": "UNKNOWN_HOLDING_CELLAR",
                    "holding_id": holding_id,
                    "cellar_id": cellar_id,
                }
            )
            continue

        source_location = clean_text(source_holding.get("location"))
        if source_location:
            target_location = location_aliases.get((cellar_id, text_key(source_location)))
        else:
            target_location = unspecified_by_cellar.get(cellar_id)
            if target_location:
                blank_location_targets[target_location["code"]] += 1

        if target_location is None:
            blockers.append(
                {
                    "type": "UNMAPPED_HOLDING_LOCATION",
                    "holding_id": holding_id,
                    "cellar_id": cellar_id,
                    "source_location": source_holding.get("location"),
                    "quantity": quantity,
                }
            )
            continue

        position = (wine_id, target_location["id"])
        if position in target_positions:
            blockers.append(
                {
                    "type": "DUPLICATE_TARGET_HOLDING_POSITION",
                    "holding_id": holding_id,
                    "wine_id": wine_id,
                    "location_id": target_location["id"],
                }
            )
            continue
        target_positions.add(position)

        target_holdings.append(
            {
                "id": holding_id,
                "household_id": household_id,
                "wine_id": wine_id,
                "location_id": target_location["id"],
                "quantity": quantity,
                "revision": 1,
                "updated_at": source_holding.get("updated_at"),
                "source_mapping": {
                    "cellar_id": cellar_id,
                    "location": source_holding.get("location"),
                    "target_location_code": target_location["code"],
                },
            }
        )

    current_source_holdings = [
        row
        for row in source_holdings
        if row.get("state") == CURRENT_STATE and int(row.get("quantity") or 0) > 0
    ]

    ambiguous_groups = []
    for group in identity_groups.values():
        if len(group) <= 1:
            continue
        ambiguous_groups.append(
            {
                "identity": {
                    "producer": group[0]["producer"],
                    "cuvee": group[0]["cuvee"],
                    "vintage": group[0]["vintage"],
                    "color": group[0]["color"],
                    "format_ml": group[0]["format_ml"],
                },
                "source_wines_preserved_separately": [
                    {
                        "id": wine["id"],
                        "appellation": wine["appellation"],
                        "area": wine["area"],
                    }
                    for wine in group
                ],
            }
        )

    report = {
        "source_counts": {
            "wines": len(source_wines),
            "cellars": len(source_cellars),
            "holdings_total": len(source_holdings),
            "current_positive_holdings": len(current_source_holdings),
            "current_bottles": sum(int(row["quantity"]) for row in current_source_holdings),
        },
        "target_counts": {
            "wines": len(target_wines),
            "cellars": len(target_cellars),
            "locations": len(target_locations),
            "holdings": len(target_holdings),
            "bottles": sum(int(row["quantity"]) for row in target_holdings),
        },
        "blank_locations_mapped_to_explicit_unspecified": {
            "holding_rows": sum(blank_location_targets.values()),
            "target_codes": dict(sorted(blank_location_targets.items())),
        },
        "ambiguous_semantic_wine_groups": ambiguous_groups,
        "skipped_holdings": skipped_holdings,
        "deferred_fields_preserved_in_source_export": {
            "wines": populated_deferred_fields(source_wines, V02_WINE_SOURCE_FIELDS),
            "cellars": populated_deferred_fields(source_cellars, V02_CELLAR_SOURCE_FIELDS),
            "holdings": populated_deferred_fields(source_holdings, V02_HOLDING_SOURCE_FIELDS),
        },
        "blockers": blockers,
    }

    reconciliation = {
        "wine_count_matches": len(target_wines) == len(source_wines),
        "cellar_count_matches": len(target_cellars) == len(source_cellars),
        "current_holding_count_matches": len(target_holdings) == len(current_source_holdings),
        "current_bottle_count_matches": (
            sum(int(row["quantity"]) for row in target_holdings)
            == sum(int(row["quantity"]) for row in current_source_holdings)
        ),
        "all_current_locations_mapped": not any(
            blocker["type"] == "UNMAPPED_HOLDING_LOCATION" for blocker in blockers
        ),
        "no_blockers": len(blockers) == 0,
    }

    return {
        "household_id": household_id,
        "target": {
            "wines": target_wines,
            "cellars": target_cellars,
            "locations": target_locations,
            "holdings": target_holdings,
            "inventory_operations": [],
        },
        "report": report,
        "reconciliation": reconciliation,
        "ready_to_apply": all(reconciliation.values()),
    }


def render_report(
    plan: dict[str, Any], source: Path, source_hash: str, source_manifest: dict[str, Any]
) -> str:
    report = plan["report"]
    source_counts = report["source_counts"]
    target_counts = report["target_counts"]

    lines = [
        "# CellarManager v0.1 → v0.2 import dry-run",
        "",
        f"Source: `{source}`  ",
        f"Source SHA-256: `{source_hash}`  ",
        f"Target household: `{plan['household_id'] or '<bind during apply>'}`  ",
        f"Ready to apply: **{'YES' if plan['ready_to_apply'] else 'NO'}**",
        "",
        "## Core reconciliation",
        "",
        f"- Wines: **{source_counts['wines']} → {target_counts['wines']}**",
        f"- Cellars: **{source_counts['cellars']} → {target_counts['cellars']}**",
        f"- Configured locations: **{target_counts['locations']}**",
        (
            "- Positive current holdings: "
            f"**{source_counts['current_positive_holdings']} → {target_counts['holdings']}**"
        ),
        f"- Current bottles: **{source_counts['current_bottles']} → {target_counts['bottles']}**",
        "- Fabricated inventory operations: **0**",
        "",
        "## Full source preservation/accounting",
        "",
        (
            "Every v0.1 table is exported unchanged as deterministic JSONL in "
            "`source-export/`. The manifest records row counts, schema, primary keys, "
            "and SHA-256 hashes. The later apply phase can archive these source rows "
            "before normalized import, so fields not yet modeled by v0.2 are not lost."
        ),
        "",
    ]

    for table, item in sorted(source_manifest.items()):
        lines.append(f"- `{table}`: {item['rows']} rows · `{item['export_sha256']}`")

    blank_mapping = report["blank_locations_mapped_to_explicit_unspecified"]
    lines += [
        "",
        "## Location mapping",
        "",
        (
            "- Blank source locations mapped through the source cellar's explicit "
            f"unspecified position: **{blank_mapping['holding_rows']} holdings**"
        ),
    ]
    for code, count in blank_mapping["target_codes"].items():
        lines.append(f"  - `{code}`: {count} holdings")

    lines += [
        "",
        "## Ambiguous wine identities",
        "",
        (
            "- Conservative producer/cuvée/vintage/color/format groups with more "
            f"than one source wine: **{len(report['ambiguous_semantic_wine_groups'])}**"
        ),
        "- They remain separate because source UUIDs are preserved; the dry-run never semantic-merges wines.",
        "",
        "## Holdings not represented as current stock",
        "",
    ]

    skipped = Counter(item["reason"] for item in report["skipped_holdings"])
    if skipped:
        for reason, count in sorted(skipped.items()):
            lines.append(f"- `{reason}`: {count} rows")
    else:
        lines.append("- None")

    lines += [
        "",
        "## Deferred normalized fields",
        "",
        (
            "These populated v0.1 fields do not yet have a normalized v0.2 destination. "
            "They remain fully present in the source export and must be archived or modeled "
            "before the production migration is considered information-preserving."
        ),
        "",
    ]
    for table, fields in report["deferred_fields_preserved_in_source_export"].items():
        lines.append(f"### {table}")
        lines.append("")
        if not fields:
            lines.append("- None")
        else:
            for field, count in sorted(fields.items()):
                lines.append(f"- `{field}`: {count} populated rows")
        lines.append("")

    lines += ["## Blockers", ""]
    if report["blockers"]:
        for blocker in report["blockers"]:
            lines.append(f"- `{blocker['type']}` — `{json.dumps(blocker, ensure_ascii=False)}`")
    else:
        lines.append("- None")

    lines += ["", "## Gates", ""]
    for gate, passed in plan["reconciliation"].items():
        lines.append(f"- `{gate}`: **{'PASS' if passed else 'FAIL'}**")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    source = args.source.expanduser().resolve()
    if not source.is_file():
        raise SystemExit(f"Source database not found: {source}")

    household_id = canonical_uuid(args.household_id) if args.household_id else None
    out = args.out.expanduser().resolve()
    if out.exists():
        if out.is_dir():
            shutil.rmtree(out)
        else:
            out.unlink()
    out.mkdir(parents=True)

    source_hash_before = sha256_file(source)

    with tempfile.TemporaryDirectory(prefix="cellarmanager-v01-dry-run-") as temp_dir:
        snapshot = Path(temp_dir) / "winecellar.snapshot.db"
        snapshot_database(source, snapshot)

        conn = sqlite3.connect(snapshot)
        conn.row_factory = sqlite3.Row
        try:
            integrity = [row[0] for row in conn.execute("pragma integrity_check")]
            if integrity != ["ok"]:
                raise SystemExit(f"SQLite integrity check failed: {integrity}")

            fk_violations = query_rows(conn, "pragma foreign_key_check")
            if fk_violations:
                raise SystemExit(
                    "SQLite foreign-key check failed: "
                    + json.dumps(fk_violations, ensure_ascii=False)
                )

            source_manifest = export_all_source_tables(conn, out / "source-export")
            plan = build_normalized_plan(conn, household_id)
        finally:
            conn.close()

    source_hash_after = sha256_file(source)
    if source_hash_after != source_hash_before:
        raise SystemExit("Source database changed during dry-run; refusing the generated plan")

    generated_at = datetime.now(UTC).isoformat()
    plan["version"] = 1
    plan["generated_at_utc"] = generated_at
    plan["source"] = {
        "path": str(source),
        "sha256": source_hash_before,
        "size_bytes": source.stat().st_size,
    }
    plan["source_export_manifest"] = source_manifest

    (out / "import-plan.json").write_text(
        json.dumps(plan, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (out / "source-manifest.json").write_text(
        json.dumps(source_manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    report = render_report(plan, source, source_hash_before, source_manifest)
    (out / "report.md").write_text(report + "\n", encoding="utf-8")

    print(report)
    print(f"\nPlan:     {out / 'import-plan.json'}")
    print(f"Manifest: {out / 'source-manifest.json'}")
    print(f"Report:   {out / 'report.md'}")
    return 0 if plan["ready_to_apply"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
