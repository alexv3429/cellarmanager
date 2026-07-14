from __future__ import annotations

from copy import deepcopy

import pytest

from app.services import internet_enrichment as research


def _candidate(topic: str, value):
    return {
        "id": "candidate-1",
        "job_id": "job-1",
        "wine_id": "wine-1",
        "topic": topic,
        "label": "test candidate",
        "value": value,
        "confidence": 0.69,
        "method": "manual_chatgpt+unverified_manual",
        "rationale": "Imported for review.",
        "source_ids": ["source-1"],
        "status": "proposed",
    }


def test_candidate_edit_accepts_corrected_drinking_window() -> None:
    candidate = _candidate(
        "drinking_window",
        {
            "drink_after_year": 2024,
            "drink_before_year": 2038,
            "observation_count": 2,
        },
    )
    edited = deepcopy(candidate["value"])
    edited["drink_before_year"] = 2035

    result = research._validate_candidate_edit(candidate, edited)

    assert result["drink_before_year"] == 2035


def test_candidate_edit_cannot_add_evidence_urls() -> None:
    candidate = _candidate(
        "pairing",
        [
            {
                "dish": "Roast chicken",
                "rationale": "Published pairing.",
                "avoid": [],
                "source_url": "https://example.com/original",
            }
        ],
    )
    edited = deepcopy(candidate["value"])
    edited[0]["source_url"] = "https://example.com/new"

    with pytest.raises(ValueError, match="cannot add evidence URLs"):
        research._validate_candidate_edit(candidate, edited)


def test_candidate_edit_rejects_non_proposed_candidate() -> None:
    candidate = _candidate(
        "drinking_window",
        {"drink_after_year": 2024, "drink_before_year": 2038},
    )
    candidate["status"] = "accepted"

    with pytest.raises(ValueError, match="Only proposed candidates"):
        research._validate_candidate_edit(candidate, candidate["value"])


def test_edit_candidate_preserves_confidence_and_audits_change(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    candidate = _candidate(
        "drinking_window",
        {"drink_after_year": 2024, "drink_before_year": 2038},
    )
    updated = {}
    movements = []

    monkeypatch.setattr(research.er, "get_candidate", lambda _conn, _id: candidate)

    def update_candidate_value(_conn, _id, **fields):
        updated.update(fields)
        candidate["value"] = fields["value"]
        candidate["method"] = fields["method"]
        candidate["rationale"] = fields["rationale"]

    monkeypatch.setattr(research.er, "update_candidate_value", update_candidate_value)
    monkeypatch.setattr(
        research.repo, "insert_movement", lambda _conn, item: movements.append(item)
    )

    result = research.edit_candidate(
        object(),
        candidate_id="candidate-1",
        user_id="user-1",
        value={"drink_after_year": 2025, "drink_before_year": 2036},
    )

    assert result["confidence"] == 0.69
    assert updated["value"]["drink_after_year"] == 2025
    assert updated["method"].endswith("+user_edit")
    assert len(movements) == 1
