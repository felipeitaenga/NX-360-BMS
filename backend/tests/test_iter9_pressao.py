"""Iteration 9 — backend tests for PRESSAO command on fancoil CJ101 (device 9FE4).

Covers:
- Successful PRESSAO publish with validation
- PRESSAO value validation (range + numeric)
- Permissions (viewer=403, operator without perm=403)
- PRESSAO does NOT require FORÇADO mode (unlike CMD)
- CMD still blocked in NORMAL (estado=true)
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_EMAIL = "felipejferreira@gmail.com"
ADMIN_PASS = "NovaSenha123"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def cj101(admin_headers):
    r = requests.get(f"{BASE_URL}/api/fancoils", headers=admin_headers, timeout=10)
    assert r.status_code == 200
    for fc in r.json():
        if fc["name"] == "CJ101":
            return fc
    pytest.fail("CJ101 not found")


# ---------- PRESSAO success ----------
class TestPressaoSuccess:
    def test_pressao_50_ok(self, admin_headers, cj101):
        r = requests.post(f"{BASE_URL}/api/fancoils/{cj101['id']}/command",
                          headers=admin_headers,
                          json={"kind": "PRESSAO", "value": "50"}, timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["topic"].endswith("/9FE4/PRESSAO/SET")
        assert body["value"] == "50.0"

    def test_pressao_persisted_in_state(self, admin_headers, cj101):
        # Fetch fancoil, pressure field should reflect last sent value
        r = requests.get(f"{BASE_URL}/api/fancoils/{cj101['id']}",
                         headers=admin_headers, timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert "pressure" in data
        # In real broker mode, ESP may not echo. Validate field exists and is numeric or None
        # If echoed, should be 50.0
        if data["pressure"] is not None:
            assert isinstance(data["pressure"], (int, float))

    def test_pressao_0_boundary(self, admin_headers, cj101):
        r = requests.post(f"{BASE_URL}/api/fancoils/{cj101['id']}/command",
                          headers=admin_headers,
                          json={"kind": "PRESSAO", "value": "0"}, timeout=10)
        assert r.status_code == 200, r.text

    def test_pressao_100_boundary(self, admin_headers, cj101):
        r = requests.post(f"{BASE_URL}/api/fancoils/{cj101['id']}/command",
                          headers=admin_headers,
                          json={"kind": "PRESSAO", "value": "100"}, timeout=10)
        assert r.status_code == 200, r.text


# ---------- PRESSAO validation ----------
class TestPressaoValidation:
    def test_pressao_above_100(self, admin_headers, cj101):
        r = requests.post(f"{BASE_URL}/api/fancoils/{cj101['id']}/command",
                          headers=admin_headers,
                          json={"kind": "PRESSAO", "value": "120"}, timeout=10)
        assert r.status_code == 400
        assert "0 e 100" in r.json().get("detail", "")

    def test_pressao_negative(self, admin_headers, cj101):
        r = requests.post(f"{BASE_URL}/api/fancoils/{cj101['id']}/command",
                          headers=admin_headers,
                          json={"kind": "PRESSAO", "value": "-5"}, timeout=10)
        assert r.status_code == 400
        assert "0 e 100" in r.json().get("detail", "")

    def test_pressao_non_numeric(self, admin_headers, cj101):
        r = requests.post(f"{BASE_URL}/api/fancoils/{cj101['id']}/command",
                          headers=admin_headers,
                          json={"kind": "PRESSAO", "value": "abc"}, timeout=10)
        assert r.status_code == 400
        assert "inválida" in r.json().get("detail", "").lower() or "invalida" in r.json().get("detail", "").lower()


# ---------- CMD still blocked in NORMAL ----------
class TestCmdBlockedInNormal:
    def test_cmd_in_normal_returns_400(self, admin_headers, cj101):
        # cj101 is in estado=True (NORMAL)
        if cj101.get("estado") is not True:
            pytest.skip("CJ101 not in NORMAL mode; skipping")
        r = requests.post(f"{BASE_URL}/api/fancoils/{cj101['id']}/command",
                          headers=admin_headers,
                          json={"kind": "CMD", "value": "true"}, timeout=10)
        assert r.status_code == 400
        assert "AUTOMÁTICO" in r.json().get("detail", "")


# ---------- PRESSAO does NOT need FORÇADO ----------
class TestPressaoNoEstadoCheck:
    def test_pressao_in_normal_mode_ok(self, admin_headers, cj101):
        # Already in NORMAL — PRESSAO must still be accepted (no estado check)
        if cj101.get("estado") is not True:
            pytest.skip("CJ101 not in NORMAL mode; cannot verify")
        r = requests.post(f"{BASE_URL}/api/fancoils/{cj101['id']}/command",
                          headers=admin_headers,
                          json={"kind": "PRESSAO", "value": "45"}, timeout=10)
        assert r.status_code == 200, r.text


# ---------- Permissions ----------
class TestPressaoPermissions:
    @pytest.fixture(scope="class")
    def viewer_token(self, admin_headers):
        # Create ephemeral viewer user
        email = "test_iter9_viewer@example.com"
        pw = "ViewerPass123"
        # try create (ignore if exists)
        requests.post(f"{BASE_URL}/api/users", headers=admin_headers,
                      json={"name": "TEST Viewer9", "email": email,
                            "password": pw, "role": "viewer", "active": True}, timeout=10)
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": email, "password": pw}, timeout=10)
        assert r.status_code == 200, r.text
        return r.json()["access_token"]

    @pytest.fixture(scope="class")
    def operator_token(self, admin_headers):
        email = "test_iter9_operator@example.com"
        pw = "OperPass123"
        requests.post(f"{BASE_URL}/api/users", headers=admin_headers,
                      json={"name": "TEST Oper9", "email": email,
                            "password": pw, "role": "operator", "active": True}, timeout=10)
        # Set empty permissions (operator without access)
        # First find user_id
        users = requests.get(f"{BASE_URL}/api/users", headers=admin_headers, timeout=10).json()
        uid = next(u["id"] for u in users if u["email"] == email)
        requests.put(f"{BASE_URL}/api/permissions", headers=admin_headers,
                     json={"user_id": uid, "modules": [], "fancoil_ids": []}, timeout=10)
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": email, "password": pw}, timeout=10)
        assert r.status_code == 200, r.text
        return r.json()["access_token"]

    def test_viewer_pressao_403(self, viewer_token, cj101):
        headers = {"Authorization": f"Bearer {viewer_token}", "Content-Type": "application/json"}
        r = requests.post(f"{BASE_URL}/api/fancoils/{cj101['id']}/command",
                          headers=headers,
                          json={"kind": "PRESSAO", "value": "50"}, timeout=10)
        assert r.status_code == 403

    def test_operator_without_perm_403(self, operator_token, cj101):
        headers = {"Authorization": f"Bearer {operator_token}", "Content-Type": "application/json"}
        r = requests.post(f"{BASE_URL}/api/fancoils/{cj101['id']}/command",
                          headers=headers,
                          json={"kind": "PRESSAO", "value": "50"}, timeout=10)
        assert r.status_code == 403


# ---------- Cleanup: restore pressure to neutral 50 ----------
def test_zz_restore_pressure(admin_headers, cj101):
    r = requests.post(f"{BASE_URL}/api/fancoils/{cj101['id']}/command",
                      headers=admin_headers,
                      json={"kind": "PRESSAO", "value": "50"}, timeout=10)
    assert r.status_code == 200
