"""Backend tests for Admin → Fancoil PATCH edit flow (iteration 3)."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "felipejferreira@gmail.com"
ADMIN_PWDS = ["NovaSenha123", "Admin@123"]

STATE = {}


def _bearer(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module", autouse=True)
def login_admin():
    for pwd in ADMIN_PWDS:
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": pwd})
        if r.status_code == 200:
            STATE["admin_token"] = r.json()["access_token"]
            return
    pytest.fail("Admin login failed")


@pytest.fixture(scope="module")
def target_fancoil():
    r = requests.get(f"{API}/fancoils", headers=_bearer(STATE["admin_token"]))
    assert r.status_code == 200
    fcs = r.json()
    cj011 = next((f for f in fcs if f["name"] == "CJ011"), None)
    assert cj011 is not None, "CJ011 fancoil not found"
    STATE["original"] = {
        "description": cj011.get("description", ""),
        "setpoint_min": cj011.get("setpoint_min"),
        "setpoint_max": cj011.get("setpoint_max"),
        "temp_alarm_min": cj011.get("temp_alarm_min"),
        "temp_alarm_max": cj011.get("temp_alarm_max"),
        "name": cj011.get("name"),
        "floor": cj011.get("floor"),
        "side": cj011.get("side"),
        "active": cj011.get("active", True),
    }
    return cj011


class TestFancoilPatch:
    def test_patch_partial_description(self, target_fancoil):
        fid = target_fancoil["id"]
        new_desc = f"TEST_desc_{int(time.time())}"
        r = requests.patch(f"{API}/fancoils/{fid}",
                           json={"description": new_desc},
                           headers=_bearer(STATE["admin_token"]))
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["description"] == new_desc
        # Verify via GET
        g = requests.get(f"{API}/fancoils/{fid}", headers=_bearer(STATE["admin_token"]))
        assert g.status_code == 200
        assert g.json()["description"] == new_desc

    def test_patch_full_payload(self, target_fancoil):
        fid = target_fancoil["id"]
        payload = {
            "name": target_fancoil["name"],
            "description": "TEST_full_desc",
            "floor": target_fancoil["floor"],
            "side": target_fancoil["side"],
            "setpoint_min": 17.0,
            "setpoint_max": 27.5,
            "temp_alarm_min": 14.0,
            "temp_alarm_max": 31.0,
            "active": True,
        }
        r = requests.patch(f"{API}/fancoils/{fid}", json=payload, headers=_bearer(STATE["admin_token"]))
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["setpoint_min"] == 17.0
        assert j["setpoint_max"] == 27.5
        assert j["temp_alarm_min"] == 14.0
        assert j["temp_alarm_max"] == 31.0
        # Verify GET
        g = requests.get(f"{API}/fancoils/{fid}", headers=_bearer(STATE["admin_token"])).json()
        assert g["setpoint_max"] == 27.5
        assert g["description"] == "TEST_full_desc"

    def test_patch_as_viewer_forbidden(self, target_fancoil):
        viewer_email = f"TEST_viewer_edit_{int(time.time())}@test.com"
        viewer_pwd = "ViewerPwd123"
        r = requests.post(f"{API}/users",
                          json={"name": "V Edit", "email": viewer_email, "password": viewer_pwd, "role": "viewer"},
                          headers=_bearer(STATE["admin_token"]))
        assert r.status_code in (200, 201)
        vid = r.json()["id"]
        try:
            # grant permission so viewer can even see the fancoil
            requests.put(f"{API}/permissions",
                         json={"user_id": vid, "modules": ["fancoils"], "fancoil_ids": [target_fancoil["id"]]},
                         headers=_bearer(STATE["admin_token"]))
            rl = requests.post(f"{API}/auth/login", json={"email": viewer_email, "password": viewer_pwd})
            vt = rl.json()["access_token"]
            rp = requests.patch(f"{API}/fancoils/{target_fancoil['id']}",
                                json={"description": "hack"},
                                headers=_bearer(vt))
            assert rp.status_code == 403
        finally:
            requests.delete(f"{API}/users/{vid}", headers=_bearer(STATE["admin_token"]))

    def test_patch_as_operator_forbidden(self, target_fancoil):
        op_email = f"TEST_op_edit_{int(time.time())}@test.com"
        op_pwd = "OpPwd123"
        r = requests.post(f"{API}/users",
                          json={"name": "Op Edit", "email": op_email, "password": op_pwd, "role": "operator"},
                          headers=_bearer(STATE["admin_token"]))
        assert r.status_code in (200, 201)
        oid = r.json()["id"]
        try:
            rl = requests.post(f"{API}/auth/login", json={"email": op_email, "password": op_pwd})
            ot = rl.json()["access_token"]
            rp = requests.patch(f"{API}/fancoils/{target_fancoil['id']}",
                                json={"description": "hack"},
                                headers=_bearer(ot))
            assert rp.status_code == 403
        finally:
            requests.delete(f"{API}/users/{oid}", headers=_bearer(STATE["admin_token"]))

    def test_zz_restore_original(self, target_fancoil):
        """Restore original description/setpoints so DB is left clean."""
        fid = target_fancoil["id"]
        orig = STATE["original"]
        r = requests.patch(f"{API}/fancoils/{fid}", json=orig, headers=_bearer(STATE["admin_token"]))
        assert r.status_code == 200
        g = requests.get(f"{API}/fancoils/{fid}", headers=_bearer(STATE["admin_token"])).json()
        assert g["description"] == orig["description"]
        assert g["setpoint_max"] == orig["setpoint_max"]
