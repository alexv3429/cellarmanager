from __future__ import annotations

import importlib.util
import json
import sqlite3
import tempfile
import unittest
import uuid
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "v01_import_dry_run.py"
SPEC = importlib.util.spec_from_file_location("v01_import_dry_run", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class DryRunTests(unittest.TestCase):
    def build_source(self, path: Path) -> None:
        conn = sqlite3.connect(path)
        try:
            conn.executescript(
                """
                pragma foreign_keys = on;
                create table wines (
                    id text primary key,
                    producer text not null,
                    cuvee text,
                    appellation text,
                    vintage integer,
                    color text not null,
                    area text,
                    format text not null,
                    format_ml integer,
                    notes text,
                    created_at text not null,
                    updated_at text not null,
                    version integer not null
                );
                create table cellars (
                    id text primary key,
                    name text not null,
                    purpose_level integer,
                    layout text,
                    created_at text not null,
                    updated_at text not null,
                    version integer not null
                );
                create table holdings (
                    id text primary key,
                    wine_id text not null references wines(id),
                    cellar_id text references cellars(id),
                    location text,
                    quantity integer not null,
                    state text not null,
                    price_bought real,
                    created_at text not null,
                    updated_at text not null,
                    version integer not null
                );
                create table movements (
                    id text primary key,
                    note text
                );
                """
            )
            wine_id = uuid.UUID("11111111-1111-4111-8111-111111111111").hex
            cellar_id = uuid.UUID("22222222-2222-4222-8222-222222222222").hex
            holding_id = uuid.UUID("33333333-3333-4333-8333-333333333333").hex
            layout = json.dumps(
                {
                    "location_catalog": {
                        "version": 1,
                        "positions": [
                            {
                                "internal": "",
                                "import": "STC",
                                "label": "Unspecified",
                                "unspecified": True,
                            }
                        ],
                    }
                }
            )
            conn.execute(
                """
                insert into wines values (
                    ?, ' Domaine   Test ', ' Cuvée ', 'Morgon', 2020,
                    'RED', 'Beaujolais', '75cl', 750, 'Keep me',
                    '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', 1
                )
                """,
                (wine_id,),
            )
            conn.execute(
                """
                insert into cellars values (
                    ?, 'Stock', 4, ?,
                    '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', 1
                )
                """,
                (cellar_id, layout),
            )
            conn.execute(
                """
                insert into holdings values (
                    ?, ?, ?, null, 2, 'in_cellar', 12.5,
                    '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', 1
                )
                """,
                (holding_id, wine_id, cellar_id),
            )
            conn.execute("insert into movements values ('move-1', 'Keep movement')")
            conn.commit()
        finally:
            conn.close()

    def test_plan_is_loss_accounted_and_maps_unspecified(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "source.db"
            export = Path(temp) / "export"
            self.build_source(source)
            conn = sqlite3.connect(source)
            conn.row_factory = sqlite3.Row
            try:
                manifest = MODULE.export_all_source_tables(conn, export)
                plan = MODULE.build_normalized_plan(conn, None)
            finally:
                conn.close()

            self.assertTrue(plan["ready_to_apply"])
            self.assertEqual(plan["report"]["target_counts"]["bottles"], 2)
            self.assertEqual(
                plan["target"]["holdings"][0]["source_mapping"]["target_location_code"],
                "STC",
            )
            wine = plan["target"]["wines"][0]
            self.assertEqual(wine["producer"], "Domaine Test")
            self.assertEqual(wine["cuvee"], "Cuvée")
            self.assertEqual(wine["vintage"], 2020)
            self.assertEqual(wine["color"], "red")
            self.assertEqual(wine["appellation"], "Morgon")
            self.assertEqual(wine["area"], "Beaujolais")
            self.assertEqual(wine["format_ml"], 750)

            deferred_wine_fields = plan["report"]["deferred_fields_preserved_in_source_export"][
                "wines"
            ]
            for modeled_field in ("color", "appellation", "area", "format_ml"):
                self.assertNotIn(modeled_field, deferred_wine_fields)

            self.assertEqual(manifest["movements"]["rows"], 1)
            self.assertEqual(
                plan["report"]["deferred_fields_preserved_in_source_export"]["wines"]["notes"],
                1,
            )

    def test_location_uuid_is_deterministic(self) -> None:
        cellar_id = "22222222-2222-4222-8222-222222222222"
        self.assertEqual(
            MODULE.deterministic_location_uuid(cellar_id, " A1 "),
            MODULE.deterministic_location_uuid(cellar_id, "a1"),
        )


if __name__ == "__main__":
    unittest.main()
