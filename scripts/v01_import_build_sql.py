#!/usr/bin/env python3
"""Build a guarded SQL transaction for a v0.1 -> v0.2 import plan.

This command does not connect to PostgreSQL. It verifies the authoritative
SQLite source hash, the dry-run plan, and every exported JSONL file, then emits
one SQL transaction that can be reviewed before execution against the chosen
v0.2 household.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import tarfile
import uuid
from collections.abc import Iterable
from pathlib import Path
from typing import Any

EXPECTED_TABLES = ("wines", "cellars", "locations", "holdings")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build guarded v0.1 import SQL")
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--dry-run-dir", type=Path, required=True)
    parser.add_argument("--household-id", required=True)
    parser.add_argument("--expected-source-sha256", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument(
        "--archive-out",
        type=Path,
        help="Optional local tar.gz archive of the complete dry-run evidence",
    )
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_uuid(value: Any) -> str:
    return str(uuid.UUID(str(value)))


def sql_literal(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if not value.is_integer():
            raise ValueError(f"Unexpected non-integer numeric SQL value: {value}")
        return str(int(value))
    text = str(value).replace("'", "''")
    return f"'{text}'"


def uuid_literal(value: str) -> str:
    return f"'{canonical_uuid(value)}'::uuid"


def batched(items: list[dict[str, Any]], size: int = 200) -> Iterable[list[dict[str, Any]]]:
    for index in range(0, len(items), size):
        yield items[index : index + size]


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def verify_export_manifest(dry_run_dir: Path, manifest: dict[str, Any]) -> None:
    export_dir = dry_run_dir / "source-export"
    for table, item in sorted(manifest.items()):
        export_path = export_dir / item["export_file"]
        if not export_path.is_file():
            raise SystemExit(f"Missing source export: {export_path}")
        actual_hash = sha256_file(export_path)
        if actual_hash != item["export_sha256"]:
            raise SystemExit(
                f"Source export hash mismatch for {table}: "
                f"expected {item['export_sha256']}, got {actual_hash}"
            )
        with export_path.open("r", encoding="utf-8") as handle:
            row_count = sum(1 for _ in handle)
        if row_count != int(item["rows"]):
            raise SystemExit(
                f"Source export row-count mismatch for {table}: "
                f"expected {item['rows']}, got {row_count}"
            )


def bind_household(plan: dict[str, Any], household_id: str) -> dict[str, list[dict[str, Any]]]:
    target = plan.get("target")
    if not isinstance(target, dict):
        raise SystemExit("Dry-run plan has no target section")

    bound: dict[str, list[dict[str, Any]]] = {}
    for table in EXPECTED_TABLES:
        source_rows = target.get(table)
        if not isinstance(source_rows, list):
            raise SystemExit(f"Dry-run plan missing target.{table}")
        table_rows: list[dict[str, Any]] = []
        for source_row in source_rows:
            row = dict(source_row)
            row["household_id"] = household_id
            table_rows.append(row)
        bound[table] = table_rows
    return bound


def insert_batches(
    table: str,
    columns: list[str],
    rows: list[dict[str, Any]],
    casts: dict[str, str] | None = None,
) -> str:
    casts = casts or {}
    statements: list[str] = []
    for batch in batched(rows):
        values_sql: list[str] = []
        for row in batch:
            rendered: list[str] = []
            for column in columns:
                literal = sql_literal(row.get(column))
                cast = casts.get(column)
                rendered.append(f"{literal}{cast or ''}")
            values_sql.append("(" + ", ".join(rendered) + ")")
        statements.append(
            f"insert into {table} ({', '.join(columns)}) values\n  "
            + ",\n  ".join(values_sql)
            + ";"
        )
    return "\n\n".join(statements)


def build_sql(
    plan: dict[str, Any],
    household_id: str,
    expected_source_sha256: str,
) -> str:
    bound = bind_household(plan, household_id)
    report = plan["report"]
    counts = report["target_counts"]

    expected_wines = int(counts["wines"])
    expected_cellars = int(counts["cellars"])
    expected_locations = int(counts["locations"])
    expected_holdings = int(counts["holdings"])
    expected_bottles = int(counts["bottles"])

    if len(bound["wines"]) != expected_wines:
        raise SystemExit("Plan wine count does not match dry-run report")
    if len(bound["cellars"]) != expected_cellars:
        raise SystemExit("Plan cellar count does not match dry-run report")
    if len(bound["locations"]) != expected_locations:
        raise SystemExit("Plan location count does not match dry-run report")
    if len(bound["holdings"]) != expected_holdings:
        raise SystemExit("Plan holding count does not match dry-run report")
    if sum(int(row["quantity"]) for row in bound["holdings"]) != expected_bottles:
        raise SystemExit("Plan bottle count does not match dry-run report")

    wine_sql = insert_batches(
        "_v01_wines",
        [
            "id",
            "household_id",
            "producer",
            "cuvee",
            "vintage",
            "color",
            "appellation",
            "area",
            "format_ml",
            "created_at",
        ],
        bound["wines"],
        casts={"id": "::uuid", "household_id": "::uuid", "created_at": "::timestamptz"},
    )
    cellar_sql = insert_batches(
        "_v01_cellars",
        ["id", "household_id", "name", "created_at"],
        bound["cellars"],
        casts={"id": "::uuid", "household_id": "::uuid", "created_at": "::timestamptz"},
    )
    location_rows = [
        {
            "id": row["id"],
            "household_id": row["household_id"],
            "cellar_id": row["cellar_id"],
            "code": row["code"],
            "created_at": row.get("created_at"),
        }
        for row in bound["locations"]
    ]
    location_sql = insert_batches(
        "_v01_locations",
        ["id", "household_id", "cellar_id", "code", "created_at"],
        location_rows,
        casts={
            "id": "::uuid",
            "household_id": "::uuid",
            "cellar_id": "::uuid",
            "created_at": "::timestamptz",
        },
    )
    holding_rows = [
        {
            "id": row["id"],
            "household_id": row["household_id"],
            "wine_id": row["wine_id"],
            "location_id": row["location_id"],
            "quantity": row["quantity"],
            "revision": row["revision"],
            "updated_at": row.get("updated_at"),
        }
        for row in bound["holdings"]
    ]
    holding_sql = insert_batches(
        "_v01_holdings",
        [
            "id",
            "household_id",
            "wine_id",
            "location_id",
            "quantity",
            "revision",
            "updated_at",
        ],
        holding_rows,
        casts={
            "id": "::uuid",
            "household_id": "::uuid",
            "wine_id": "::uuid",
            "location_id": "::uuid",
            "updated_at": "::timestamptz",
        },
    )

    hhid = uuid_literal(household_id)

    return f"""-- CellarManager v0.1 -> v0.2 guarded import
-- Source SHA-256: {expected_source_sha256}
-- Target household: {household_id}
-- Expected normalized result: {expected_wines} wines, {expected_cellars} cellars,
--   {expected_locations} locations, {expected_holdings} holdings, {expected_bottles} bottles,
--   0 fabricated inventory operations.
--
-- Generated from a verified dry-run plan. Review this file before execution.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

-- Serialize imports against this household and keep the household row stable.
select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cellarmanager-v01-import|{household_id}', 0)
);

select id
from public.households
where id = {hhid}
for update;

create temporary table _v01_wines (
    id uuid primary key,
    household_id uuid not null,
    producer text not null,
    cuvee text not null,
    vintage integer,
    color text not null,
    appellation text,
    area text,
    format_ml integer not null,
    created_at timestamptz not null
) on commit drop;

create temporary table _v01_cellars (
    id uuid primary key,
    household_id uuid not null,
    name text not null,
    created_at timestamptz not null
) on commit drop;

create temporary table _v01_locations (
    id uuid primary key,
    household_id uuid not null,
    cellar_id uuid not null,
    code text not null,
    created_at timestamptz not null,
    unique (cellar_id, code)
) on commit drop;

create temporary table _v01_holdings (
    id uuid primary key,
    household_id uuid not null,
    wine_id uuid not null,
    location_id uuid not null,
    quantity integer not null check (quantity > 0),
    revision integer not null,
    updated_at timestamptz not null,
    unique (wine_id, location_id)
) on commit drop;

{wine_sql}

{cellar_sql}

{location_sql}

{holding_sql}

do $guard$
declare
    v_household_id constant uuid := {hhid};
begin
    if not exists (
        select 1 from public.households where id = v_household_id
    ) then
        raise exception using
            errcode = '22023',
            message = 'Target household does not exist';
    end if;

    if not exists (
        select 1
        from public.household_members hm
        where hm.household_id = v_household_id
          and hm.role = 'owner'
    ) then
        raise exception using
            errcode = '22023',
            message = 'Target household has no owner membership';
    end if;

    if exists (select 1 from public.wines where household_id = v_household_id)
       or exists (select 1 from public.cellars where household_id = v_household_id)
       or exists (select 1 from public.locations where household_id = v_household_id)
       or exists (select 1 from public.holdings where household_id = v_household_id)
       or exists (select 1 from public.inventory_operations where household_id = v_household_id)
    then
        raise exception using
            errcode = '22023',
            message = 'Target household is not empty; import refused';
    end if;

    if (select count(*) from _v01_wines) <> {expected_wines}
       or (select count(*) from _v01_cellars) <> {expected_cellars}
       or (select count(*) from _v01_locations) <> {expected_locations}
       or (select count(*) from _v01_holdings) <> {expected_holdings}
       or (select coalesce(sum(quantity), 0) from _v01_holdings) <> {expected_bottles}
    then
        raise exception using
            errcode = '22023',
            message = 'Staged import reconciliation failed';
    end if;

    if exists (select 1 from _v01_wines where household_id <> v_household_id)
       or exists (select 1 from _v01_cellars where household_id <> v_household_id)
       or exists (select 1 from _v01_locations where household_id <> v_household_id)
       or exists (select 1 from _v01_holdings where household_id <> v_household_id)
    then
        raise exception using
            errcode = '22023',
            message = 'Staged import contains a different household id';
    end if;

    if exists (
        select 1
        from _v01_locations l
        left join _v01_cellars c on c.id = l.cellar_id
        where c.id is null or c.household_id <> l.household_id
    ) then
        raise exception using
            errcode = '22023',
            message = 'Staged location references an invalid cellar';
    end if;

    if exists (
        select 1
        from _v01_holdings h
        left join _v01_wines w on w.id = h.wine_id
        left join _v01_locations l on l.id = h.location_id
        where w.id is null
           or l.id is null
           or w.household_id <> h.household_id
           or l.household_id <> h.household_id
    ) then
        raise exception using
            errcode = '22023',
            message = 'Staged holding references an invalid wine or location';
    end if;

    if exists (select 1 from public.wines p join _v01_wines s on s.id = p.id)
       or exists (select 1 from public.cellars p join _v01_cellars s on s.id = p.id)
       or exists (select 1 from public.locations p join _v01_locations s on s.id = p.id)
       or exists (select 1 from public.holdings p join _v01_holdings s on s.id = p.id)
    then
        raise exception using
            errcode = '23505',
            message = 'One or more source UUIDs already exist in v0.2; import refused';
    end if;
end
$guard$;

insert into public.wines (
    id,
    household_id,
    producer,
    cuvee,
    vintage,
    color,
    appellation,
    area,
    format_ml,
    created_at
)
select
    id,
    household_id,
    producer,
    cuvee,
    vintage,
    color,
    appellation,
    area,
    format_ml,
    created_at
from _v01_wines;

insert into public.cellars (
    id,
    household_id,
    name,
    created_at
)
select id, household_id, name, created_at
from _v01_cellars;

insert into public.locations (
    id,
    household_id,
    cellar_id,
    code,
    created_at
)
select id, household_id, cellar_id, code, created_at
from _v01_locations;

insert into public.holdings (
    id,
    household_id,
    wine_id,
    location_id,
    quantity,
    revision,
    updated_at
)
select
    id,
    household_id,
    wine_id,
    location_id,
    quantity,
    revision,
    updated_at
from _v01_holdings;

do $reconcile$
declare
    v_household_id constant uuid := {hhid};
begin
    if (select count(*) from public.wines where household_id = v_household_id) <> {expected_wines}
       or (select count(*) from public.cellars where household_id = v_household_id) <> {expected_cellars}
       or (select count(*) from public.locations where household_id = v_household_id) <> {expected_locations}
       or (select count(*) from public.holdings where household_id = v_household_id) <> {expected_holdings}
       or (select coalesce(sum(quantity), 0) from public.holdings where household_id = v_household_id) <> {expected_bottles}
       or (select count(*) from public.inventory_operations where household_id = v_household_id) <> 0
    then
        raise exception using
            errcode = '22023',
            message = 'Post-import reconciliation failed; transaction will roll back';
    end if;
end
$reconcile$;

commit;
"""


def create_archive(dry_run_dir: Path, archive_out: Path) -> None:
    members = [
        dry_run_dir / "import-plan.json",
        dry_run_dir / "source-manifest.json",
        dry_run_dir / "report.md",
        dry_run_dir / "source-export",
    ]
    for member in members:
        if not member.exists():
            raise SystemExit(f"Missing dry-run evidence for archive: {member}")

    archive_out.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive_out, "w:gz") as archive:
        for member in members:
            archive.add(member, arcname=member.name)
    os.chmod(archive_out, 0o600)


def main() -> int:
    args = parse_args()
    source = args.source.expanduser().resolve()
    dry_run_dir = args.dry_run_dir.expanduser().resolve()
    out = args.out.expanduser().resolve()
    household_id = canonical_uuid(args.household_id)
    expected_hash = args.expected_source_sha256.lower()

    if not source.is_file():
        raise SystemExit(f"Source database not found: {source}")
    if len(expected_hash) != 64 or any(ch not in "0123456789abcdef" for ch in expected_hash):
        raise SystemExit("--expected-source-sha256 must be a 64-character lowercase hex digest")

    actual_source_hash = sha256_file(source)
    if actual_source_hash != expected_hash:
        raise SystemExit(
            "Authoritative source hash changed; import SQL not generated. "
            f"Expected {expected_hash}, got {actual_source_hash}"
        )

    plan_path = dry_run_dir / "import-plan.json"
    manifest_path = dry_run_dir / "source-manifest.json"
    if not plan_path.is_file() or not manifest_path.is_file():
        raise SystemExit("Dry-run directory is missing import-plan.json or source-manifest.json")

    plan = load_json(plan_path)
    manifest = load_json(manifest_path)

    if not plan.get("ready_to_apply"):
        raise SystemExit("Dry-run plan is not ready_to_apply")
    if plan.get("source", {}).get("sha256") != expected_hash:
        raise SystemExit("Dry-run plan source hash does not match expected source hash")
    if plan.get("source_export_manifest") != manifest:
        raise SystemExit("Dry-run plan manifest and source-manifest.json differ")

    verify_export_manifest(dry_run_dir, manifest)

    sql = build_sql(plan, household_id, expected_hash)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(sql, encoding="utf-8")
    os.chmod(out, 0o600)

    print(f"Verified source SHA-256: {expected_hash}")
    print(f"Verified source exports: {len(manifest)} tables")
    print(f"Target household: {household_id}")
    print(f"SQL: {out}")
    print(f"SQL SHA-256: {sha256_file(out)}")

    if args.archive_out:
        archive_out = args.archive_out.expanduser().resolve()
        create_archive(dry_run_dir, archive_out)
        print(f"Archive: {archive_out}")
        print(f"Archive SHA-256: {sha256_file(archive_out)}")
        print("Archive contains legacy authentication hashes; keep it private and never commit it.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
