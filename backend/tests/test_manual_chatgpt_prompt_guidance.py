from __future__ import annotations

from types import SimpleNamespace

import pytest

from app import config
from app.services import internet_enrichment as research


def _wine():
    return SimpleNamespace(
        id="wine-1",
        producer="Example Estate",
        cuvee="Reserve",
        appellation="Example AOC",
        vintage=2021,
        area="Example Region",
        color="white",
        format="75cl",
        format_ml=750,
    )


def _response() -> dict:
    return {
        "identity": {
            "matched_name": "Example Estate Reserve 2021",
            "confidence": 0.9,
            "explanation": "Exact identity match.",
            "ambiguities": [],
        },
        "drinking_windows": [],
        "market_observations": [],
        "pairings": [],
        "serving": {
            "available": False,
            "temperature_min_c": None,
            "temperature_max_c": None,
            "decant_minutes": None,
            "stand_upright_hours": None,
            "glass": None,
            "rationale": "Insufficient evidence.",
            "source_urls": [],
            "method": "unavailable",
        },
        "composition": {
            "available": False,
            "grapes": [],
            "alcohol_percent": None,
            "sweetness": None,
            "oak": None,
            "certifications": [],
            "source_urls": [],
        },
        "reviews": [],
        "external_identifiers": [],
        "summary": "No supported enrichment found.",
    }


def test_manual_prompt_contains_copy_paste_format_rules(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(config, "MANUAL_CHATGPT_ENABLED", True)

    prepared = research.prepare_manual_chatgpt_request(
        _wine(),
        topics=["composition", "drinking_window"],
        locale="fr",
    )

    prompt = prepared["prompt"]
    assert "fenced ```json code block" in prompt
    assert "standard ASCII double quotes" in prompt
    assert "Never use typographic/smart quotes" in prompt
    assert "Never return a month-only YYYY-MM value" in prompt
    assert "use null rather than inventing a day" in prompt
    assert prepared["format_rules"]["json_quotes"].startswith("Use standard ASCII")
    assert "never YYYY-MM" in prepared["format_rules"]["dates"]


def test_date_fields_explain_full_date_or_null_in_generated_schema() -> None:
    schema = research._research_schema()
    definitions = schema["$defs"]

    assert (
        "YYYY-MM-DD"
        in definitions["DrinkingWindowObservation"]["properties"]["published_at"]["description"]
    )
    assert (
        "month-only YYYY-MM"
        in definitions["MarketObservation"]["properties"]["observed_at"]["description"]
    )
    assert (
        "Use null" in definitions["ReviewObservation"]["properties"]["review_date"]["description"]
    )


def test_month_only_date_error_tells_user_to_use_null() -> None:
    payload = _response()
    payload["reviews"] = [
        {
            "score": 93.0,
            "scale": 100.0,
            "reviewer": "Example Critic",
            "review_date": "2023-01",
            "note_excerpt": "A short note.",
            "source_url": "https://example.com/review",
            "exact_vintage": True,
        }
    ]

    with pytest.raises(
        research.ProviderResponseError,
        match=r"review_date: Value error, must be a complete ISO-8601 date .*use null",
    ):
        research._validate_manual_response(payload)
