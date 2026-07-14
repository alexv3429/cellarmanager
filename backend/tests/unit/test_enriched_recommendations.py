from app.core.domain import Holding, Wine, new_id
from app.services.recommendation_service import (
    RecommendationCriteria,
    recommend_wines,
)


def _pair(producer: str, *, value: float | None = None, quantity: int = 1):
    wine = Wine(
        id=new_id(),
        producer=producer,
        color="red",
        market_value=value,
    )
    holding = Holding(
        id=new_id(),
        wine_id=wine.id,
        cellar_id="service",
        quantity=quantity,
        state="in_cellar",
    )
    return holding, wine


def test_casual_is_a_ranking_signal_not_a_hard_text_filter():
    pair = _pair("Everyday producer", value=18, quantity=3)
    results = recommend_wines(
        [pair],
        RecommendationCriteria(cellar_id="service", color="red", mood="casual"),
    )
    assert len(results) == 1
    assert results[0].score > 0
    assert any("informal" in reason for reason in results[0].reasons)


def test_accepted_pairing_profile_improves_dish_rank():
    lamb = _pair("Lamb match")
    other = _pair("Other")
    profiles = {
        lamb[1].id: {
            "pairing:dish_pairings": {
                "value": [
                    {
                        "dish": "roast lamb",
                        "category": "meat",
                        "rationale": "tannin and savoury character",
                    }
                ]
            }
        }
    }
    results = recommend_wines(
        [other, lamb],
        RecommendationCriteria(dish="lamb"),
        enrichment_profiles=profiles,
    )
    assert results[0].wine.id == lamb[1].id
    assert results[0].score > results[1].score


def test_strict_dish_mode_can_still_be_requested_explicitly():
    pair = _pair("No pairing")
    results = recommend_wines(
        [pair],
        RecommendationCriteria(dish="lobster", strict_text_match=True),
    )
    assert results == []


def test_strict_checkbox_applies_to_dish_not_to_occasion():
    pair = _pair("No literal casual note", value=20, quantity=2)
    results = recommend_wines(
        [pair],
        RecommendationCriteria(mood="casual", strict_text_match=True),
    )
    assert len(results) == 1


def test_diagnostics_explain_hard_filter_rejections():
    red = _pair("Red")
    diagnostics = {}
    results = recommend_wines(
        [red],
        RecommendationCriteria(color="white"),
        diagnostics=diagnostics,
    )
    assert results == []
    assert diagnostics == {
        "examined": 1,
        "eligible": 0,
        "returned": 0,
        "rejected_inactive": 0,
        "rejected_cellar": 0,
        "rejected_color": 1,
        "rejected_vintage": 0,
        "rejected_appellation": 0,
        "rejected_drinking_window": 0,
        "rejected_strict_dish": 0,
    }
