"""Small accounting checks for the read-only producer-bundle comparator."""

import csv
import json
import tempfile
import unittest
from pathlib import Path

from reconcile_producer_profile_bundles import compare


def profile(rows):
    return {
        "format": "cellarmanager.producer_research",
        "producer": {"id": "producer", "name": "Domaine Example"},
        "cuvees": [{"id": "cuvee", "name": "Cuvée Example"}],
        "exact_release_calibrations": [
            {"cuvee_id": "cuvee", "vintage": year, "format_ml": 750,
             "proposal": {"first_trial_year": dates[0],
                          "best_start_year": dates[1],
                          "best_end_year": dates[2]}}
            for year, dates in rows
        ],
    }


class BundleComparisonTest(unittest.TestCase):
    def test_reconciles_unchanged_changed_and_audited_absent_rows(self):
        with tempfile.TemporaryDirectory() as root:
            old_dir = Path(root) / "old"
            new_dir = Path(root) / "new"
            old_dir.mkdir()
            new_dir.mkdir()
            old = profile([(2021, [2023, 2025, 2028]),
                           (2022, [2024, 2026, 2030]),
                           (2023, [2025, 2027, 2031])])
            new = profile([(2021, [2023, 2025, 2028]),
                           (2022, [2024, 2027, 2030]),
                           (2024, [2026, 2028, 2032])])
            (old_dir / "old.json").write_text(json.dumps(old), encoding="utf-8")
            (new_dir / "new.json").write_text(json.dumps(new), encoding="utf-8")
            audit_path = Path(root) / "audit.csv"
            with audit_path.open("w", encoding="utf-8-sig", newline="") as out:
                writer = csv.DictWriter(out, delimiter=";", fieldnames=[
                    "producteur", "cuvee", "millesime", "format_ml",
                    "decision", "source_existence", "dates_precedentes"])
                writer.writeheader()
                writer.writerow({"producteur": "Domaine Example",
                                 "cuvee": "Cuvée Example", "millesime": 2023,
                                 "format_ml": 750,
                                 "decision": "no_named_vintage_source_url",
                                 "source_existence": "https://example.org",
                                 "dates_precedentes": "2025 / 2027 / 2031"})
            result = compare(old_dir, new_dir, audit_path)
            self.assertEqual(result["totals"], {
                "old": 3, "new": 3, "unchanged": 1, "changed": 1,
                "absent": 1, "new_within_existing_producer": 1})
            self.assertEqual(result["absent_audit_decisions"],
                             {"no_named_vintage_source_url": 1})
            self.assertEqual(result["absent_without_audit"], [])
            self.assertEqual(result["changed_rows"][0]["vintage"], 2022)


if __name__ == "__main__":
    unittest.main()
