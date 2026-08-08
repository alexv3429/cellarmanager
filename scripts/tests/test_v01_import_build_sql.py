from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "v01_import_build_sql.py"
SPEC = importlib.util.spec_from_file_location("v01_import_build_sql", SCRIPT)
assert SPEC is not None
assert SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class V01ImportBuildSqlTests(unittest.TestCase):
    def plan(self):
        household = None
        return {
            "ready_to_apply": True,
            "report": {
                "target_counts": {
                    "wines": 1,
                    "cellars": 1,
                    "locations": 1,
                    "holdings": 1,
                    "bottles": 2,
                }
            },
            "target": {
                "wines": [
                    {
                        "id": "11111111-1111-4111-8111-111111111111",
                        "household_id": household,
                        "producer": "Domaine O'Brien",
                        "cuvee": "Cuvée",
                        "vintage": 2020,
                        "color": "red",
                        "appellation": "Morgon",
                        "area": "Beaujolais",
                        "format_ml": 750,
                        "created_at": "2026-01-01T00:00:00Z",
                    }
                ],
                "cellars": [
                    {
                        "id": "22222222-2222-4222-8222-222222222222",
                        "household_id": household,
                        "name": "Stock",
                        "created_at": "2026-01-01T00:00:00Z",
                    }
                ],
                "locations": [
                    {
                        "id": "33333333-3333-4333-8333-333333333333",
                        "household_id": household,
                        "cellar_id": "22222222-2222-4222-8222-222222222222",
                        "code": "STC",
                        "created_at": "2026-01-01T00:00:00Z",
                    }
                ],
                "holdings": [
                    {
                        "id": "44444444-4444-4444-8444-444444444444",
                        "household_id": household,
                        "wine_id": "11111111-1111-4111-8111-111111111111",
                        "location_id": "33333333-3333-4333-8333-333333333333",
                        "quantity": 2,
                        "revision": 1,
                        "updated_at": "2026-01-02T00:00:00Z",
                    }
                ],
            },
        }

    def test_sql_is_transactional_and_guarded(self):
        household = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        sql = MODULE.build_sql(self.plan(), household, "a" * 64)
        self.assertIn("begin;", sql)
        self.assertIn("commit;", sql)
        self.assertIn("Target household is not empty; import refused", sql)
        self.assertIn("Post-import reconciliation failed", sql)
        self.assertIn("inventory_operations", sql)
        self.assertIn("Domaine O''Brien", sql)
        self.assertIn("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sql)

    def test_household_binding_replaces_null_plan_value(self):
        household = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        bound = MODULE.bind_household(self.plan(), household)
        for table in ("wines", "cellars", "locations", "holdings"):
            self.assertTrue(bound[table])
            self.assertTrue(all(row["household_id"] == household for row in bound[table]))


if __name__ == "__main__":
    unittest.main()
