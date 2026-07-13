import unittest

from app.core.domain import Cellar, HoldingState, Wine, new_id
from app.core.exceptions import ValidationError
from app.services import holdings_service as hs
from app.storage import repositories as repo
from tests.conftest_helpers import DatabaseTestCase


class TestAddBottles(DatabaseTestCase):
    def setUp(self):
        super().setUp()
        self.wine = Wine(id=new_id(), producer="X", color="red")
        repo.insert_wine(self.conn, self.wine)
        self.cellar = Cellar(id=new_id(), name="Cave", max_capacity=10, threshold=8)
        repo.insert_cellar(self.conn, self.cellar)

    def test_add_creates_holding_and_journal_entry(self):
        result = hs.add_bottles(
            self.conn, wine_id=self.wine.id, cellar_id=self.cellar.id, location="A1", quantity=6
        )
        self.assertEqual(result.holding.quantity, 6)
        self.assertIsNotNone(result.movement)
        self.assertEqual(repo.cellar_fill(self.conn, self.cellar.id), 6)

    def test_add_merges_into_existing_holding(self):
        hs.add_bottles(
            self.conn, wine_id=self.wine.id, cellar_id=self.cellar.id, location="A1", quantity=3
        )
        result = hs.add_bottles(
            self.conn, wine_id=self.wine.id, cellar_id=self.cellar.id, location="A1", quantity=2
        )
        self.assertEqual(result.holding.quantity, 5)
        self.assertEqual(len(repo.list_holdings(self.conn, wine_id=self.wine.id)), 1)

    def test_add_warns_over_threshold(self):
        result = hs.add_bottles(
            self.conn, wine_id=self.wine.id, cellar_id=self.cellar.id, location="A1", quantity=9
        )
        self.assertIsNotNone(result.warning)

    def test_add_zero_or_negative_rejected(self):
        with self.assertRaises(ValidationError):
            hs.add_bottles(
                self.conn, wine_id=self.wine.id, cellar_id=self.cellar.id, location="A1", quantity=0
            )


class TestMoveBottles(DatabaseTestCase):
    def setUp(self):
        super().setUp()
        self.wine = Wine(id=new_id(), producer="X", color="red")
        repo.insert_wine(self.conn, self.wine)
        self.cellar_a = Cellar(id=new_id(), name="A", max_capacity=100, threshold=90)
        self.cellar_b = Cellar(id=new_id(), name="B", max_capacity=100, threshold=90)
        repo.insert_cellar(self.conn, self.cellar_a)
        repo.insert_cellar(self.conn, self.cellar_b)
        self.add_result = hs.add_bottles(
            self.conn, wine_id=self.wine.id, cellar_id=self.cellar_a.id, location="A1", quantity=10
        )

    def test_full_move(self):
        result = hs.move_bottles(
            self.conn,
            holding_id=self.add_result.holding.id,
            quantity=10,
            to_cellar_id=self.cellar_b.id,
            to_location="B1",
        )
        self.assertEqual(repo.cellar_fill(self.conn, self.cellar_a.id), 0)
        self.assertEqual(repo.cellar_fill(self.conn, self.cellar_b.id), 10)
        self.assertEqual(result.holding.cellar_id, self.cellar_b.id)

    def test_partial_move_splits_holding(self):
        hs.move_bottles(
            self.conn,
            holding_id=self.add_result.holding.id,
            quantity=4,
            to_cellar_id=self.cellar_b.id,
            to_location="B1",
        )
        self.assertEqual(repo.cellar_fill(self.conn, self.cellar_a.id), 6)
        self.assertEqual(repo.cellar_fill(self.conn, self.cellar_b.id), 4)

    def test_cannot_move_more_than_available(self):
        with self.assertRaises(ValidationError):
            hs.move_bottles(
                self.conn,
                holding_id=self.add_result.holding.id,
                quantity=999,
                to_cellar_id=self.cellar_b.id,
                to_location="B1",
            )

    def test_move_merges_into_existing_destination_holding(self):
        hs.add_bottles(
            self.conn, wine_id=self.wine.id, cellar_id=self.cellar_b.id, location="B1", quantity=5
        )
        hs.move_bottles(
            self.conn,
            holding_id=self.add_result.holding.id,
            quantity=3,
            to_cellar_id=self.cellar_b.id,
            to_location="B1",
        )
        holdings_b = repo.list_holdings(self.conn, cellar_id=self.cellar_b.id, active_only=True)
        self.assertEqual(
            len(holdings_b),
            1,
            "moving into a spot with an existing holding should merge, not fragment",
        )
        self.assertEqual(holdings_b[0].quantity, 8)


class TestRemoveBottles(DatabaseTestCase):
    def setUp(self):
        super().setUp()
        self.wine = Wine(id=new_id(), producer="X", color="red")
        repo.insert_wine(self.conn, self.wine)
        self.cellar = Cellar(id=new_id(), name="Cave", max_capacity=100, threshold=90)
        repo.insert_cellar(self.conn, self.cellar)
        self.add_result = hs.add_bottles(
            self.conn, wine_id=self.wine.id, cellar_id=self.cellar.id, location="A1", quantity=10
        )

    def test_partial_removal_splits_and_tags_state(self):
        result = hs.remove_bottles(
            self.conn,
            holding_id=self.add_result.holding.id,
            quantity=2,
            reason=HoldingState.GIFTED,
            note="birthday gift",
        )
        self.assertEqual(result.holding.state, "gifted")
        self.assertEqual(result.holding.quantity, 2)
        remaining = repo.get_holding(self.conn, self.add_result.holding.id)
        self.assertEqual(remaining.quantity, 8)
        self.assertEqual(remaining.state, "in_cellar")

    def test_cellar_fill_drops_after_removal(self):
        hs.remove_bottles(
            self.conn, holding_id=self.add_result.holding.id, quantity=3, reason=HoldingState.DRUNK
        )
        self.assertEqual(repo.cellar_fill(self.conn, self.cellar.id), 7)

    def test_invalid_reason_rejected(self):
        with self.assertRaises(ValidationError):
            hs.remove_bottles(
                self.conn,
                holding_id=self.add_result.holding.id,
                quantity=1,
                reason=HoldingState.IN_CELLAR,
            )

    def test_journal_records_negative_quantity_delta(self):
        result = hs.remove_bottles(
            self.conn, holding_id=self.add_result.holding.id, quantity=3, reason=HoldingState.LOST
        )
        self.assertEqual(result.movement.quantity_delta, -3)


class TestLocationsForWine(DatabaseTestCase):
    def test_locations_across_multiple_cellars(self):
        wine = Wine(id=new_id(), producer="X", color="red")
        repo.insert_wine(self.conn, wine)
        c1 = Cellar(id=new_id(), name="C1", max_capacity=100, threshold=90)
        c2 = Cellar(id=new_id(), name="C2", max_capacity=100, threshold=90)
        repo.insert_cellar(self.conn, c1)
        repo.insert_cellar(self.conn, c2)
        hs.add_bottles(self.conn, wine_id=wine.id, cellar_id=c1.id, location="A1", quantity=3)
        hs.add_bottles(self.conn, wine_id=wine.id, cellar_id=c2.id, location="B2", quantity=2)
        locations = hs.locations_for_wine(self.conn, wine.id)
        self.assertEqual(len(locations), 2)
        total = sum(loc["quantity"] for loc in locations)
        self.assertEqual(total, 5)


if __name__ == "__main__":
    unittest.main()
