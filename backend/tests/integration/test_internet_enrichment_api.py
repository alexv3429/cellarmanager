from app import config


def test_enrichment_status_and_unconfigured_error(client, auth_headers, monkeypatch):
    monkeypatch.setattr(config, "OPENAI_API_KEY", "")
    monkeypatch.setattr(config, "BRAVE_SEARCH_API_KEY", "")
    monkeypatch.setattr(config, "ENRICHMENT_PROVIDER", "openai_web")

    status = client.get("/enrichment/status", headers=auth_headers)
    assert status.status_code == 200
    assert status.json()["configured"] is False

    wine = client.post(
        "/wines",
        headers=auth_headers,
        json={"producer": "Example", "color": "red"},
    ).json()
    response = client.post(
        f"/wines/{wine['id']}/research",
        headers=auth_headers,
        json={"topics": ["drinking_window"], "background": False},
    )
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "enrichment_not_configured"
