from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from app import config
from app.services import internet_enrichment as research


def _configure(
    monkeypatch: pytest.MonkeyPatch,
    *,
    openai: str = "",
    brave: str = "",
    requested: str = "brave_openai",
    order: list[str] | None = None,
    manual: bool = True,
) -> None:
    monkeypatch.setattr(config, "OPENAI_API_KEY", openai)
    monkeypatch.setattr(config, "BRAVE_SEARCH_API_KEY", brave)
    monkeypatch.setattr(config, "ENRICHMENT_PROVIDER", requested)
    monkeypatch.setattr(
        config,
        "ENRICHMENT_AUTOMATIC_PROVIDER_ORDER",
        order or ["brave_openai", "openai_web"],
    )
    monkeypatch.setattr(config, "MANUAL_CHATGPT_ENABLED", manual)


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


def _manual_response() -> dict:
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


def test_no_credentials_exposes_manual_only(monkeypatch: pytest.MonkeyPatch) -> None:
    _configure(monkeypatch)

    status = research.provider_status()

    assert status.configured is False
    assert status.automatic_provider is None
    assert status.manual_available is True
    assert [item["provider"] for item in status.available_providers] == ["manual_chatgpt"]


def test_missing_brave_key_falls_back_to_openai(monkeypatch: pytest.MonkeyPatch) -> None:
    _configure(monkeypatch, openai="openai-key", brave="")

    status = research.provider_status()

    assert status.configured is True
    assert status.requested_provider == "brave_openai"
    assert status.provider == "openai_web"
    assert status.automatic_provider == "openai_web"
    assert [item["provider"] for item in status.available_providers] == [
        "manual_chatgpt",
        "openai_web",
    ]


def test_complete_brave_credentials_keep_preferred_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure(monkeypatch, openai="openai-key", brave="brave-key")

    status = research.provider_status()

    assert status.automatic_provider == "brave_openai"
    assert [item["provider"] for item in status.available_providers] == [
        "manual_chatgpt",
        "brave_openai",
        "openai_web",
    ]


def test_no_credentials_and_manual_disabled_exposes_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure(monkeypatch, manual=False)

    status = research.provider_status()

    assert status.configured is False
    assert status.manual_available is False
    assert status.available_providers == []


def test_manual_request_needs_no_credential(monkeypatch: pytest.MonkeyPatch) -> None:
    _configure(monkeypatch)

    prepared = research.prepare_manual_chatgpt_request(
        _wine(),
        topics=["pairing", "drinking_window"],
        locale="fr",
    )

    assert prepared["level"] == 4
    assert prepared["provider"] == "manual_chatgpt"
    assert prepared["topics"] == ["drinking_window", "pairing"]
    assert "Example Estate" in prepared["prompt"]
    assert "Required JSON Schema" in prepared["prompt"]


def test_manual_response_validation_accepts_object_or_json() -> None:
    payload = _manual_response()

    assert research._validate_manual_response(payload) == payload
    fenced = "```json\n" + json.dumps(payload) + "\n```"
    assert research._validate_manual_response(fenced) == payload


def test_manual_response_validation_rejects_missing_sections() -> None:
    with pytest.raises(research.ProviderResponseError, match="missing"):
        research._validate_manual_response({"identity": {}})


def test_manual_response_validation_rejects_malformed_list_items() -> None:
    payload = _manual_response()
    payload["pairings"] = ["not-an-object"]

    with pytest.raises(research.ProviderResponseError, match="non-object"):
        research._validate_manual_response(payload)
