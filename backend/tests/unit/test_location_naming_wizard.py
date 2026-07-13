import json
import unittest

from app.core.domain import Cellar, Holding, Wine
from app.services import assignment_service, cellar_rules, csv_io
from app.storage import repositories as repo
from app.storage.database import Database

SCHEME = {
    "kind": "grid",
    "enabled": True,
    "prefix": "M",
    "column_start": "A",
    "column_end": "D",
    "row_start": 1,
    "row_end": 3,
    "order": "prefix_column_row",
    "separator": "",
    "store_internal": True,
}


def layout_for(scheme=SCHEME):
    return json.dumps({"location_scheme": scheme})


class GridLocationSchemeTests(unittest.TestCase):
    def test_example_grid_generates_expected_codes_and_rule(self):
        generated = cellar_rules.grid_locations(SCHEME)
        self.assertEqual(
            [item["import"] for item in generated[:4]],
            ["MA1", "MB1", "MC1", "MD1"],
        )
        self.assertEqual(
            [item["import"] for item in generated[-4:]],
            ["MA3", "MB3", "MC3", "MD3"],
        )
        rule = cellar_rules.build_grid_rule(SCHEME)
        self.assertTrue(cellar_rules.rule_matches(rule, "MA1"))
        self.assertTrue(cellar_rules.rule_matches(rule, "md3"))
        self.assertFalse(cellar_rules.rule_matches(rule, "ME1"))
        self.assertFalse(cellar_rules.rule_matches(rule, "MA4"))

    def test_full_code_is_normalized_to_internal_position(self):
        cellar = Cellar(
            id="main",
            name="Main",
            location_rule=cellar_rules.build_grid_rule(SCHEME),
            layout=layout_for(),
        )
        self.assertEqual(cellar_rules.normalize_location_for_cellar(cellar, "MA1"), "A1")
        self.assertEqual(cellar_rules.normalize_location_for_cellar(cellar, "a1"), "A1")

    def test_backend_rebuilds_generated_rule_from_structured_layout(self):
        rule, normalized_layout = cellar_rules.normalize_location_configuration(
            "this value must be replaced",
            layout_for(),
        )
        self.assertEqual(rule, cellar_rules.build_grid_rule(SCHEME))
        stored = json.loads(normalized_layout)
        self.assertEqual(stored["location_scheme"]["prefix"], "M")

    def test_legacy_prefix_keeps_original_location(self):
        cellar = Cellar(id="legacy", name="Legacy", location_rule="AG")
        self.assertEqual(cellar_rules.normalize_location_for_cellar(cellar, "AG12"), "AG12")


class LocationSchemeIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.db = Database(":memory:")
        with self.db.session() as conn:
            repo.insert_wine(conn, Wine(id="wine", producer="Producer"))
            self.cellar = Cellar(
                id="main",
                name="Main cellar",
                purpose_level=5,
                location_rule=cellar_rules.build_grid_rule(SCHEME),
                layout=layout_for(),
            )
            repo.insert_cellar(conn, self.cellar)

    def tearDown(self):
        self.db.close_all()

    def test_reconciliation_moves_ma1_to_cellar_position_a1(self):
        with self.db.session() as conn:
            repo.insert_holding(
                conn,
                Holding(
                    id="unassigned",
                    wine_id="wine",
                    cellar_id=None,
                    location="MA1",
                    quantity=2,
                ),
            )
            result = assignment_service.reconcile_unassigned(conn, user_id="user")
            self.assertEqual(result.assigned_bottles, 2)
            destination = repo.find_active_holding(conn, "wine", "main", "A1")
            self.assertIsNotNone(destination)
            self.assertEqual(destination.quantity, 2)

    def test_csv_import_matches_full_code_and_stores_internal_position(self):
        content = (
            "Producer,Cuvee,Appellation,Vintage,Color,Area,Format,Quantity,Location\n"
            "Domaine,Cuvée,AOC,2020,red,Area,75cl,3,MB2\n"
        ).encode()
        with self.db.session() as conn:
            mapping = csv_io.analyze_csv(content)["suggested_mapping"]
            report = csv_io.import_csv(
                content,
                mapping=mapping,
                conn=conn,
                user_id="user",
            )
            self.assertEqual(report.unassigned_bottles, 0)
            holdings = [
                holding
                for holding in repo.list_holdings(conn, cellar_id="main")
                if holding.location == "B2"
            ]
            self.assertEqual(sum(holding.quantity for holding in holdings), 3)


if __name__ == "__main__":
    unittest.main()
