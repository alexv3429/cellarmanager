from __future__ import annotations

import json
import sqlite3
from types import SimpleNamespace

import pytest

from app import config
from app.services import internet_enrichment as research
from app.storage import enrichment_repository as er


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
    with pytest.raises(research.ProviderResponseError, match="schema validation"):
        research._validate_manual_response({"identity": {}})


def test_manual_response_validation_rejects_malformed_list_items() -> None:
    payload = _manual_response()
    payload["pairings"] = ["not-an-object"]

    with pytest.raises(research.ProviderResponseError, match="pairings.0"):
        research._validate_manual_response(payload)


def _source_fields() -> dict:
    return {
        "source_url": "https://example.com/wine",
        "source_type": "producer",
        "published_at": "2026-07-14",
        "exact_producer": True,
        "exact_cuvee": True,
        "exact_vintage": True,
        "exact_format": True,
    }


def test_research_schema_is_generated_from_validation_model() -> None:
    assert research._research_schema() == research.ResearchResponse.model_json_schema()


def test_manual_response_validation_rejects_missing_nested_field() -> None:
    payload = _manual_response()
    del payload["serving"]["method"]

    with pytest.raises(research.ProviderResponseError, match="serving.method"):
        research._validate_manual_response(payload)


def test_manual_response_validation_rejects_invalid_source_type() -> None:
    payload = _manual_response()
    payload["drinking_windows"] = [
        {
            "drink_after_year": 2024,
            "drink_before_year": 2030,
            "explicitly_stated": True,
            "notes": "Producer guidance.",
            **_source_fields(),
            "source_type": ["producer"],
        }
    ]

    with pytest.raises(research.ProviderResponseError, match="source_type"):
        research._validate_manual_response(payload)


def test_manual_response_validation_rejects_extra_properties() -> None:
    payload = _manual_response()
    payload["identity"]["unexpected"] = "not allowed"

    with pytest.raises(research.ProviderResponseError, match="identity.unexpected"):
        research._validate_manual_response(payload)


def test_manual_response_validation_rejects_invalid_identifier_confidence() -> None:
    payload = _manual_response()
    payload["external_identifiers"] = [
        {
            "scheme": "example",
            "value": "123",
            "source_url": "https://example.com/wine",
            "confidence": "high",
        }
    ]

    with pytest.raises(research.ProviderResponseError, match="confidence"):
        research._validate_manual_response(payload)


def test_manual_response_validation_rejects_overlong_review_excerpt() -> None:
    payload = _manual_response()
    payload["reviews"] = [
        {
            "score": 95.0,
            "scale": 100.0,
            "reviewer": "Example Critic",
            "review_date": "2026-07-14",
            "note_excerpt": "x" * 241,
            "source_url": "https://example.com/review",
            "exact_vintage": True,
        }
    ]

    with pytest.raises(research.ProviderResponseError, match="note_excerpt"):
        research._validate_manual_response(payload)


def test_manual_response_validation_rejects_invalid_date() -> None:
    payload = _manual_response()
    payload["reviews"] = [
        {
            "score": None,
            "scale": None,
            "reviewer": "Example Critic",
            "review_date": "not-a-date",
            "note_excerpt": "A short note.",
            "source_url": "https://example.com/review",
            "exact_vintage": True,
        }
    ]

    with pytest.raises(research.ProviderResponseError, match="review_date"):
        research._validate_manual_response(payload)


def test_manual_response_validation_rejects_non_string_url() -> None:
    payload = _manual_response()
    payload["serving"]["source_urls"] = [123]

    with pytest.raises(research.ProviderResponseError, match="source_urls.0"):
        research._validate_manual_response(payload)


def test_manual_evidence_is_marked_unverified() -> None:
    payload = _manual_response()
    payload["drinking_windows"] = [
        {
            "drink_after_year": 2024,
            "drink_before_year": 2030,
            "explicitly_stated": True,
            "notes": "Producer guidance.",
            **_source_fields(),
        }
    ]
    parsed = research._validate_manual_response(payload)

    research._mark_manual_evidence_unverified(parsed)

    claim = parsed["drinking_windows"][0]
    assert claim["source_type"] == "unverified_manual"
    assert claim["exact_producer"] is True
    assert claim["exact_cuvee"] is True
    assert claim["exact_vintage"] is True
    assert claim["exact_format"] is True


def test_manual_import_never_auto_applies(monkeypatch: pytest.MonkeyPatch) -> None:
    _configure(monkeypatch)
    captured: dict = {}

    def create_job(_conn, **kwargs):
        captured["auto_apply"] = kwargs["auto_apply"]
        return {"id": "job-1"}

    monkeypatch.setattr(research.er, "create_job", create_job)
    monkeypatch.setattr(research.er, "set_job_running", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(research, "_persist_sources", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(research, "_persist_candidates", lambda *_args, **_kwargs: ["c-1"])
    monkeypatch.setattr(
        research.er,
        "cap_candidate_confidence_for_job",
        lambda _conn, job_id, maximum: captured.update({"capped_job": job_id, "maximum": maximum}),
    )
    monkeypatch.setattr(research.er, "complete_job", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        research.er,
        "get_job_with_results",
        lambda *_args, **_kwargs: {"id": "job-1", "status": "complete"},
    )
    monkeypatch.setattr(
        research,
        "apply_candidate",
        lambda *_args, **_kwargs: pytest.fail("manual candidate was auto-applied"),
    )

    result = research.import_manual_chatgpt_response(
        object(),
        wine=_wine(),
        user_id="user-1",
        topics=["pairing"],
        locale="en",
        response=_manual_response(),
    )

    assert result["status"] == "complete"
    assert captured["auto_apply"] is False
    assert captured["capped_job"] == "job-1"
    assert captured["maximum"] == research._manual_confidence_cap()


def test_manual_jobs_do_not_consume_automatic_job_quota() -> None:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE enrichment_jobs (provider TEXT NOT NULL, created_at TEXT NOT NULL)")
    conn.executemany(
        "INSERT INTO enrichment_jobs (provider, created_at) VALUES (?, ?)",
        [
            ("manual_chatgpt", "2026-07-14T08:00:00+00:00"),
            ("openai_web", "2026-07-14T09:00:00+00:00"),
            ("brave_openai", "2026-07-14T10:00:00+00:00"),
            ("openai_web", "2026-07-13T10:00:00+00:00"),
        ],
    )

    assert er.automatic_jobs_created_since(conn, "2026-07-14T00:00:00+00:00") == 2


def test_candidate_confidence_cap_only_reduces_target_job() -> None:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute(
        "CREATE TABLE enrichment_candidates (job_id TEXT NOT NULL, confidence REAL NOT NULL)"
    )
    conn.executemany(
        "INSERT INTO enrichment_candidates (job_id, confidence) VALUES (?, ?)",
        [("manual", 0.95), ("manual", 0.5), ("automatic", 0.99)],
    )

    er.cap_candidate_confidence_for_job(conn, "manual", 0.69)

    manual = [
        row["confidence"]
        for row in conn.execute(
            "SELECT confidence FROM enrichment_candidates WHERE job_id='manual' "
            "ORDER BY confidence DESC"
        )
    ]
    automatic = conn.execute(
        "SELECT confidence FROM enrichment_candidates WHERE job_id='automatic'"
    ).fetchone()["confidence"]
    assert manual == [0.69, 0.5]
    assert automatic == 0.99


def test_manual_confidence_cap_stays_below_auto_apply_threshold(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(config, "ENRICHMENT_AUTO_APPLY_THRESHOLD", 0.5)

    assert research._manual_confidence_cap() == pytest.approx(0.49)
