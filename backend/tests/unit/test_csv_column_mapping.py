import unittest
from datetime import date

from app.core.exceptions import ValidationError
from app.services import csv_io
from app.storage import repositories as repo
from tests.conftest_helpers import DatabaseTestCase

LEGACY_CSV = (
    "Place,Année Prod,Cuvée,Appellation,Vignoble,Couleur,Producteur, Prix,"
    "Année Min,Année Max,Nb,Fmt,Manuel Min,Manuel Max,Premium,Commentaire,"
    '"  38\u202f145,00   ","<= Prix Total\nNbre Bout =>",1215,Moy,"31,4",,\n'
    'A1,2018,Rouchaux,Moulin a Vent,Beaujolais,Rouge,Boillot,"  14,00   ",'
    "2026,2033,3,75cl,,,,"
    '"Bcp de matière, agréable en jeunesse, garde possible",'
    '"  42,00   ",,,,,,2026\n'
).encode("utf-8")


class TestCsvAnalysis(unittest.TestCase):
    def test_legacy_headers_are_suggested_without_renaming_file(self):
        analysis = csv_io.analyze_csv(LEGACY_CSV)
        labels = {header["id"]: header["label"] for header in analysis["headers"]}
        mapping = analysis["suggested_mapping"]

        self.assertEqual(labels[mapping["location"]["columns"][0]], "Place")
        self.assertEqual(labels[mapping["vintage"]["columns"][0]], "Année Prod")
        self.assertEqual(labels[mapping["area"]["columns"][0]], "Vignoble")
        self.assertEqual(labels[mapping["quantity"]["columns"][0]], "Nb")
        self.assertEqual(labels[mapping["format"]["columns"][0]], "Fmt")

        drink_after_labels = [labels[column] for column in mapping["drink_after"]["columns"]]
        self.assertEqual(drink_after_labels, ["Manuel Min", "Année Min"])

    def test_duplicate_and_blank_headers_receive_stable_ids(self):
        raw = b"Producer,Producer,,Cuvee,Appellation,Vintage,Color,Area,Format\nA,B,x,C,D,2020,red,E,75cl\n"
        analysis = csv_io.analyze_csv(raw)
        self.assertEqual(
            len({header["id"] for header in analysis["headers"]}), len(analysis["headers"])
        )
        labels = [header["label"] for header in analysis["headers"]]
        self.assertIn("Producer (2)", labels)
        self.assertIn("Column 3", labels)

    def test_mapping_rejects_one_source_used_for_two_targets(self):
        document = csv_io.decode_csv_document(
            b"Producer,Cuvee,Appellation,Vintage,Color,Area,Format\nA,B,C,2020,red,D,75cl\n"
        )
        automatic = csv_io.suggest_mapping(document.columns)
        automatic["area"] = automatic["producer"]
        with self.assertRaises(ValidationError):
            csv_io.normalize_column_mapping(automatic, document)


class TestMappedImport(DatabaseTestCase):
    def test_imports_legacy_csv_using_suggested_mapping(self):
        analysis = csv_io.analyze_csv(LEGACY_CSV)
        report = csv_io.import_csv(
            LEGACY_CSV,
            conn=self.conn,
            user_id="u1",
            mapping=analysis["suggested_mapping"],
        )
        self.assertEqual(report.imported, 1)
        wine = repo.list_wines(self.conn)[0]
        holding = repo.list_holdings(self.conn, wine_id=wine.id)[0]
        self.assertEqual(wine.producer, "Boillot")
        self.assertEqual(wine.cuvee, "Rouchaux")
        self.assertEqual(wine.vintage, 2018)
        self.assertEqual(wine.area, "Beaujolais")
        self.assertEqual(wine.drink_after, date(2026, 1, 1))
        self.assertEqual(wine.drink_before, date(2033, 12, 31))
        self.assertIn("Bcp de matière", wine.advice_experience)
        self.assertEqual(holding.quantity, 3)
        self.assertEqual(holding.price_bought, 14.0)
        self.assertEqual(holding.location, "A1")

    def test_manual_window_column_wins_over_calculated_fallback(self):
        raw = (
            "Producer,Cuvee,Appellation,Vintage,Color,Area,Format,Manual Min,Year Min,Manual Max,Year Max\n"
            "Domaine,Cuvée,AOC,2020,red,Area,75cl,2028,2025,2030,2035\n"
        ).encode()
        analysis = csv_io.analyze_csv(raw)
        csv_io.import_csv(raw, conn=self.conn, user_id="u1", mapping=analysis["suggested_mapping"])
        wine = repo.list_wines(self.conn)[0]
        self.assertEqual(wine.drink_after, date(2028, 1, 1))
        self.assertEqual(wine.drink_before, date(2030, 12, 31))

    def test_invalid_quantity_preview_does_not_write_database(self):
        raw = (
            "Producer,Cuvee,Appellation,Vintage,Color,Area,Format,Quantity\n"
            "Domaine,Cuvée,AOC,2020,red,Area,75cl,-2\n"
        ).encode()
        analysis = csv_io.analyze_csv(raw)
        preview = csv_io.preview_csv(
            raw,
            mapping=analysis["suggested_mapping"],
            conn=self.conn,
        )
        self.assertEqual(preview["error_rows"], 1)
        self.assertEqual(repo.list_wines(self.conn), [])

    def test_invalid_quantity_import_does_not_create_orphan_wine(self):
        raw = (
            "Producer,Cuvee,Appellation,Vintage,Color,Area,Format,Quantity\n"
            "Domaine,Cuvée,AOC,2020,red,Area,75cl,1.5\n"
        ).encode()
        analysis = csv_io.analyze_csv(raw)
        report = csv_io.import_csv(
            raw,
            conn=self.conn,
            user_id="u1",
            mapping=analysis["suggested_mapping"],
        )
        self.assertEqual(report.skipped, 1)
        self.assertEqual(repo.list_wines(self.conn), [])


if __name__ == "__main__":
    unittest.main()
