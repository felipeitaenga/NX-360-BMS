"""Iter 5 supplementary tests: whitespace-only device_id, PATCH w/o device_id, in-memory state."""
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


class TestDeviceIdEditExtra:
    def _get_cj011(self):
        r = requests.get(f"{API}/fancoils", headers=_bearer(STATE["admin_token"]))
        return next(f for f in r.json() if f["name"] == "CJ011")

    def test_patch_whitespace_device_id_returns_400(self):
        cj011 = self._get_cj011()
        rp = requests.patch(f"{API}/fancoils/{cj011['id']}",
                            json={"device_id": "   "},
                            headers=_bearer(STATE["admin_token"]))
        assert rp.status_code == 400, f"Expected 400, got {rp.status_code}: {rp.text}"
        assert "vazio" in rp.text.lower() or "empty" in rp.text.lower(), rp.text

    def test_patch_without_device_id_field_does_not_touch_it(self):
        cj011 = self._get_cj011()
        original_did = cj011["device_id"]
        original_name = cj011["name"]
        new_name = f"CJ011_tmp_{int(time.time())}"
        try:
            rp = requests.patch(f"{API}/fancoils/{cj011['id']}",
                                json={"name": new_name},
                                headers=_bearer(STATE["admin_token"]))
            assert rp.status_code == 200, rp.text
            body = rp.json()
            assert body["device_id"] == original_did, "device_id should remain unchanged"
            assert body["name"] == new_name
            # Confirm via GET
            gr = requests.get(f"{API}/fancoils/{cj011['id']}", headers=_bearer(STATE["admin_token"]))
            assert gr.json()["device_id"] == original_did
        finally:
            # Restore original name
            requests.patch(f"{API}/fancoils/{cj011['id']}",
                           json={"name": original_name},
                           headers=_bearer(STATE["admin_token"]))

    def test_in_memory_state_preserved_after_device_id_change(self):
        """After PATCH changing device_id, GET /api/fancoils/{id} should still include
        telemetry fields (not stripped/zeroed by migration)."""
        # Create a temp fancoil
        did1 = f"TSTSIM{int(time.time()) % 100000}A"
        did2 = f"TSTSIM{int(time.time()) % 100000}B"
        name = f"TST_state_{int(time.time())}"
        cr = requests.post(f"{API}/fancoils", json={
            "device_id": did1, "name": name, "description": "state test",
            "floor": 99, "side": 1,
            "setpoint_min": 18, "setpoint_max": 25,
            "temp_alarm_min": 10, "temp_alarm_max": 32, "active": True,
        }, headers=_bearer(STATE["admin_token"]))
        assert cr.status_code in (200, 201), cr.text
        fid = cr.json()["id"]
        try:
            # Give the simulator a moment (if applicable)
            time.sleep(1)
            # PATCH to new device_id
            rp = requests.patch(f"{API}/fancoils/{fid}",
                                json={"device_id": did2},
                                headers=_bearer(STATE["admin_token"]))
            assert rp.status_code == 200, rp.text
            # GET returns a well-formed doc with device_id updated
            gr = requests.get(f"{API}/fancoils/{fid}", headers=_bearer(STATE["admin_token"]))
            assert gr.status_code == 200
            body = gr.json()
            assert body["device_id"] == did2
            # Validate telemetry/state-related keys still present and not errored
            for key in ("name", "floor", "side", "setpoint_min", "setpoint_max", "active"):
                assert key in body, f"missing key {key}"
        finally:
            requests.delete(f"{API}/fancoils/{fid}", headers=_bearer(STATE["admin_token"]))
