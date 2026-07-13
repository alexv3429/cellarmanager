import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import date
from pathlib import Path

from app.core.domain import Cellar, Holding, HoldingState, Wine
from app.core.exceptions import ConflictError, ValidationError
from app.services.csv_io import parse_positive_quantity
from app.services.holdings_service import add_bottles, move_bottles, remove_bottles
from app.services.moveplan_service import suggest_move_plan
from app.services.recommendation_service import RecommendationCriteria, recommend_wines
from app.storage import repositories as repo
from app.storage.database import Database
from scripts.backup_db import create_backup


class AuditRegressionTests(unittest.TestCase):
    def setUp(self):
        self.db = Database(":memory:")
        with self.db.session() as conn:
            repo.insert_wine(conn, Wine(id="wine", producer="Producer", vintage=2020))
            repo.insert_cellar(
                conn,
                Cellar(id="aging", name="Aging", purpose_level=0, max_capacity=100),
            )
            repo.insert_cellar(
                conn,
                Cellar(id="service", name="Service", purpose_level=10, max_capacity=2),
            )

    def tearDown(self):
        self.db.close_all()

    def test_duplicate_client_operation_does_not_double_apply(self):
        with self.db.session() as conn:
            add_bottles(
                conn,
                wine_id="wine",
                cellar_id="aging",
                location="AG1",
                quantity=2,
                client_op_id="same-op",
            )
        with self.db.session() as conn:
            result = add_bottles(
                conn,
                wine_id="wine",
                cellar_id="aging",
                location="AG1",
                quantity=2,
                client_op_id="same-op",
            )
            holding = repo.find_active_holding(conn, "wine", "aging", "AG1")
            self.assertTrue(result.duplicate)
            self.assertEqual(holding.quantity, 2)
            self.assertEqual(len(repo.list_movements(conn)), 1)

    def test_reusing_operation_id_with_different_payload_conflicts(self):
        with self.db.session() as conn:
            add_bottles(
                conn,
                wine_id="wine",
                cellar_id="aging",
                location="AG1",
                quantity=1,
                client_op_id="payload-op",
            )
        with self.assertRaises(ConflictError):
            with self.db.session() as conn:
                add_bottles(
                    conn,
                    wine_id="wine",
                    cellar_id="aging",
                    location="AG1",
                    quantity=3,
                    client_op_id="payload-op",
                )

    def test_duplicate_move_operation_does_not_move_twice(self):
        with self.db.session() as conn:
            source = add_bottles(
                conn,
                wine_id="wine",
                cellar_id="aging",
                location="AG4",
                quantity=3,
                client_op_id="move-source",
            ).holding
        with self.db.session() as conn:
            first = move_bottles(
                conn,
                holding_id=source.id,
                quantity=1,
                to_cellar_id="service",
                to_location="SV1",
                expected_version=source.version,
                client_op_id="same-move",
            )
        with self.db.session() as conn:
            replay = move_bottles(
                conn,
                holding_id=source.id,
                quantity=1,
                to_cellar_id="service",
                to_location="SV1",
                expected_version=source.version,
                client_op_id="same-move",
            )
            current_source = repo.get_holding(conn, source.id)
            target = repo.get_holding(conn, first.holding.id)
            self.assertTrue(replay.duplicate)
            self.assertEqual(current_source.quantity, 2)
            self.assertEqual(target.quantity, 1)

    def test_duplicate_remove_operation_does_not_remove_twice(self):
        with self.db.session() as conn:
            source = add_bottles(
                conn,
                wine_id="wine",
                cellar_id="aging",
                location="AG5",
                quantity=3,
                client_op_id="remove-source",
            ).holding
        with self.db.session() as conn:
            remove_bottles(
                conn,
                holding_id=source.id,
                quantity=1,
                reason=HoldingState.DRUNK,
                expected_version=source.version,
                client_op_id="same-remove",
            )
        with self.db.session() as conn:
            replay = remove_bottles(
                conn,
                holding_id=source.id,
                quantity=1,
                reason=HoldingState.DRUNK,
                expected_version=source.version,
                client_op_id="same-remove",
            )
            current_source = repo.get_holding(conn, source.id)
            self.assertTrue(replay.duplicate)
            self.assertEqual(current_source.quantity, 2)

    def test_cellar_version_is_loaded_and_incremented(self):
        with self.db.session() as conn:
            cellar = repo.get_cellar(conn, "aging")
            self.assertEqual(cellar.version, 1)
            cellar.name = "Aging updated"
            repo.update_cellar(conn, cellar, expected_version=1)
            self.assertEqual(cellar.version, 2)
            self.assertEqual(repo.get_cellar(conn, "aging").version, 2)

    def test_purpose_level_zero_is_not_neutral(self):
        wine = Wine(
            id="young",
            producer="Young",
            drink_after=date(2035, 1, 1),
        )
        holding = Holding(
            id="holding",
            wine_id=wine.id,
            cellar_id="aging",
            quantity=1,
            state=HoldingState.IN_CELLAR.value,
        )
        cellars = [
            Cellar(id="aging", name="Aging", purpose_level=0, max_capacity=100),
            Cellar(id="service", name="Service", purpose_level=10, max_capacity=100),
        ]
        plan = suggest_move_plan(cellars, [(holding, wine)], today=date(2026, 1, 1))
        self.assertEqual(plan.steps, [])

    def test_move_plan_can_offer_partial_move(self):
        wine = Wine(id="ready", producer="Ready", drink_before=date(2026, 2, 1))
        holding = Holding(
            id="holding",
            wine_id=wine.id,
            cellar_id="aging",
            quantity=5,
            state=HoldingState.IN_CELLAR.value,
        )
        occupied = Holding(
            id="occupied",
            wine_id="wine",
            cellar_id="service",
            quantity=1,
            state=HoldingState.IN_CELLAR.value,
        )
        base_wine = Wine(id="wine", producer="Base")
        cellars = [
            Cellar(id="aging", name="Aging", purpose_level=0, max_capacity=100),
            Cellar(id="service", name="Service", purpose_level=10, max_capacity=2),
        ]
        plan = suggest_move_plan(
            cellars,
            [(holding, wine), (occupied, base_wine)],
            today=date(2026, 1, 1),
        )
        self.assertEqual(len(plan.steps), 1)
        self.assertEqual(plan.steps[0].quantity, 1)

    def test_csv_quantity_must_be_positive_integer(self):
        self.assertEqual(parse_positive_quantity(""), 1)
        self.assertEqual(parse_positive_quantity("12"), 12)
        for value in ("0", "-2", "1.5", "not a number"):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                parse_positive_quantity(value)

    def test_known_purchase_prices_are_quantity_weighted_when_holdings_merge(self):
        with self.db.session() as conn:
            add_bottles(
                conn,
                wine_id="wine",
                cellar_id="aging",
                location="AG2",
                quantity=2,
                price_bought=10.0,
                client_op_id="price-1",
            )
        with self.db.session() as conn:
            add_bottles(
                conn,
                wine_id="wine",
                cellar_id="aging",
                location="AG2",
                quantity=2,
                price_bought=20.0,
                client_op_id="price-2",
            )
            holding = repo.find_active_holding(conn, "wine", "aging", "AG2")
            self.assertEqual(holding.quantity, 4)
            self.assertEqual(holding.price_bought, 15.0)

    def test_unknown_purchase_component_keeps_aggregate_cost_unknown(self):
        with self.db.session() as conn:
            add_bottles(
                conn,
                wine_id="wine",
                cellar_id="aging",
                location="AG3",
                quantity=1,
                price_bought=10.0,
                client_op_id="unknown-price-1",
            )
        with self.db.session() as conn:
            add_bottles(
                conn,
                wine_id="wine",
                cellar_id="aging",
                location="AG3",
                quantity=1,
                price_bought=None,
                client_op_id="unknown-price-2",
            )
            holding = repo.find_active_holding(conn, "wine", "aging", "AG3")
            self.assertEqual(holding.quantity, 2)
            self.assertIsNone(holding.price_bought)

    def test_non_vintage_does_not_pass_vintage_range(self):
        wine = Wine(id="nv", producer="NV", vintage=None)
        holding = Holding(id="nv-h", wine_id="nv", quantity=1, state=HoldingState.IN_CELLAR.value)
        results = recommend_wines([(holding, wine)], RecommendationCriteria(vintage_before=2020))
        self.assertEqual(results, [])

    def test_strict_dish_search_excludes_non_matches(self):
        wine = Wine(id="dish", producer="Dish", advice_pairing="oysters and shellfish")
        holding = Holding(
            id="dish-h", wine_id="dish", quantity=1, state=HoldingState.IN_CELLAR.value
        )
        results = recommend_wines(
            [(holding, wine)], RecommendationCriteria(dish="grilled beef", strict_text_match=True)
        )
        self.assertEqual(results, [])

    def test_database_backup_is_integrity_checked_and_readable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "cellar.db"
            destination = root / "backup.db"
            database = Database(str(source))
            with database.session() as conn:
                repo.insert_wine(conn, Wine(id="backup-wine", producer="Backup"))
            database.close_all()

            created = create_backup(source, destination)

            self.assertEqual(created, destination.resolve())
            with closing(sqlite3.connect(created)) as conn:
                self.assertEqual(conn.execute("PRAGMA integrity_check").fetchone()[0], "ok")
                self.assertEqual(
                    conn.execute("SELECT producer FROM wines WHERE id='backup-wine'").fetchone()[0],
                    "Backup",
                )


if __name__ == "__main__":
    unittest.main()
