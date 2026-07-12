import unittest
from datetime import date, timedelta

from app.core.domain import Cellar, Holding, Wine, new_id
from app.services import moveplan_service


TODAY = date(2026, 7, 9)


def _cellar(**kwargs):
    defaults = dict(id=new_id(), name="C", purpose_level=0, max_capacity=100, threshold=90)
    defaults.update(kwargs)
    return Cellar(**defaults)


def _wine(**kwargs):
    defaults = dict(id=new_id(), producer="Producer", color="red")
    defaults.update(kwargs)
    return Wine(**defaults)


def _holding(**kwargs):
    defaults = dict(id=new_id(), wine_id="w", quantity=1, state="in_cellar")
    defaults.update(kwargs)
    return Holding(**defaults)


class TestReadiness(unittest.TestCase):
    def test_past_drink_before_is_urgent(self):
        w = _wine(drink_before=TODAY - timedelta(days=10))
        r = moveplan_service.compute_readiness(w, today=TODAY)
        self.assertEqual(r.score, 10.0)
        self.assertTrue(r.has_signal)

    def test_far_future_drink_after_needs_aging(self):
        w = _wine(drink_after=TODAY + timedelta(days=1000))
        r = moveplan_service.compute_readiness(w, today=TODAY)
        self.assertEqual(r.score, 0.0)
        self.assertTrue(r.has_signal)

    def test_no_dates_is_neutral_and_unsignalled(self):
        w = _wine()
        r = moveplan_service.compute_readiness(w, today=TODAY)
        self.assertEqual(r.score, moveplan_service.NEUTRAL_READINESS)
        self.assertIn("no drinking-window dates", r.reason)
        self.assertFalse(r.has_signal, "a wine with no dates at all must not claim real signal")

    def test_within_window_interpolates(self):
        w = _wine(drink_after=TODAY - timedelta(days=50), drink_before=TODAY + timedelta(days=50))
        r = moveplan_service.compute_readiness(w, today=TODAY)
        self.assertAlmostEqual(r.score, 5.0, delta=0.5)
        self.assertTrue(r.has_signal)


class TestSuggestMovePlan(unittest.TestCase):
    def test_bottle_ready_soon_in_aging_cellar_is_suggested_to_move_to_service(self):
        aging = _cellar(name="Aging", purpose_level=0, max_capacity=100, threshold=90)
        service = _cellar(name="Service", purpose_level=10, max_capacity=50, threshold=45)
        urgent_wine = _wine(drink_before=TODAY + timedelta(days=30))
        holding = _holding(wine_id=urgent_wine.id, cellar_id=aging.id, quantity=2)

        plan = moveplan_service.suggest_move_plan([aging, service], [(holding, urgent_wine)], today=TODAY)
        self.assertEqual(len(plan.steps), 1)
        self.assertEqual(plan.steps[0].to_cellar_id, service.id)
        self.assertEqual(plan.steps[0].from_cellar_id, aging.id)

    def test_well_placed_bottle_is_not_suggested_to_move(self):
        aging = _cellar(name="Aging", purpose_level=0, max_capacity=100, threshold=90)
        w = _wine(drink_after=TODAY + timedelta(days=900))  # needs long aging -> belongs in aging
        holding = _holding(wine_id=w.id, cellar_id=aging.id, quantity=2)
        plan = moveplan_service.suggest_move_plan([aging], [(holding, w)], today=TODAY)
        self.assertEqual(len(plan.steps), 0)

    def test_capacity_constraint_respected(self):
        aging = _cellar(name="Aging", purpose_level=0, max_capacity=100, threshold=90)
        full_service = _cellar(name="Service", purpose_level=10, max_capacity=5, threshold=5)
        urgent_wine = _wine(drink_before=TODAY + timedelta(days=10))
        holding = _holding(wine_id=urgent_wine.id, cellar_id=aging.id, quantity=2)
        other_wine = _wine(color="white")
        filler = _holding(wine_id=other_wine.id, cellar_id=full_service.id, quantity=5)  # fills the service cellar

        plan = moveplan_service.suggest_move_plan(
            [aging, full_service], [(holding, urgent_wine), (filler, other_wine)], today=TODAY
        )
        self.assertEqual(len(plan.steps), 0)
        self.assertEqual(len(plan.unplaceable), 1)

    def test_no_date_bottle_not_shuffled_purely_for_purpose_level_mismatch(self):
        aging = _cellar(name="Aging", purpose_level=0, max_capacity=100, threshold=90)
        service = _cellar(name="Service", purpose_level=10, max_capacity=50, threshold=45)
        mystery_wine = _wine()  # no drink_after/drink_before at all
        holding = _holding(wine_id=mystery_wine.id, cellar_id=service.id, quantity=3)
        plan = moveplan_service.suggest_move_plan([aging, service], [(holding, mystery_wine)], today=TODAY)
        self.assertEqual(len(plan.steps), 0, "no signal to justify moving a bottle we know nothing about")

    def test_cellar_over_threshold_is_flagged(self):
        aging = _cellar(name="Aging", purpose_level=0, max_capacity=100, threshold=5)
        w = _wine()
        holding = _holding(wine_id=w.id, cellar_id=aging.id, quantity=10)
        plan = moveplan_service.suggest_move_plan([aging], [(holding, w)], today=TODAY)
        self.assertIn("Aging", plan.cellars_over_threshold)

    def test_overflow_bottles_prioritized_into_real_cellar_when_room_exists(self):
        overflow = _cellar(name="Garage overflow", purpose_level=None, is_overflow=True, max_capacity=0, threshold=0)
        real = _cellar(name="Real Cellar", purpose_level=5, max_capacity=50, threshold=45)
        w = _wine()
        holding = _holding(wine_id=w.id, cellar_id=overflow.id, quantity=3)
        plan = moveplan_service.suggest_move_plan([overflow, real], [(holding, w)], today=TODAY)
        self.assertEqual(len(plan.steps), 1)
        self.assertEqual(plan.steps[0].to_cellar_id, real.id)
        self.assertIn("overflow", plan.steps[0].reason)


if __name__ == "__main__":
    unittest.main()
