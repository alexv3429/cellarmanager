from __future__ import annotations

import json
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
        vintage=2018,
        area="Example Region",
        color="red",
        format="bottle",
        format_ml=750,
    )


def _research_response() -> dict:
    return {
        "identity": {
            "matched_name": "Example Estate Reserve 2018",
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


def test_automatic_provider_validates_nested_structured_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(config, "OPENAI_API_KEY", "openai-key")
    payload = _research_response()
    payload["drinking_windows"] = [
        {
            "source_url": "https://example.com/wine",
            "source_type": ["producer"],
            "published_at": "2026-07-14",
            "exact_producer": True,
            "exact_cuvee": True,
            "exact_vintage": True,
            "exact_format": True,
            "drink_after_year": 2024,
            "drink_before_year": 2030,
            "explicitly_stated": True,
            "notes": "Producer guidance.",
        }
    ]

    def transport(_url, _headers, _request, _timeout):
        return research.HttpResponse(
            status=200,
            body={"output_text": json.dumps(payload), "usage": {}},
        )

    provider = research.OpenAIResearchProvider(transport=transport)
    with pytest.raises(
        research.ProviderResponseError,
        match=r"Automatic provider response failed schema validation: .*source_type",
    ):
        provider.research(
            _wine(),
            ["drinking_window"],
            "en",
            supplied_sources=[],
        )


def test_accepting_identifier_cannot_exceed_candidate_confidence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    candidate = {
        "id": "candidate-1",
        "status": "proposed",
        "wine_id": "wine-1",
        "topic": "identifiers",
        "label": "external_identifiers",
        "value": [
            {
                "scheme": "example",
                "value": "123",
                "confidence": 0.99,
            }
        ],
        "confidence": 0.69,
        "source_ids": ["source-1"],
        "job_id": "job-1",
    }
    captured: dict = {}

    monkeypatch.setattr(research.er, "get_candidate", lambda *_args: candidate)
    monkeypatch.setattr(research.repo, "get_wine", lambda *_args: _wine())

    def upsert_identifier(_conn, **kwargs):
        captured["identifier_confidence"] = kwargs["confidence"]

    def upsert_profile(_conn, **kwargs):
        captured["profile_value"] = json.loads(json.dumps(kwargs["value"]))

    monkeypatch.setattr(research.er, "upsert_external_identifier", upsert_identifier)
    monkeypatch.setattr(research.er, "upsert_profile_topic", upsert_profile)
    monkeypatch.setattr(research.er, "decide_candidate", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(research.repo, "insert_movement", lambda *_args, **_kwargs: None)

    research.apply_candidate(
        object(),
        candidate_id="candidate-1",
        user_id="user-1",
        force=True,
    )

    assert captured["identifier_confidence"] == pytest.approx(0.69)
    assert captured["profile_value"][0]["confidence"] == pytest.approx(0.69)
