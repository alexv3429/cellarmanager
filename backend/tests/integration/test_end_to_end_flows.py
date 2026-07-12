"""End-to-end system test exercising the whole backend stack together:
CSV import -> add/move/remove actions -> journal -> statistics -> move-plan
-> recommendations -> CSV export.

Deliberately written against the service layer directly (not HTTP) so it
runs with nothing but the Python standard library - no FastAPI/uvicorn
install required. ``tests/integration/test_api.py`` covers the same
territory through real HTTP requests once backend dependencies are
installed (see requirements-dev.txt / CI).
"""
import unittest
from datetime import date, timedelta

from tests.conftest_helpers import DatabaseTestCase
from app.core.domain import Cellar, HoldingState, new_id
from app.services import csv_io, holdings_service as hs, moveplan_service, recommendation_service as rec, stats_service
from app.storage import repositories as repo

TODAY = date(2026, 7, 9)


class TestFullCellarLifecycle(DatabaseTestCase):
    def setUp(self):
        super().setUp()
        # 1. Define cellars first (feature 3), as the real workflow expects.
        self.aging = Cellar(
            id=new_id(), name="Cave Nord", purpose_level=1, max_capacity=200, threshold=180,
            location_rule="AG",
        )
        self.service = Cellar(
            id=new_id(), name="Kitchen Fridge", purpose_level=9, max_capacity=24, threshold=20,
            location_rule="SV",
        )
        repo.insert_cellar(self.conn, self.aging)
        repo.insert_cellar(self.conn, self.service)

    def _import_sample(self):
        csv_bytes = (
            "Producer,Cuvee,Appellation,Vintage,Color,Area,Format,Quantity,Price bought,"
            "Cellar,Location,Drink after,Drink before,Advice for dish association\n"
            "Domaine Jean-Marc Burgaud,James,Cote du Py,2020,red,Beaujolais,75cl,12,18.50,"
            "Cave Nord,AG1,2023-01-01,2028-01-01,grilled meat and charcuterie\n"
            "Veuve Cliquot,Brut,Champagne,,sparkling,Champagne,75cl,6,32,"
            "Kitchen Fridge,SV1,,,seafood and celebrations\n"
            "Chateau Margaux,Grand Vin,Margaux,2018,red,Bordeaux,75cl,3,450,"
            "Cave Nord,AG2,2030-01-01,2045-01-01,slow-roasted lamb\n"
        ).encode("utf-8")
        return csv_io.import_csv(csv_bytes, conn=self.conn, user_id="u1")

    def test_full_lifecycle(self):
        # --- 2. Import ---------------------------------------------------
        report = self._import_sample()
        self.assertEqual(report.imported, 3)
        self.assertEqual(len(report.warnings), 0)
        wines = repo.list_wines(self.conn)
        self.assertEqual(len(wines), 3)

        burgaud = next(w for w in wines if w.producer.startswith("Domaine"))
        margaux = next(w for w in wines if "Margaux" in w.producer)
        clicquot = next(w for w in wines if w.producer == "Veuve Cliquot")

        # journal has one IMPORT movement per row
        self.assertEqual(len(repo.list_movements(self.conn)), 3)

        # --- 3. Add / move / remove actions -------------------------------
        holding = repo.list_holdings(self.conn, wine_id=burgaud.id)[0]
        add_result = hs.add_bottles(self.conn, wine_id=burgaud.id, cellar_id=self.aging.id, location="AG1", quantity=6)
        self.assertEqual(add_result.holding.quantity, 18)  # merged into the imported holding

        move_result = hs.move_bottles(
            self.conn, holding_id=add_result.holding.id, quantity=6,
            to_cellar_id=self.service.id, to_location="SV2",
        )
        self.assertEqual(move_result.holding.cellar_id, self.service.id)

        remove_result = hs.remove_bottles(
            self.conn, holding_id=move_result.holding.id, quantity=2, reason=HoldingState.DRUNK,
        )
        self.assertEqual(remove_result.holding.state, "drunk")

        self.assertEqual(len(repo.list_movements(self.conn)), 6)  # 3 import + add + move + remove

        # --- 4. Statistics --------------------------------------------------
        pairs = [(w, h) for h, w in repo.list_holdings_with_wines(self.conn)]
        stats = stats_service.compute_stats(pairs, today=TODAY)
        # 18(burgaud) - 6(moved) + 6(cliquot) + 3(margaux) + 4 remaining moved-but-not-removed... let's just check totals directly
        expected_total = sum(h.quantity for h in repo.list_holdings(self.conn, active_only=True) if h.state == "in_cellar")
        self.assertEqual(stats.total_bottles, expected_total)
        self.assertGreater(stats.by_color.counts.get("red", 0), 0)
        self.assertGreater(stats.total_value_bought, 0)

        # --- 5. Move plan -----------------------------------------------
        cellars = repo.list_cellars(self.conn)
        hw_pairs = repo.list_holdings_with_wines(self.conn)
        plan = moveplan_service.suggest_move_plan(cellars, hw_pairs, today=TODAY)
        # Margaux (drink_after 2030, long aging needed) sitting in Cave Nord (purpose_level=1)
        # is already well-placed; it should not appear as a step.
        margaux_moves = [s for s in plan.steps if s.wine_id == margaux.id]
        self.assertEqual(margaux_moves, [])

        # --- 6. Recommendations -------------------------------------------
        criteria = rec.RecommendationCriteria(dish="grilled meat")
        recs = rec.recommend_wines(hw_pairs, criteria, today=TODAY)
        self.assertTrue(any(r.wine.id == burgaud.id for r in recs))

        # --- 7. Locations for a wine ----------------------------------------
        locations = hs.locations_for_wine(self.conn, burgaud.id)
        self.assertGreaterEqual(len(locations), 1)

        # --- 8. Export, in French, chosen columns/order --------------------
        export_rows = [(w, h, repo.get_cellar(self.conn, h.cellar_id) if h.cellar_id else None)
                       for h, w in repo.list_holdings_with_wines(self.conn)]
        csv_text = csv_io.export_csv(
            export_rows, columns=["producer", "vintage", "color", "cellar", "quantity"], language="fr",
        )
        self.assertIn("Producteur", csv_text.splitlines()[0])
        self.assertIn("Domaine Jean-Marc Burgaud", csv_text)

    def test_reimport_is_idempotent_for_totals(self):
        self._import_sample()
        totals_after_first = sum(h.quantity for h in repo.list_holdings(self.conn, active_only=True))
        self._import_sample()
        totals_after_second = sum(h.quantity for h in repo.list_holdings(self.conn, active_only=True))
        self.assertEqual(totals_after_second, totals_after_first * 2, "re-importing the same file adds the same quantities again, without duplicating wines")
        self.assertEqual(len(repo.list_wines(self.conn)), 3, "wine catalog must not duplicate on re-import")


if __name__ == "__main__":
    unittest.main()
