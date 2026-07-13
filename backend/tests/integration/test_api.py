"""System tests through the real HTTP API, using FastAPI's TestClient.

Run with:  pip install -r requirements-dev.txt && pytest tests/integration/test_api.py

This mirrors tests/integration/test_end_to_end_flows.py but exercises the
actual HTTP layer (routing, auth, request/response validation, status
codes) rather than calling the service layer directly. These need
fastapi/httpx installed, so they run in CI (see .github/workflows/ci.yml)
and in your local dev environment, not inside a network-restricted sandbox.
"""

import io


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_endpoints_require_auth(client):
    resp = client.get("/wines")
    assert resp.status_code == 401


def test_registration_closes_after_first_user(client, auth_headers):
    resp = client.post(
        "/auth/register", json={"username": "bob", "password": "another-strong-password"}
    )
    assert resp.status_code == 403


def test_login_wrong_password_rejected(client, auth_headers):
    resp = client.post("/auth/login", json={"username": "alice", "password": "wrong"})
    assert resp.status_code == 401


def test_login_correct_password_succeeds(client, auth_headers):
    resp = client.post(
        "/auth/login", json={"username": "alice", "password": "correct horse battery staple"}
    )
    assert resp.status_code == 200
    assert "access_token" in resp.json()


def test_create_cellar_and_list(client, auth_headers):
    resp = client.post(
        "/cellars",
        headers=auth_headers,
        json={
            "name": "Cave Nord",
            "purpose_level": 2,
            "max_capacity": 100,
            "threshold": 90,
            "location_rule": "AG",
        },
    )
    assert resp.status_code == 201, resp.text
    cellar = resp.json()
    assert cellar["current_fill"] == 0

    resp = client.get("/cellars", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_duplicate_cellar_name_rejected(client, auth_headers):
    payload = {"name": "Cave", "max_capacity": 10, "threshold": 8}
    assert client.post("/cellars", headers=auth_headers, json=payload).status_code == 201
    resp = client.post("/cellars", headers=auth_headers, json=payload)
    assert resp.status_code == 409


def test_csv_import_then_stats_and_export(client, auth_headers):
    client.post(
        "/cellars",
        headers=auth_headers,
        json={"name": "Cave Nord", "max_capacity": 200, "threshold": 180},
    )

    csv_content = (
        b"Producer,Cuvee,Appellation,Vintage,Color,Area,Format,Quantity,Price bought,Cellar,Location\n"
        b"Domaine Jean-Marc Burgaud,James,Cote du Py,2020,red,Beaujolais,75cl,6,18.50,Cave Nord,A1\n"
    )
    files = {"file": ("cellar.csv", io.BytesIO(csv_content), "text/csv")}
    resp = client.post("/import", headers=auth_headers, files=files)
    assert resp.status_code == 200, resp.text
    report = resp.json()
    assert report["imported"] == 1
    assert report["warnings"] == []

    resp = client.get("/wines", headers=auth_headers)
    assert len(resp.json()) == 1
    wine_id = resp.json()[0]["id"]

    resp = client.get("/stats", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["overall"]["total_bottles"] == 6

    resp = client.get(f"/wines/{wine_id}/locations", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()[0]["quantity"] == 6

    resp = client.post(
        "/export",
        headers=auth_headers,
        json={"columns": ["producer", "quantity"], "language": "en"},
    )
    assert resp.status_code == 200
    assert "Domaine Jean-Marc Burgaud" in resp.text


def test_add_move_remove_bottle_flow(client, auth_headers):
    c1 = client.post(
        "/cellars", headers=auth_headers, json={"name": "A", "max_capacity": 100, "threshold": 90}
    ).json()
    c2 = client.post(
        "/cellars", headers=auth_headers, json={"name": "B", "max_capacity": 100, "threshold": 90}
    ).json()
    wine = client.post(
        "/wines", headers=auth_headers, json={"producer": "Test Producer", "color": "red"}
    ).json()

    resp = client.post(
        "/holdings/add",
        headers=auth_headers,
        json={
            "wine_id": wine["id"],
            "cellar_id": c1["id"],
            "location": "A1",
            "quantity": 10,
        },
    )
    assert resp.status_code == 200
    holding_id = resp.json()["holding"]["id"]

    resp = client.post(
        "/holdings/move",
        headers=auth_headers,
        json={
            "holding_id": holding_id,
            "quantity": 4,
            "to_cellar_id": c2["id"],
            "to_location": "B1",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["holding"]["cellar_id"] == c2["id"]

    resp = client.post(
        "/holdings/remove",
        headers=auth_headers,
        json={
            "holding_id": holding_id,
            "quantity": 2,
            "reason": "drunk",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["holding"]["state"] == "drunk"


def test_moveplan_and_recommendations_endpoints_respond(client, auth_headers):
    client.post(
        "/cellars",
        headers=auth_headers,
        json={"name": "Aging", "purpose_level": 0, "max_capacity": 100, "threshold": 90},
    )
    resp = client.get("/moveplan", headers=auth_headers)
    assert resp.status_code == 200
    assert "steps" in resp.json()

    resp = client.post("/recommendations", headers=auth_headers, json={"color": "red"})
    assert resp.status_code == 200
    assert resp.json() == []  # no wines yet, but the endpoint must respond cleanly


def test_translations_endpoint(client):
    resp = client.get("/i18n/fr")
    assert resp.status_code == 200
    assert resp.json()["field.producer"] == "Producteur"
