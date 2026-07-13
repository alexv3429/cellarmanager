import unittest
from datetime import date

from app.core.exceptions import ValidationError
from app.services import csv_io
from app.storage import repositories as repo
from tests.conftest_helpers import DatabaseTestCase

SAMPLE_CSV_EN = (
    b"Producer,Cuvee,Appellation,Vintage,Color,Area,Format,Quantity,Price bought,Cellar,Location\n"
    b"Domaine Jean-Marc Burgaud,James,Cote du Py,2020,red,Beaujolais,75cl,6,18.50,Cave Nord,A1\n"
    b"Veuve Cliquot,Brut,Champagne,,sparkling,Champagne,75cl,3,32,Cave Nord,B2\n"
)

# French-style export: semicolon delimiter, comma decimal separator, accented headers.
SAMPLE_CSV_FR = (
    "Producteur;Cuvée;Appellation;Millésime;Couleur;Région;Format;Quantité;Prix d'achat\n"
    "Château Testard;Cuvée Spéciale;Pauillac;2015;rouge;Bordeaux;75cl;12;45,90\n"
).encode("cp1252")


class TestHeaderMapping(unittest.TestCase):
    def test_english_and_french_aliases_resolve_to_same_canonical_field(self):
        mapping = csv_io.map_headers(["Producer", "Producteur", "Millésime", "Vintage"])
        self.assertEqual(mapping["Producer"], "producer")
        self.assertEqual(mapping["Producteur"], "producer")
        self.assertEqual(mapping["Millésime"], "vintage")
        self.assertEqual(mapping["Vintage"], "vintage")


class TestNumberParsing(unittest.TestCase):
    def test_dot_decimal(self):
        self.assertEqual(csv_io.parse_number("18.50"), 18.5)

    def test_comma_decimal_french_style(self):
        self.assertEqual(csv_io.parse_number("45,90"), 45.9)

    def test_thousands_separator_not_mistaken_for_decimal(self):
        self.assertEqual(csv_io.parse_number("1,234"), 1234.0)

    def test_currency_symbol_stripped(self):
        self.assertEqual(csv_io.parse_number("€ 18.50"), 18.5)

    def test_blank_is_none(self):
        self.assertIsNone(csv_io.parse_number(""))
        self.assertIsNone(csv_io.parse_number(None))


class TestVintageParsing(unittest.TestCase):
    def test_plain_year(self):
        self.assertEqual(csv_io.parse_vintage("2020"), 2020)

    def test_blank_is_none(self):
        self.assertIsNone(csv_io.parse_vintage(""))

    def test_nv_is_none(self):
        self.assertIsNone(csv_io.parse_vintage("NV"))


class TestDateParsing(unittest.TestCase):
    def test_iso(self):
        self.assertEqual(csv_io.parse_date_value("2028-06-15"), date(2028, 6, 15))

    def test_french_slash_format(self):
        self.assertEqual(csv_io.parse_date_value("15/06/2028"), date(2028, 6, 15))

    def test_bare_year_drink_after_means_jan_1(self):
        self.assertEqual(csv_io.parse_date_value("2028", year_end_of_year=False), date(2028, 1, 1))

    def test_bare_year_drink_before_means_dec_31(self):
        self.assertEqual(csv_io.parse_date_value("2028", year_end_of_year=True), date(2028, 12, 31))


class TestFormatMlParsing(unittest.TestCase):
    def test_cl(self):
        self.assertEqual(csv_io.parse_format_ml("75cl"), 750)

    def test_liters(self):
        self.assertEqual(csv_io.parse_format_ml("1.5L"), 1500)

    def test_unparseable_returns_none(self):
        self.assertIsNone(csv_io.parse_format_ml("Magnum"))


class TestImportCsv(DatabaseTestCase):
    def test_missing_mandatory_column_raises(self):
        bad_csv = b"Producer,Cuvee\nFoo,Bar\n"
        with self.assertRaises(ValidationError):
            csv_io.import_csv(bad_csv, conn=self.conn, user_id=None)

    def test_happy_path_creates_wines_and_holdings_and_journal(self):
        # Cellars are defined explicitly (feature 3) before importing bottles into
        # them (feature 4): a CSV row naming a cellar that doesn't exist yet should
        # warn rather than silently create one (a typo shouldn't spawn a bogus cellar).
        from app.core.domain import Cellar, new_id

        repo.insert_cellar(
            self.conn,
            Cellar(id=new_id(), name="Cave Nord", purpose_level=5, max_capacity=200, threshold=180),
        )

        report = csv_io.import_csv(SAMPLE_CSV_EN, conn=self.conn, user_id="u1")
        self.assertEqual(report.total_rows, 2)
        self.assertEqual(report.imported, 2)
        self.assertEqual(len(report.warnings), 0)

        wines = repo.list_wines(self.conn)
        self.assertEqual(len(wines), 2)

        champagne = next(w for w in wines if w.producer == "Veuve Cliquot")
        self.assertIsNone(
            champagne.vintage, "Champagne with blank vintage must import as NV, not fail"
        )

        cellar = repo.get_cellar_by_name(self.conn, "Cave Nord")
        holdings = repo.list_holdings(self.conn, cellar_id=cellar.id)
        self.assertEqual(
            sum(h.quantity for h in holdings),
            9,
            "both rows' bottles should land in the pre-defined cellar",
        )

    def test_unknown_cellar_name_warns_instead_of_auto_creating(self):
        report = csv_io.import_csv(SAMPLE_CSV_EN, conn=self.conn, user_id="u1")
        self.assertEqual(len(report.warnings), 2)
        self.assertIsNone(repo.get_cellar_by_name(self.conn, "Cave Nord"))

    def test_french_csv_with_semicolons_and_comma_decimals(self):
        # First create the referenced cellar isn't required since this row has no cellar column.
        report = csv_io.import_csv(SAMPLE_CSV_FR, conn=self.conn, user_id="u1")
        self.assertEqual(report.imported, 1)
        wines = repo.list_wines(self.conn)
        self.assertEqual(wines[0].producer, "Château Testard")
        holdings = repo.list_holdings(self.conn, wine_id=wines[0].id)
        self.assertEqual(holdings[0].price_bought, 45.9)
        self.assertEqual(holdings[0].quantity, 12)

    def test_reimporting_same_wine_merges_rather_than_duplicates(self):
        csv_io.import_csv(SAMPLE_CSV_EN, conn=self.conn, user_id="u1")
        report2 = csv_io.import_csv(SAMPLE_CSV_EN, conn=self.conn, user_id="u1")
        self.assertEqual(report2.merged_into_existing_wine, 2)
        self.assertEqual(report2.imported, 0)
        wines = repo.list_wines(self.conn)
        self.assertEqual(
            len(wines), 2, "Re-importing the same rows must not duplicate the Wine catalog entry"
        )
        # quantities should have merged into the same holding (6+6=12)
        burgaud = next(w for w in wines if w.producer.startswith("Domaine"))
        holdings = repo.list_holdings(self.conn, wine_id=burgaud.id)
        self.assertEqual(sum(h.quantity for h in holdings), 12)

    def test_row_with_no_identity_is_skipped_with_warning(self):
        csv = b"Producer,Cuvee,Appellation,Vintage,Color,Area,Format\n,,,,red,,75cl\n"
        report = csv_io.import_csv(csv, conn=self.conn, user_id=None)
        self.assertEqual(report.skipped, 1)
        self.assertEqual(len(report.warnings), 1)


class TestExportCsv(DatabaseTestCase):
    def test_export_then_reimport_round_trip(self):
        csv_io.import_csv(SAMPLE_CSV_EN, conn=self.conn, user_id="u1")
        pairs = repo.list_holdings_with_wines(self.conn)
        rows = [(w, h, None) for h, w in pairs]

        exported_en = csv_io.export_csv(
            rows, columns=["producer", "cuvee", "vintage", "color", "quantity"], language="en"
        )
        self.assertIn("Producer", exported_en.splitlines()[0])
        self.assertIn("Domaine Jean-Marc Burgaud", exported_en)

        exported_fr = csv_io.export_csv(
            rows, columns=["producer", "cuvee", "vintage", "color", "quantity"], language="fr"
        )
        header_fr = exported_fr.splitlines()[0]
        self.assertIn("Producteur", header_fr)
        self.assertIn(";", header_fr, "French export should default to semicolon delimiter")
        self.assertIn(
            "Rouge", exported_fr, "Color enum value should be translated in French export"
        )

    def test_unknown_column_rejected(self):
        with self.assertRaises(ValidationError):
            csv_io.export_csv([], columns=["not_a_real_field"], language="en")


if __name__ == "__main__":
    unittest.main()
