"""Backend tests for the Lighting module (/api/lighting/*)."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fall back by reading frontend .env for test runs outside the preview container
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                    break
    except Exception:
        pass

ADMIN_EMAIL = "felipejferreira@gmail.com"
ADMIN_PASS = "@Pilares1"


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
               timeout=10)
    assert r.status_code == 200, r.text
    token = r.json().get("access_token")
    assert token
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


# ---- Overview ----
class TestOverview:
    def test_overview_shape(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/lighting/overview")
        assert r.status_code == 200, r.text
        data = r.json()
        for key in ("pavimentos", "controladoras_total", "controladoras_online", "circuitos_ligados"):
            assert key in data
        assert isinstance(data["pavimentos"], list)
        if data["pavimentos"]:
            p0 = data["pavimentos"][0]
            for k in ("id", "nome", "pontos_total", "pontos_acesos"):
                assert k in p0

    def test_snapshot(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/lighting/snapshot")
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---- Pavimentos CRUD ----
class TestPavimentos:
    created_id = None

    def test_create_pavimento(self, admin_session):
        r = admin_session.post(f"{BASE_URL}/api/lighting/pavimentos",
                               json={"nome": "TEST_pav_iter16", "ordem": 99})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["nome"] == "TEST_pav_iter16"
        assert "id" in data
        TestPavimentos.created_id = data["id"]

    def test_list_pavimentos_contains_created(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/lighting/pavimentos")
        assert r.status_code == 200
        ids = [p["id"] for p in r.json()]
        assert TestPavimentos.created_id in ids

    def test_patch_pavimento(self, admin_session):
        r = admin_session.patch(f"{BASE_URL}/api/lighting/pavimentos/{TestPavimentos.created_id}",
                                json={"nome": "TEST_pav_iter16_edit"})
        assert r.status_code == 200
        assert r.json()["nome"] == "TEST_pav_iter16_edit"

    def test_delete_pavimento(self, admin_session):
        r = admin_session.delete(f"{BASE_URL}/api/lighting/pavimentos/{TestPavimentos.created_id}")
        assert r.status_code == 200
        # subsequent delete -> 404
        r2 = admin_session.delete(f"{BASE_URL}/api/lighting/pavimentos/{TestPavimentos.created_id}")
        assert r2.status_code == 404


# ---- Controladoras ----
class TestControladoras:
    def test_list_controladoras(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/lighting/controladoras")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        test_items = [c for c in data if c["mqtt_id"] == "TEST"]
        assert test_items, "Controladora TEST deveria existir conforme contexto"
        c = test_items[0]
        assert len(c["circuitos"]) == 16
        assert c["circuitos"][0]["numero"] == 1

    def test_descobertas_endpoint(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/lighting/controladoras/descobertas")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_controladora_validation(self, admin_session):
        # invalid id
        r = admin_session.post(f"{BASE_URL}/api/lighting/controladoras",
                               json={"mqtt_id": "zz", "nome": "x"})
        assert r.status_code == 400
        # duplicate TEST
        r = admin_session.post(f"{BASE_URL}/api/lighting/controladoras",
                               json={"mqtt_id": "TEST", "nome": "dup"})
        assert r.status_code == 400

    def test_crud_controladora(self, admin_session):
        r = admin_session.post(f"{BASE_URL}/api/lighting/controladoras",
                               json={"mqtt_id": "TST2", "nome": "TEST_ctrl", "local": "lab"})
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        # rename circuit 1
        r2 = admin_session.patch(f"{BASE_URL}/api/lighting/controladoras/{cid}/circuitos",
                                 json={"numero": 1, "nome_circuito": "Cozinha"})
        assert r2.status_code == 200
        assert r2.json()["circuitos"][0]["nome_circuito"] == "Cozinha"
        # delete
        r3 = admin_session.delete(f"{BASE_URL}/api/lighting/controladoras/{cid}")
        assert r3.status_code == 200


# ---- Pontos + comando ----
class TestPontosComando:
    def test_list_pontos(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/lighting/pontos")
        assert r.status_code == 200
        pontos = r.json()
        assert isinstance(pontos, list)
        # context says 2 points exist in Térreo on L01
        assert len(pontos) >= 2

    def test_overview_has_terreo(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/lighting/overview")
        pavs = r.json()["pavimentos"]
        terreo = [p for p in pavs if "rreo" in p["nome"].lower() or "erreo" in p["nome"].lower()]
        assert terreo, f"Pavimento Térreo não encontrado: {[p['nome'] for p in pavs]}"
        assert terreo[0]["pontos_total"] >= 2

    def test_cmd_circuito_toggle(self, admin_session):
        # Find TEST controller id
        r = admin_session.get(f"{BASE_URL}/api/lighting/controladoras")
        test_ctrl = next(c for c in r.json() if c["mqtt_id"] == "TEST")
        cid = test_ctrl["id"]
        # Issue TOGGLE on L01 - may fail if offline. Context says TEST retained message was sent.
        rr = admin_session.post(
            f"{BASE_URL}/api/lighting/controladoras/{cid}/circuitos/1/comando",
            json={"value": "TOGGLE"},
        )
        # 200 if online, 400 "Controladora offline" otherwise.
        assert rr.status_code in (200, 400), rr.text
        if rr.status_code == 200:
            body = rr.json()
            assert body["topic"].endswith("/TEST/L01/SET")
            assert body["retain"] is False


# ---- Eventos ----
class TestEventos:
    def test_eventos(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/lighting/eventos?limit=10")
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---- Auth guard ----
class TestAuth:
    def test_unauth_blocked(self):
        r = requests.get(f"{BASE_URL}/api/lighting/overview", timeout=10)
        assert r.status_code in (401, 403)
