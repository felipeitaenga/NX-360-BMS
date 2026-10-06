"""Regression tests for cj21 restricted operator permissions fix.

Covers:
- /api/fancoils returns only authorized fancoil for cj21
- /api/lighting/* returns 403 for cj21
- /api/fancoils/{other_id} and command returns 403
- admin keeps full access
"""
import os
import pytest
import requests

def _load_backend_url():
    url = os.environ.get("REACT_APP_BACKEND_URL")
    if not url:
        try:
            with open("/app/frontend/.env") as f:
                for line in f:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        url = line.split("=", 1)[1].strip()
                        break
        except Exception:
            pass
    if not url:
        raise RuntimeError("REACT_APP_BACKEND_URL not set")
    return url.rstrip("/")

BASE_URL = _load_backend_url()

ADMIN_EMAIL = "felipejferreira@gmail.com"
ADMIN_PASSWORD = "@Pilares1"

CJ21_EMAIL = "cj21@cj21.com"
CJ21_INITIAL_PASSWORD = "Cj21@2026"
CJ21_NEW_PASSWORD = "Cj21@2027!x"


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    return s, r


@pytest.fixture(scope="module")
def admin_session():
    s, r = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def cj21_session():
    """Login as cj21; if must_change_password, change it then re-login."""
    # Try initial password first
    s, r = _login(CJ21_EMAIL, CJ21_INITIAL_PASSWORD)
    if r.status_code == 200:
        data = r.json()
        if data.get("must_change_password"):
            # Change password
            ch = s.post(f"{BASE_URL}/api/auth/change-password", json={
                "current_password": CJ21_INITIAL_PASSWORD,
                "new_password": CJ21_NEW_PASSWORD,
            })
            assert ch.status_code == 200, f"change-password failed: {ch.status_code} {ch.text}"
            # re-login with new password
            s, r = _login(CJ21_EMAIL, CJ21_NEW_PASSWORD)
            assert r.status_code == 200
        return s
    # Maybe already changed
    s, r = _login(CJ21_EMAIL, CJ21_NEW_PASSWORD)
    assert r.status_code == 200, f"cj21 login failed with both passwords: {r.status_code} {r.text}"
    return s


# ------- Fancoils -------
def test_admin_sees_all_fancoils(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/fancoils")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    # Admin should see all. From test credentials there are 15 active CJ fancoils,
    # but DB may contain extras. Assert >=15 and all authorized.
    assert len(data) >= 15, f"Admin should see at least 15 fancoils, saw {len(data)}"
    assert all(f.get("authorized") is True for f in data)


def test_cj21_sees_only_cj021(cj21_session):
    r = cj21_session.get(f"{BASE_URL}/api/fancoils")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) == 1, f"cj21 should see only 1 fancoil, saw {len(data)}: {[f.get('nome') for f in data]}"
    # Verify it's the authorized one (CJ021)
    nome = data[0].get("nome") or data[0].get("name") or ""
    assert "CJ021" in nome or "021" in nome, f"Expected CJ021, got {data[0]}"
    assert data[0].get("authorized") is True


def test_cj21_cannot_access_other_fancoil(admin_session, cj21_session):
    # Pick a fancoil that is not CJ021
    r = admin_session.get(f"{BASE_URL}/api/fancoils")
    all_fancoils = r.json()
    other = next(f for f in all_fancoils if "CJ021" not in (f.get("nome") or ""))
    other_id = other["id"]

    # GET
    r = cj21_session.get(f"{BASE_URL}/api/fancoils/{other_id}")
    assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"

    # Command
    r = cj21_session.post(f"{BASE_URL}/api/fancoils/{other_id}/command",
                          json={"kind": "ESTADO", "value": "true"})
    assert r.status_code == 403, f"Expected 403 on command, got {r.status_code}: {r.text}"


# ------- Lighting -------
@pytest.mark.parametrize("path", [
    "/api/lighting/pavimentos",
    "/api/lighting/snapshot",
    "/api/lighting/overview",
    "/api/lighting/controladoras",
    "/api/lighting/pontos",
])
def test_cj21_lighting_endpoints_403(cj21_session, path):
    r = cj21_session.get(f"{BASE_URL}{path}")
    assert r.status_code == 403, f"{path} expected 403, got {r.status_code}: {r.text}"


@pytest.mark.parametrize("path", [
    "/api/lighting/pavimentos",
    "/api/lighting/snapshot",
    "/api/lighting/overview",
    "/api/lighting/controladoras",
])
def test_admin_lighting_endpoints_ok(admin_session, path):
    r = admin_session.get(f"{BASE_URL}{path}")
    assert r.status_code == 200, f"{path} expected 200 for admin, got {r.status_code}: {r.text}"


# ------- /me sanity -------
def test_cj21_me_has_operator_role(cj21_session):
    r = cj21_session.get(f"{BASE_URL}/api/auth/me")
    assert r.status_code == 200
    data = r.json()
    user = data.get("user", data)
    assert user.get("role") == "operator"
