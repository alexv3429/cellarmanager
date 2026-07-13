"""Pytest fixtures for the HTTP-level ('system') integration tests in
tests/integration/test_api.py. Requires the packages in requirements-dev.txt
to be installed (fastapi, httpx) - the unittest-style tests elsewhere in this
suite deliberately do not depend on this file so they run with zero installs.
"""

import os
import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("WINECELLAR_SECRET_KEY", "test-secret-key-not-for-production-use")


@pytest.fixture()
def test_db():
    from app.storage.database import Database

    db = Database(":memory:")
    yield db
    db.close_all()


@pytest.fixture()
def client(test_db):
    from fastapi.testclient import TestClient

    from app.api import deps
    from app.api.main import app

    def override_get_conn():
        yield test_db.connect()

    app.dependency_overrides[deps.get_conn] = override_get_conn
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def auth_headers(client):
    from app import config

    payload = {
        "username": "alice",
        "password": "correct horse battery staple",
    }

    # CI deliberately enables bootstrap-token protection. Keep the fixture
    # compatible with both protected CI and local development without a token.
    if config.SETUP_TOKEN:
        payload["setup_token"] = config.SETUP_TOKEN

    resp = client.post("/auth/register", json=payload)
    assert resp.status_code == 200, resp.text

    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
