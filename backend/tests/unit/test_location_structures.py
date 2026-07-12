import json
import unittest

from app.core.domain import Cellar
from app.services import cellar_rules


class LocationStructureTests(unittest.TestCase):
    def cellar(self, scheme):
        rule, layout = cellar_rules.normalize_location_configuration(
            None,
            json.dumps({"location_scheme": scheme}),
        )
        return Cellar(id=scheme.get("prefix", "x") or "x", name="Test", location_rule=rule, layout=layout)

    def test_loose_storage_accepts_unspecified_and_box_suffix(self):
        scheme = {
            "kind": "loose",
            "prefix": "STC",
            "separator": " ",
            "containers": ["Box 1", "Box 2"],
            "allow_free_text": True,
            "store_internal": True,
        }
        cellar = self.cellar(scheme)
        self.assertIsNone(cellar_rules.normalize_location_for_cellar(cellar, "STC"))
        self.assertEqual(cellar_rules.normalize_location_for_cellar(cellar, "STC Box 2"), "Box 2")
        self.assertEqual(cellar_rules.normalize_location_for_cellar(cellar, "STC Carton rouge"), "Carton rouge")
        self.assertIs(cellar_rules.match_cellar_for_location("STC Box 1", [cellar]), cellar)

    def test_simple_grid_remains_backwards_compatible(self):
        scheme = {
            "kind": "grid",
            "prefix": "M",
            "column_start": "A",
            "column_end": "D",
            "row_start": 1,
            "row_end": 3,
            "order": "prefix_column_row",
            "separator": "",
            "store_internal": True,
        }
        cellar = self.cellar(scheme)
        self.assertEqual(cellar_rules.normalize_location_for_cellar(cellar, "MA1"), "A1")
        self.assertEqual(cellar_rules.normalize_location_for_cellar(cellar, "MD3"), "D3")
        self.assertEqual(len(cellar_rules.generate_locations(scheme)), 12)

    def test_grid_sub_positions_generate_a1_dot_1(self):
        scheme = {
            "kind": "grid_sub",
            "column_start": "A",
            "column_end": "B",
            "row_start": 1,
            "row_end": 2,
            "order": "column_row",
            "sub_start": 1,
            "sub_end": 2,
            "sub_separator": ".",
            "separator": "",
            "store_internal": True,
        }
        locations = cellar_rules.generate_locations(scheme)
        self.assertEqual([item["import"] for item in locations[:4]], ["A1.1", "A1.2", "B1.1", "B1.2"])
        cellar = self.cellar(scheme)
        self.assertEqual(cellar_rules.normalize_location_for_cellar(cellar, "B2.2"), "B2.2")

    def test_sequential_grid_supports_a_to_z_with_partial_last_row(self):
        scheme = {
            "kind": "sequential",
            "rows": 7,
            "columns": 4,
            "position_count": 26,
            "start_label": "A",
            "fill_order": "row_major",
            "horizontal_direction": "ltr",
            "vertical_direction": "ttb",
            "prefix": "",
            "separator": "",
        }
        locations = cellar_rules.generate_locations(scheme)
        self.assertEqual(len(locations), 26)
        self.assertEqual(locations[0]["import"], "A")
        self.assertEqual(locations[-1]["import"], "Z")
        self.assertEqual((locations[-1]["row"], locations[-1]["column"]), (6, 1))

    def test_rows_with_depth_generate_g1f_and_g1b(self):
        scheme = {
            "kind": "depth",
            "prefix": "G",
            "row_start": 1,
            "row_end": 9,
            "depths": [
                {"code": "F", "label": "Front"},
                {"code": "B", "label": "Back"},
            ],
            "order": "prefix_row_depth",
            "separator": "",
            "store_internal": True,
        }
        locations = cellar_rules.generate_locations(scheme)
        self.assertEqual([item["import"] for item in locations[:2]], ["G1F", "G1B"])
        cellar = self.cellar(scheme)
        self.assertEqual(cellar_rules.normalize_location_for_cellar(cellar, "G1B"), "1B")
        self.assertEqual(cellar_rules.normalize_location_for_cellar(cellar, "9F"), "9F")

    def test_normalization_persists_explicit_catalog(self):
        scheme = {
            "kind": "grid",
            "column_start": "A",
            "column_end": "B",
            "row_start": 1,
            "row_end": 2,
            "order": "column_row",
        }
        _, layout = cellar_rules.normalize_location_configuration(None, json.dumps({"location_scheme": scheme}))
        stored = json.loads(layout)
        self.assertEqual(stored["location_catalog"]["version"], 1)
        self.assertEqual(len(stored["location_catalog"]["positions"]), 4)


if __name__ == "__main__":
    unittest.main()
