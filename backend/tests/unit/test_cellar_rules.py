import unittest

from tests.conftest_helpers import DatabaseTestCase  # noqa: F401 (ensures sys.path setup runs)
from app.core.domain import Cellar, new_id
from app.core.exceptions import ConfigurationError
from app.services import cellar_rules


def _cellar(name, rule):
    return Cellar(id=new_id(), name=name, purpose_level=0, max_capacity=100, threshold=90, location_rule=rule)


class TestPrefixRules(unittest.TestCase):
    def test_prefix_matches_case_insensitively(self):
        self.assertTrue(cellar_rules.rule_matches("AG", "ag12"))
        self.assertTrue(cellar_rules.rule_matches("AG", "AG-B3"))
        self.assertFalse(cellar_rules.rule_matches("AG", "SV1"))

    def test_match_cellar_for_location_picks_the_right_cellar(self):
        aging = _cellar("Aging Room", "AG")
        service = _cellar("Service Fridge", "SV")
        result = cellar_rules.match_cellar_for_location("AG12", [aging, service])
        self.assertEqual(result.id, aging.id)

    def test_no_match_returns_none(self):
        aging = _cellar("Aging Room", "AG")
        self.assertIsNone(cellar_rules.match_cellar_for_location("ZZ99", [aging]))

    def test_more_specific_rule_wins_when_two_match(self):
        broad = _cellar("Everything", "A")
        specific = _cellar("Aging Row 1", "AG1")
        result = cellar_rules.match_cellar_for_location("AG12", [broad, specific])
        self.assertEqual(result.id, specific.id)


class TestRegexRules(unittest.TestCase):
    def test_regex_rule_with_named_group(self):
        cellar = _cellar("Aging", r"^AG-(?P<sub>\d+)$")
        self.assertTrue(cellar_rules.rule_matches(cellar.location_rule, "AG-12"))
        self.assertFalse(cellar_rules.rule_matches(cellar.location_rule, "AG12"))

    def test_sub_location_extraction_regex(self):
        rule = r"^AG-(?P<sub>\d+)$"
        self.assertEqual(cellar_rules.parse_sub_location(rule, "AG-12"), "12")

    def test_sub_location_extraction_prefix(self):
        self.assertEqual(cellar_rules.parse_sub_location("AG", "AG12"), "12")

    def test_invalid_regex_raises_configuration_error(self):
        with self.assertRaises(ConfigurationError):
            cellar_rules.rule_matches(r"^AG-(?P<sub>\d+$", "AG-12")  # unbalanced paren


class TestRuleUniqueness(unittest.TestCase):
    def test_duplicate_rule_rejected(self):
        existing = [_cellar("Aging", "AG")]
        with self.assertRaises(ConfigurationError):
            cellar_rules.validate_rule_uniqueness("ag", None, existing)

    def test_same_cellar_editing_its_own_rule_is_allowed(self):
        existing = [_cellar("Aging", "AG")]
        cellar_rules.validate_rule_uniqueness("AG", existing[0].id, existing)  # should not raise

    def test_distinct_rules_allowed(self):
        existing = [_cellar("Aging", "AG")]
        cellar_rules.validate_rule_uniqueness("SV", None, existing)  # should not raise


if __name__ == "__main__":
    unittest.main()
