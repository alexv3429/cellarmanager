import unittest

from app.core.domain import Cellar, Holding, Wine
from app.services import assignment_service, csv_io
from app.storage import repositories as repo
from app.storage.database import Database


class AssignmentReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.db = Database(":memory:")
        with self.db.session() as conn:
            repo.insert_wine(conn, Wine(id="wine", producer="Producer"))
            repo.insert_holding(
                conn,
                Holding(
                    id="unassigned",
                    wine_id="wine",
                    cellar_id=None,
                    location="AG1",
                    quantity=3,
                ),
            )

    def tearDown(self):
        self.db.close_all()

    def test_summary_makes_unassigned_stock_visible(self):
        with self.db.session() as conn:
            summary = assignment_service.unassigned_summary(conn)
            self.assertEqual(summary["holdings"], 1)
            self.assertEqual(summary["bottles"], 3)
            self.assertEqual(summary["with_location_bottles"], 3)

    def test_reconcile_moves_unassigned_holding_and_journals_it(self):
        with self.db.session() as conn:
            repo.insert_cellar(
                conn,
                Cellar(id="aging", name="Aging", purpose_level=0, location_rule="AG"),
            )
            result = assignment_service.reconcile_unassigned(conn, user_id="user")

            self.assertEqual(result.assigned_holdings, 1)
            self.assertEqual(result.assigned_bottles, 3)
            self.assertEqual(result.remaining_bottles, 0)

            source = repo.get_holding(conn, "unassigned")
            destination = repo.find_active_holding(conn, "wine", "aging", "AG1")
            self.assertEqual(source.quantity, 0)
            self.assertIsNotNone(destination)
            self.assertEqual(destination.quantity, 3)
            movements = repo.list_movements(conn)
            self.assertEqual(len(movements), 1)
            self.assertEqual(movements[0].from_cellar_id, None)
            self.assertEqual(movements[0].to_cellar_id, "aging")

    def test_only_cellar_filter_still_respects_longest_rule(self):
        with self.db.session() as conn:
            repo.insert_cellar(
                conn,
                Cellar(id="general", name="General", location_rule="AG"),
            )
            repo.insert_cellar(
                conn,
                Cellar(id="specific", name="Specific", location_rule="AG1"),
            )
            result = assignment_service.reconcile_unassigned(
                conn,
                user_id="user",
                only_cellar_id="general",
            )
            self.assertEqual(result.assigned_bottles, 0)
            self.assertEqual(result.remaining_bottles, 3)

            result = assignment_service.reconcile_unassigned(
                conn,
                user_id="user",
                only_cellar_id="specific",
            )
            self.assertEqual(result.assigned_bottles, 3)
            self.assertIsNotNone(repo.find_active_holding(conn, "wine", "specific", "AG1"))


class CsvUnassignedReportingTests(unittest.TestCase):
    CSV = (
        "Producer,Cuvee,Appellation,Vintage,Color,Area,Format,Quantity,Location\n"
        "Domaine,Cuvée,AOC,2020,red,Area,75cl,2,AG7\n"
    ).encode()

    def setUp(self):
        self.db = Database(":memory:")

    def tearDown(self):
        self.db.close_all()

    def test_preview_and_report_count_unassigned_bottles(self):
        with self.db.session() as conn:
            mapping = csv_io.analyze_csv(self.CSV)["suggested_mapping"]
            preview = csv_io.preview_csv(self.CSV, mapping=mapping, conn=conn)
            self.assertEqual(preview["unassigned_rows"], 1)
            self.assertEqual(preview["unassigned_bottles"], 2)

            report = csv_io.import_csv(
                self.CSV,
                mapping=mapping,
                conn=conn,
                user_id="user",
            )
            self.assertEqual(report.unassigned_rows, 1)
            self.assertEqual(report.unassigned_bottles, 2)
            self.assertTrue(any("No cellar exists yet" in w.message for w in report.warnings))


if __name__ == "__main__":
    unittest.main()
