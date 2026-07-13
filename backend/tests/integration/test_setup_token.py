"""Regression tests for protected first-account registration."""

from app import config


def test_first_registration_requires_configured_setup_token(client, monkeypatch):
    monkeypatch.setattr(config, "SETUP_TOKEN", "expected-setup-token")

    payload = {
        "username": "alice",
        "password": "correct horse battery staple",
    }

    missing = client.post("/auth/register", json=payload)
    assert missing.status_code == 403
    assert missing.json()["detail"] == "auth.invalid_setup_token"

    wrong = client.post(
        "/auth/register",
        json={**payload, "setup_token": "wrong-token"},
    )
    assert wrong.status_code == 403

    correct = client.post(
        "/auth/register",
        json={**payload, "setup_token": "expected-setup-token"},
    )
    assert correct.status_code == 200
    assert "access_token" in correct.json()
