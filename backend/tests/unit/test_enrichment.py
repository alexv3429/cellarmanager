import unittest
from datetime import date

from app.core.domain import Wine, new_id
from app.services import enrichment


def _wine(**kwargs):
    defaults = dict(id=new_id(), producer="P", color="red")
    defaults.update(kwargs)
    return Wine(**defaults)


def dw(after=None, before=None, confidence=0.5, source="src"):
    return enrichment.DrinkingWindowResult(drink_after=after, drink_before=before, confidence=confidence, source=source)


def mi(value=None, confidence=0.5, source="src", pairing=None, experience=None):
    return enrichment.MarketInfoResult(market_value=value, advice_pairing=pairing, advice_experience=experience, confidence=confidence, source=source)


class TestAggregateDrinkingWindows(unittest.TestCase):
    def test_no_usable_results_returns_none(self):
        self.assertIsNone(enrichment.aggregate_drinking_windows([None, None]))

    def test_single_source_passthrough(self):
        result = enrichment.aggregate_drinking_windows([dw(after=date(2023, 1, 1), before=date(2030, 1, 1), confidence=0.4, source="a")])
        self.assertEqual(result.drink_after, date(2023, 1, 1))
        self.assertEqual(result.drink_before, date(2030, 1, 1))
        self.assertEqual(result.source_count, 1)
        self.assertEqual(result.sources, ["a"])

    def test_agreeing_sources_increase_confidence_above_the_average(self):
        results = [
            dw(after=date(2023, 1, 1), before=date(2030, 1, 1), confidence=0.4, source="a"),
            dw(after=date(2023, 1, 10), before=date(2030, 1, 10), confidence=0.4, source="b"),
            dw(after=date(2022, 12, 20), before=date(2029, 12, 20), confidence=0.4, source="c"),
        ]
        result = enrichment.aggregate_drinking_windows(results)
        self.assertGreater(result.confidence, 0.4, "three sources agreeing closely should be more trustworthy than any one alone")

    def test_wildly_disagreeing_sources_decrease_confidence_below_the_average(self):
        results = [
            dw(after=date(2021, 1, 1), before=date(2024, 1, 1), confidence=0.5, source="a"),
            dw(after=date(2035, 1, 1), before=date(2045, 1, 1), confidence=0.5, source="b"),
        ]
        result = enrichment.aggregate_drinking_windows(results)
        self.assertLess(result.confidence, 0.5, "wildly disagreeing sources should erode confidence even if individually plausible")

    def test_missing_bound_from_some_sources_handled_independently(self):
        results = [
            dw(after=date(2023, 1, 1), before=None, confidence=0.5, source="a"),
            dw(after=None, before=date(2030, 1, 1), confidence=0.5, source="b"),
        ]
        result = enrichment.aggregate_drinking_windows(results)
        self.assertEqual(result.drink_after, date(2023, 1, 1))
        self.assertEqual(result.drink_before, date(2030, 1, 1))

    def test_confidence_weighted_mean_favors_more_confident_source(self):
        results = [
            dw(after=date(2020, 1, 1), before=date(2020, 1, 1), confidence=0.9, source="confident"),
            dw(after=date(2040, 1, 1), before=date(2040, 1, 1), confidence=0.1, source="unsure"),
        ]
        result = enrichment.aggregate_drinking_windows(results)
        # weighted mean should land much closer to the confident source's 2020 than the midpoint (2030)
        self.assertLess(result.drink_after.year, 2028)

    def test_none_entries_in_list_are_ignored(self):
        results = [None, dw(after=date(2023, 1, 1), before=date(2030, 1, 1), confidence=0.5, source="a"), None]
        result = enrichment.aggregate_drinking_windows(results)
        self.assertEqual(result.source_count, 1)


class TestAggregateMarketInfo(unittest.TestCase):
    def test_no_usable_results_returns_none(self):
        self.assertIsNone(enrichment.aggregate_market_info([None, mi(value=None)]))

    def test_agreeing_prices_increase_confidence(self):
        results = [mi(value=20.0, confidence=0.4, source="a"), mi(value=21.0, confidence=0.4, source="b"), mi(value=19.5, confidence=0.4, source="c")]
        result = enrichment.aggregate_market_info(results)
        self.assertGreater(result.confidence, 0.4)
        self.assertAlmostEqual(result.market_value, 20.16, delta=1.0)

    def test_wildly_different_prices_decrease_confidence(self):
        results = [mi(value=10.0, confidence=0.5, source="a"), mi(value=500.0, confidence=0.5, source="b")]
        result = enrichment.aggregate_market_info(results)
        self.assertLess(result.confidence, 0.5)

    def test_advice_taken_from_highest_confidence_source_that_has_any(self):
        results = [
            mi(value=20.0, confidence=0.3, source="a", pairing=None),
            mi(value=21.0, confidence=0.6, source="b", pairing="grilled fish"),
            mi(value=19.0, confidence=0.4, source="c", pairing="red meat"),
        ]
        result = enrichment.aggregate_market_info(results)
        self.assertEqual(result.advice_pairing, "grilled fish")


class TestMergeValue(unittest.TestCase):
    def test_fills_missing_value(self):
        decision = enrichment.merge_value(existing_value=None, existing_confidence=None, fetched_value=42, fetched_confidence=0.5, fetched_source="test")
        self.assertTrue(decision.applied)
        self.assertEqual(decision.new_value, 42)

    def test_manual_value_never_auto_overwritten(self):
        decision = enrichment.merge_value(existing_value=100, existing_confidence=1.0, fetched_value=200, fetched_confidence=0.9, fetched_source="test")
        self.assertFalse(decision.applied)
        self.assertEqual(decision.new_value, 100)

    def test_higher_confidence_replaces(self):
        decision = enrichment.merge_value(existing_value=100, existing_confidence=0.3, fetched_value=200, fetched_confidence=0.9, fetched_source="test")
        self.assertTrue(decision.applied)

    def test_close_confidence_not_applied(self):
        decision = enrichment.merge_value(existing_value=100, existing_confidence=0.5, fetched_value=200, fetched_confidence=0.52, fetched_source="test")
        self.assertFalse(decision.applied)

    def test_nothing_fetched_refuses(self):
        decision = enrichment.merge_value(existing_value=100, existing_confidence=0.5, fetched_value=None, fetched_confidence=0.9, fetched_source="test")
        self.assertFalse(decision.applied)


class TestApplyDrinkingWindowEnrichment(unittest.TestCase):
    def test_applies_aggregated_result_to_empty_wine(self):
        wine = _wine()
        aggregated = enrichment.aggregate_drinking_windows([dw(after=date(2025, 1, 1), before=date(2030, 1, 1), confidence=0.4, source="mock-a")])
        enrichment.apply_drinking_window_enrichment(wine, aggregated)
        self.assertEqual(wine.drink_after, date(2025, 1, 1))
        self.assertIn("mock-a", wine.drink_after_source)

    def test_does_not_overwrite_manual_dates(self):
        wine = _wine(drink_after=date(2024, 1, 1), drink_after_confidence=1.0, drink_after_source="manual")
        aggregated = enrichment.aggregate_drinking_windows([dw(after=date(2099, 1, 1), confidence=0.9, source="mock-a")])
        enrichment.apply_drinking_window_enrichment(wine, aggregated)
        self.assertEqual(wine.drink_after, date(2024, 1, 1), "manual value must survive a fetched (even high-confidence) aggregate")


class TestMultipleProvidersRegistered(unittest.TestCase):
    def test_get_active_providers_returns_more_than_one(self):
        providers = enrichment.get_active_providers()
        self.assertGreaterEqual(len(providers), 2, "the whole point is combining several sources, not just one")

    def test_fetch_and_aggregate_combines_all_registered_providers(self):
        wine = _wine(vintage=2018)
        result = enrichment.fetch_and_aggregate_drinking_window(wine, enrichment.get_active_providers())
        self.assertIsNotNone(result)
        self.assertEqual(result.source_count, len(enrichment.get_active_providers()))
        self.assertLess(result.confidence, enrichment.MANUAL_CONFIDENCE, "aggregated/fetched data must never claim manual-level confidence")

    def test_fetch_and_aggregate_market_info_combines_all_registered_providers(self):
        wine = _wine(vintage=2018)
        result = enrichment.fetch_and_aggregate_market_info(wine, enrichment.get_active_providers())
        self.assertIsNotNone(result)
        self.assertEqual(result.source_count, len(enrichment.get_active_providers()))


if __name__ == "__main__":
    unittest.main()
