"""Matching a free-text `location` string (e.g. "AG12") to the cellar it
belongs to, using each cellar's configured ``location_rule``.

Two rule styles are supported so this stays usable for a "simple GUI" while
still allowing power users more control:

* A plain prefix, e.g. ``"AG"`` matches any location starting with AG
  (case-insensitive): "AG1", "ag12", "AG-B3" all match.
* A regular expression with a named group ``sub``, e.g.
  ``r"^AG-(?P<sub>\\d+)$"``, for when a prefix isn't precise enough.

Rules are validated for uniqueness when a cellar is created/updated (see
``services.holdings_service`` and the cellars router) so two cellars can
never claim the same location.
"""
from __future__ import annotations

import re
from typing import Optional

from app.core.domain import Cellar
from app.core.exceptions import ConfigurationError

_REGEX_HINT_CHARS = set(".^$*+?{}[]|()\\")


def _looks_like_regex(rule: str) -> bool:
    return any(ch in _REGEX_HINT_CHARS for ch in rule)


def rule_matches(rule: str, location: str) -> bool:
    """Does this single rule match this location string?"""
    if not rule or not location:
        return False
    if _looks_like_regex(rule):
        try:
            return re.match(rule, location, flags=re.IGNORECASE) is not None
        except re.error as exc:
            raise ConfigurationError(f"Invalid location rule regex '{rule}': {exc}") from exc
    return location.strip().lower().startswith(rule.strip().lower())


def match_cellar_for_location(location: Optional[str], cellars: list[Cellar]) -> Optional[Cellar]:
    """Return the (single) cellar whose location_rule matches this location,
    or None if no rule matches. If a location string happens to match more
    than one cellar's rule, the longest rule wins (most specific), which
    keeps behaviour predictable without forcing perfectly disjoint rules.
    """
    if not location:
        return None
    candidates = [c for c in cellars if c.location_rule and rule_matches(c.location_rule, location)]
    if not candidates:
        return None
    candidates.sort(key=lambda c: len(c.location_rule or ""), reverse=True)
    return candidates[0]


def validate_rule_uniqueness(new_rule: Optional[str], cellar_id: Optional[str], existing: list[Cellar]) -> None:
    """Raise ConfigurationError if `new_rule` would be indistinguishable from
    another cellar's existing rule (same rule string, case-insensitive).
    This is a deliberately simple check (exact-string clash), not a full
    regex-overlap analysis - good enough to catch the common mistake of
    copy-pasting a rule into two cellars.
    """
    if not new_rule:
        return
    for c in existing:
        if c.id == cellar_id:
            continue
        if c.location_rule and c.location_rule.strip().lower() == new_rule.strip().lower():
            raise ConfigurationError(
                f"Location rule '{new_rule}' is already used by cellar '{c.name}'"
            )


def parse_sub_location(rule: str, location: str) -> Optional[str]:
    """If `rule` is a regex with a `sub` group, return the captured sub-location.
    For a plain prefix rule, returns the remainder of the string after the prefix.
    """
    if _looks_like_regex(rule):
        m = re.match(rule, location, flags=re.IGNORECASE)
        if m and "sub" in m.groupdict():
            return m.group("sub")
        return None
    if location.strip().lower().startswith(rule.strip().lower()):
        return location.strip()[len(rule.strip()):]
    return None
