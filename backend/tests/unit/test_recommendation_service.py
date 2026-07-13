import unittest
from datetime import date, timedelta

from app.core.domain import Holding, Wine, new_id
from app.services import recommendation_service as rec

TODAY = date(2026, 7, 9)


def _wine(**kwargs):
    defaults = dict(id=new_id(), producer="Producer", color="red")
    defaults.update(kwargs)
    return Wine(**defaults)


def _holding(**kwargs):
    defaults = dict(id=new_id(), wine_id="w", quantity=1, state="in_cellar")
    defaults.update(kwargs)
    return Holding(**defaults)


class TestHardFilters(unittest.TestCase):
    def test_color_filter(self):
        red = _wine(color="red")
        white = _wine(color="white")
        pairs = [(_holding(wine_id=red.id), red), (_holding(wine_id=white.id), white)]
        results = rec.recommend_wines(pairs, rec.RecommendationCriteria(color="white"), today=TODAY)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].wine.color, "white")

    def test_removed_or_empty_holdings_excluded(self):
        w = _wine()
        gifted = _holding(wine_id=w.id, quantity=1, state="gifted")
        empty = _holding(wine_id=w.id, quantity=0, state="in_cellar")
        results = rec.recommend_wines(
            [(gifted, w), (empty, w)], rec.RecommendationCriteria(), today=TODAY
        )
        self.assertEqual(len(results), 0)

    def test_appellation_partial_match(self):
        w = _wine(appellation="Cote du Py")
        results = rec.recommend_wines(
            [(_holding(wine_id=w.id), w)],
            rec.RecommendationCriteria(appellation="cote"),
            today=TODAY,
        )
        self.assertEqual(len(results), 1)

    def test_vintage_range(self):
        old = _wine(vintage=2010)
        new = _wine(vintage=2023)
        pairs = [(_holding(wine_id=old.id), old), (_holding(wine_id=new.id), new)]
        results = rec.recommend_wines(
            pairs, rec.RecommendationCriteria(vintage_before=2015), today=TODAY
        )
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].wine.vintage, 2010)

    def test_on_date_within_drink_window(self):
        w = _wine(drink_after=TODAY - timedelta(days=10), drink_before=TODAY + timedelta(days=10))
        out_of_window = _wine(drink_after=TODAY + timedelta(days=100))
        pairs = [(_holding(wine_id=w.id), w), (_holding(wine_id=out_of_window.id), out_of_window)]
        results = rec.recommend_wines(pairs, rec.RecommendationCriteria(on_date=TODAY), today=TODAY)
        self.assertEqual(len(results), 1)


class TestScoring(unittest.TestCase):
    def test_dish_keyword_match_ranks_higher(self):
        steak_wine = _wine(advice_pairing="Excellent with grilled steak and red meat")
        fish_wine = _wine(advice_pairing="Pairs beautifully with fish and seafood")
        pairs = [
            (_holding(wine_id=steak_wine.id), steak_wine),
            (_holding(wine_id=fish_wine.id), fish_wine),
        ]
        results = rec.recommend_wines(
            pairs, rec.RecommendationCriteria(dish="grilled steak"), today=TODAY
        )
        self.assertEqual(results[0].wine.id, steak_wine.id)
        self.assertGreater(results[0].score, results[1].score)

    def test_urgent_wine_surfaces_first_with_no_criteria(self):
        urgent = _wine(drink_before=TODAY + timedelta(days=5))
        relaxed = _wine(drink_before=TODAY + timedelta(days=2000))
        pairs = [(_holding(wine_id=relaxed.id), relaxed), (_holding(wine_id=urgent.id), urgent)]
        results = rec.recommend_wines(pairs, rec.RecommendationCriteria(), today=TODAY)
        self.assertEqual(results[0].wine.id, urgent.id)

    def test_reasons_are_populated(self):
        w = _wine(advice_pairing="great with roast chicken")
        results = rec.recommend_wines(
            [(_holding(wine_id=w.id), w)],
            rec.RecommendationCriteria(dish="roast chicken"),
            today=TODAY,
        )
        self.assertTrue(results[0].reasons)


if __name__ == "__main__":
    unittest.main()
