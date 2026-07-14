from __future__ import annotations

import json
from datetime import date

from app import config
from app.core.domain import User, Wine, new_id
from app.services import internet_enrichment as ie
from app.storage import enrichment_repository as er
from app.storage import repositories as repo
from app.storage.database import Database


def _wine() -> Wine:
    return Wine(
        id=new_id(),
        producer="Domaine Example",
        cuvee="Reserve",
        appellation="Example AOC",
        vintage=2020,
        color="red",
        area="Example",
        format="75cl",
        format_ml=750,
    )


def test_confidence_is_backend_calculated_and_penalises_inference():
    evidence = [
        {
            "source_url": "https://producer.example/wine",
            "source_type": "producer",
            "exact_producer": True,
            "exact_cuvee": True,
            "exact_vintage": True,
            "exact_format": True,
            "published_at": date.today().isoformat(),
        }
    ]
    sourced = ie.confidence_score(
        identity_confidence=0.95,
        evidence=evidence,
        agreement=1.0,
        inferred=False,
    )
    inferred = ie.confidence_score(
        identity_confidence=0.95,
        evidence=evidence,
        agreement=1.0,
        inferred=True,
    )
    assert sourced > 0.8
    assert inferred < sourced


def test_market_engine_divides_case_price_and_rejects_wrong_format():
    wine = _wine()
    observations = [
        {
            "amount": 180,
            "currency": "EUR",
            "offer_type": "retail",
            "bottle_count": 6,
            "format_ml": 750,
            "in_stock": True,
            "source_url": "https://merchant-a.example",
            "source_type": "merchant",
            "exact_producer": True,
            "exact_cuvee": True,
            "exact_vintage": True,
            "exact_format": True,
        },
        {
            "amount": 32,
            "currency": "EUR",
            "offer_type": "retail",
            "bottle_count": 1,
            "format_ml": 750,
            "in_stock": True,
            "source_url": "https://merchant-b.example",
            "source_type": "merchant",
            "exact_producer": True,
            "exact_cuvee": True,
            "exact_vintage": True,
            "exact_format": True,
        },
        {
            "amount": 50,
            "currency": "EUR",
            "offer_type": "retail",
            "bottle_count": 1,
            "format_ml": 1500,
            "in_stock": True,
            "source_url": "https://wrong-format.example",
            "source_type": "merchant",
            "exact_producer": True,
            "exact_cuvee": True,
            "exact_vintage": True,
            "exact_format": False,
        },
    ]
    candidates = ie._market_candidates(observations, wine, 0.95)
    replacement = next(c for c in candidates if c["label"] == "replacement_value")
    assert replacement["value"]["amount"] == 31.0
    assert replacement["value"]["observations"] == 2
    assert any(c["label"] == "quick_sale_estimate" for c in candidates)


def test_openai_provider_parses_strict_response_and_sources(monkeypatch):
    structured = {
        "identity": {
            "matched_name": "Domaine Example Reserve 2020",
            "confidence": 0.96,
            "explanation": "Exact match",
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
            "rationale": "",
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
        "summary": "No supported facts found.",
    }
    captured = {}

    def fake_transport(url, headers, payload, timeout):
        captured["payload"] = payload
        return ie.HttpResponse(
            200,
            {
                "output": [
                    {
                        "type": "web_search_call",
                        "action": {
                            "sources": [
                                {
                                    "url": "https://producer.example/wine",
                                    "title": "Producer",
                                }
                            ]
                        },
                    },
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": json.dumps(structured)}],
                    },
                ],
                "usage": {"total_tokens": 123},
            },
        )

    monkeypatch.setattr(config, "OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(config, "OPENAI_BASE_URL", "https://api.openai.com/v1")
    monkeypatch.setattr(config, "OPENAI_ENRICHMENT_MODEL", "test-model")
    monkeypatch.setattr(config, "ENRICHMENT_ALLOWED_DOMAINS", [])
    monkeypatch.setattr(config, "ENRICHMENT_SEARCH_CONTEXT_SIZE", "low")
    monkeypatch.setattr(config, "ENRICHMENT_TIMEOUT_SECONDS", 10)

    provider = ie.OpenAIResearchProvider(transport=fake_transport)
    parsed, sources, usage, _raw = provider.research(_wine(), ["drinking_window"], "en")
    assert parsed["identity"]["confidence"] == 0.96
    assert sources[0]["url"] == "https://producer.example/wine"
    assert usage["total_tokens"] == 123
    assert captured["payload"]["tools"] == [{"type": "web_search", "search_context_size": "low"}]
    assert captured["payload"]["text"]["format"]["strict"] is True
    assert captured["payload"]["tool_choice"] == "required"


def test_repository_and_candidate_acceptance_update_wine():
    db = Database(":memory:")
    conn = db.connect()
    wine = _wine()
    user = User(
        id=new_id(),
        username="alice",
        password_hash="hash",
        password_salt="salt",
    )
    repo.insert_user(conn, user)
    repo.insert_wine(conn, wine)
    job = er.create_job(
        conn,
        job_id=new_id(),
        wine_id=wine.id,
        user_id=user.id,
        provider="test",
        topics=["drinking_window"],
        locale="en",
        auto_apply=False,
        model="test",
    )
    candidate_id = new_id()
    er.insert_candidate(
        conn,
        candidate_id=candidate_id,
        job_id=job["id"],
        wine_id=wine.id,
        topic="drinking_window",
        label="drinking_window",
        value={"drink_after_year": 2026, "drink_before_year": 2034},
        confidence=0.84,
        method="source_consensus",
        rationale="two sources",
        source_ids=[],
    )
    ie.apply_candidate(
        conn,
        candidate_id=candidate_id,
        user_id=user.id,
    )
    conn.commit()
    updated = repo.get_wine(conn, wine.id)
    assert updated.drink_after == date(2026, 1, 1)
    assert updated.drink_before == date(2034, 12, 31)
    assert er.get_candidate(conn, candidate_id)["status"] == "accepted"
    assert er.get_profile(conn, wine.id)["profile"]


def test_source_urls_reject_non_web_and_private_targets():
    assert ie.normalise_public_source_url("javascript:alert(1)") is None
    assert ie.normalise_public_source_url("http://127.0.0.1/admin") is None
    assert ie.normalise_public_source_url("http://localhost/private") is None
    assert (
        ie.normalise_public_source_url("https://producer.example/wine")
        == "https://producer.example/wine"
    )


def test_accepted_manual_values_need_explicit_force():
    db = Database(":memory:")
    conn = db.connect()
    wine = _wine()
    wine.market_value = 12.0
    user = User(
        id=new_id(),
        username="alice",
        password_hash="hash",
        password_salt="salt",
    )
    repo.insert_user(conn, user)
    repo.insert_wine(conn, wine)
    job = er.create_job(
        conn,
        job_id=new_id(),
        wine_id=wine.id,
        user_id=user.id,
        provider="test",
        topics=["market_value"],
        locale="en",
        auto_apply=False,
        model="test",
    )
    candidate_id = new_id()
    er.insert_candidate(
        conn,
        candidate_id=candidate_id,
        job_id=job["id"],
        wine_id=wine.id,
        topic="market_value",
        label="replacement_value",
        value={"amount": 25.0, "currency": "EUR"},
        confidence=0.9,
        method="median_exact_listings",
        rationale="three sources",
        source_ids=[],
    )
    ie.apply_candidate(conn, candidate_id=candidate_id, user_id=user.id, force=False)
    assert repo.get_wine(conn, wine.id).market_value == 12.0


def test_market_engine_rejects_non_exact_vintage_even_if_price_looks_plausible():
    wine = _wine()
    observations = [
        {
            "amount": 25,
            "currency": "EUR",
            "offer_type": "retail",
            "bottle_count": 1,
            "format_ml": 750,
            "in_stock": True,
            "source_url": "https://merchant.example/other-vintage",
            "source_type": "merchant",
            "exact_producer": True,
            "exact_cuvee": True,
            "exact_vintage": False,
            "exact_format": True,
        }
    ]
    assert ie._market_candidates(observations, wine, 0.95) == []


def test_model_cannot_manufacture_an_evidence_url():
    db = Database(":memory:")
    conn = db.connect()
    wine = _wine()
    user = User(
        id=new_id(),
        username="alice",
        password_hash="hash",
        password_salt="salt",
    )
    repo.insert_user(conn, user)
    repo.insert_wine(conn, wine)
    job = er.create_job(
        conn,
        job_id=new_id(),
        wine_id=wine.id,
        user_id=user.id,
        provider="test",
        topics=["drinking_window"],
        locale="en",
        auto_apply=False,
        model="test",
    )
    parsed = {
        "identity": {"confidence": 0.95},
        "drinking_windows": [
            {
                "source_url": "https://invented.example/fake",
                "source_type": "producer",
                "published_at": None,
                "exact_producer": True,
                "exact_cuvee": True,
                "exact_vintage": True,
                "exact_format": True,
            }
        ],
        "market_observations": [],
        "pairings": [],
        "serving": {"source_urls": []},
        "composition": {"source_urls": []},
        "reviews": [],
        "external_identifiers": [],
    }
    mapping = ie._persist_sources(
        conn,
        job["id"],
        parsed,
        [{"url": "https://producer.example/real", "title": "Real source"}],
    )
    assert set(mapping) == {"https://producer.example/real"}
    assert parsed["drinking_windows"][0]["source_url"] == ""


def test_automatic_pairing_acceptance_preserves_manual_advice():
    db = Database(":memory:")
    conn = db.connect()
    wine = _wine()
    wine.advice_pairing = "Family recipe"
    user = User(
        id=new_id(),
        username="alice",
        password_hash="hash",
        password_salt="salt",
    )
    repo.insert_user(conn, user)
    repo.insert_wine(conn, wine)
    job = er.create_job(
        conn,
        job_id=new_id(),
        wine_id=wine.id,
        user_id=user.id,
        provider="test",
        topics=["pairing"],
        locale="en",
        auto_apply=True,
        model="test",
    )
    candidate_id = new_id()
    er.insert_candidate(
        conn,
        candidate_id=candidate_id,
        job_id=job["id"],
        wine_id=wine.id,
        topic="pairing",
        label="dish_pairings",
        value=[{"dish": "Roast lamb"}],
        confidence=0.95,
        method="source_backed",
        rationale="producer source",
        source_ids=[],
    )
    ie.apply_candidate(conn, candidate_id=candidate_id, user_id=user.id, force=False)
    assert repo.get_wine(conn, wine.id).advice_pairing == "Family recipe"
    assert er.get_profile(conn, wine.id)["profile"]["pairing:dish_pairings"]
