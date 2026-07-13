"""Backend i18n: loads JSON dictionaries and resolves translation keys.

Adding a new language is: drop a new ``xx.json`` file in this directory with
the same keys as ``en.json``, and it is picked up automatically - nothing
else in the codebase needs to change. Missing keys in a non-English locale
fall back to English rather than showing a raw key to the person.
"""

from __future__ import annotations

import json
from pathlib import Path

_I18N_DIR = Path(__file__).parent
DEFAULT_LOCALE = "en"


def available_locales() -> list[str]:
    return sorted(p.stem for p in _I18N_DIR.glob("*.json"))


def _load(locale: str) -> dict[str, str]:
    path = _I18N_DIR / f"{locale}.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


_CACHE: dict[str, dict[str, str]] = {}


def _dictionary(locale: str) -> dict[str, str]:
    if locale not in _CACHE:
        _CACHE[locale] = _load(locale)
    return _CACHE[locale]


def translate(key: str, locale: str = DEFAULT_LOCALE, **params) -> str:
    locale = locale if locale in available_locales() else DEFAULT_LOCALE
    text = _dictionary(locale).get(key) or _dictionary(DEFAULT_LOCALE).get(key) or key
    if params:
        try:
            return text.format(**params)
        except (KeyError, IndexError):
            return text
    return text


def translate_all(locale: str = DEFAULT_LOCALE) -> dict[str, str]:
    """Full dictionary for a locale, English-filled for any missing key -
    handy for shipping one flat JSON blob to the frontend if ever needed."""
    locale = locale if locale in available_locales() else DEFAULT_LOCALE
    merged = dict(_dictionary(DEFAULT_LOCALE))
    merged.update(_dictionary(locale))
    return merged
