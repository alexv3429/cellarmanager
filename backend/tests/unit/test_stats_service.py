import unittest
from datetime import date, timedelta

from app.core.domain import Holding, Wine, new_id
from app.services import stats_service


def _wine(**kwargs):
    defaults = dict(id=new_id(), producer="P", color="red")
    defaults.update(kwargs)
    return Wine(**defaults)


def _holding(**kwargs):
    defaults = dict(id=new_id(), wine_id="w", quantity=1)
    defaults.update(kwargs)
    return Holding(**defaults)


class TestComputeStats(unittest.TestCase):
    def test_basic_counts_and_percentages(self):
        today = date(2026, 7, 9)
        red = _wine(color="red", area="Bordeaux", appellation="Pauillac", vintage=2015)
        white = _wine(color="white", area="Loire", appellation="Sancerre", vintage=2020)
        pairs = [
            (red, _holding(wine_id=red.id, quantity=6, price_bought=20.0)),
            (white, _holding(wine_id=white.id, quantity=4, price_bought=15.0)),
        ]
        stats = stats_service.compute_stats(pairs, today=today)
        self.assertEqual(stats.total_bottles, 10)
        self.assertEqual(stats.distinct_wines, 2)
        self.assertEqual(stats.by_color.counts["red"], 6)
        self.assertEqual(stats.by_color.percentages["red"], 60.0)
        self.assertEqual(stats.by_color.percentages["white"], 40.0)
        self.assertAlmostEqual(stats.total_value_bought, 6 * 20.0 + 4 * 15.0)

    def test_zero_quantity_holdings_excluded(self):
        w = _wine()
        pairs = [(w, _holding(wine_id=w.id, quantity=0))]
        stats = stats_service.compute_stats(pairs)
        self.assertEqual(stats.total_bottles, 0)
        self.assertEqual(stats.distinct_wines, 0)

    def test_removed_state_holdings_excluded_even_with_positive_quantity(self):
        # A 'drunk'/'gifted'/etc. holding keeps its quantity > 0 by design
        # (that's how the journal preserves history) but must never count
        # toward "how many bottles do I have".
        w = _wine()
        pairs = [
            (w, _holding(wine_id=w.id, quantity=6, state="in_cellar")),
            (w, _holding(wine_id=w.id, quantity=2, state="drunk")),
            (w, _holding(wine_id=w.id, quantity=1, state="gifted")),
        ]
        stats = stats_service.compute_stats(pairs)
        self.assertEqual(stats.total_bottles, 6)

    def test_drink_window_buckets(self):
        today = date(2026, 7, 9)
        overdue = _wine(drink_before=today - timedelta(days=1))
        ready = _wine(
            drink_after=today - timedelta(days=100), drink_before=today + timedelta(days=100)
        )
        not_ready = _wine(drink_after=today + timedelta(days=400))
        no_dates = _wine()
        pairs = [
            (overdue, _holding(wine_id=overdue.id, quantity=1)),
            (ready, _holding(wine_id=ready.id, quantity=2)),
            (not_ready, _holding(wine_id=not_ready.id, quantity=3)),
            (no_dates, _holding(wine_id=no_dates.id, quantity=4)),
        ]
        stats = stats_service.compute_stats(pairs, today=today)
        self.assertEqual(stats.drink_window.overdue, 1)
        self.assertEqual(stats.drink_window.ready_now, 2)
        self.assertEqual(stats.drink_window.not_ready_yet, 3)
        self.assertEqual(stats.drink_window.no_date_info, 4)

    def test_per_cellar_breakdown(self):
        today = date(2026, 7, 9)
        w1 = _wine(color="red")
        w2 = _wine(color="white")
        by_cellar = {
            "cellar-a": [(w1, _holding(wine_id=w1.id, quantity=5))],
            "cellar-b": [(w2, _holding(wine_id=w2.id, quantity=2))],
        }
        results = stats_service.compute_stats_per_cellar(by_cellar, today=today)
        self.assertEqual(results["cellar-a"].total_bottles, 5)
        self.assertEqual(results["cellar-b"].total_bottles, 2)


if __name__ == "__main__":
    unittest.main()
