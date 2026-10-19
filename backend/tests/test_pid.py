# PID speed control feature (iteration 20) — POST /api/devices/{id}/pid, ONLY on test fancoil CJ998/TESTPID1
import os
import subprocess
import threading
import time

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
FID = "6ad582734d4e3d846e9b14dc"
DID = "TESTPID1"
BROKER = "156.67.82.199"
ADMIN = ("felipejferreira@gmail.com", os.environ.get("TEST_ADMIN_PASSWORD", ""))
OPERATOR = [("cj21@cj21.com", os.environ.get("TEST_ADMIN_PASSWORD", "")), ("cj21@cj21.com", os.environ.get("TEST_OPERATOR_PASSWORD", ""))]


def _login(email, pw):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw})
    return s if r.status_code == 200 else None


@pytest.fixture(scope="module")
def admin():
    s = _login(*ADMIN)
    if not s:
        pytest.skip("admin login failed")
    return s


@pytest.fixture(scope="module")
def operator():
    for e, p in OPERATOR:
        s = _login(e, p)
        if s:
            return s
    pytest.skip("operator login failed")


def _sub_capture(seconds=6):
    """Capture PID/SET messages for TESTPID1."""
    out = {}
    def run():
        try:
            out["v"] = subprocess.run(
                ["timeout", str(seconds), "mosquitto_sub", "-h", BROKER, "-t", f"TJS/{DID}/PID/SET", "-v"],
                capture_output=True, text=True).stdout
        except Exception as e:  # noqa
            out["v"] = str(e)
    t = threading.Thread(target=run)
    t.start()
    time.sleep(1.0)
    return t, out


# Validation
class TestPidValidation:
    def test_kp_out_of_range(self, admin):
        r = admin.post(f"{BASE_URL}/api/devices/{FID}/pid", json={"perfil": "PERSONALIZADO", "kp": 200, "ti": 300, "taxa": 10, "zm": 0.2})
        assert r.status_code == 400
        assert "kp" in r.json().get("detail", "")

    @pytest.mark.parametrize("field,val", [("ti", 20), ("taxa", 60), ("zm", 1.5), ("zm", 0.05)])
    def test_other_out_of_range(self, admin, field, val):
        body = {"perfil": "PERSONALIZADO", "kp": 40, "ti": 300, "taxa": 10, "zm": 0.2, field: val}
        r = admin.post(f"{BASE_URL}/api/devices/{FID}/pid", json=body)
        assert r.status_code == 400

    def test_missing_custom_field(self, admin):
        r = admin.post(f"{BASE_URL}/api/devices/{FID}/pid", json={"perfil": "PERSONALIZADO", "kp": 40})
        assert r.status_code == 400

    def test_invalid_profile(self, admin):
        r = admin.post(f"{BASE_URL}/api/devices/{FID}/pid", json={"perfil": "TURBO"})
        assert r.status_code == 400

    def test_unknown_fancoil(self, admin):
        r = admin.post(f"{BASE_URL}/api/devices/000000000000000000000000/pid", json={"perfil": "NORMAL"})
        assert r.status_code == 404

    def test_non_admin_forbidden(self, operator):
        r = operator.post(f"{BASE_URL}/api/devices/{FID}/pid", json={"perfil": "NORMAL"})
        assert r.status_code == 403

    def test_unauthenticated(self):
        r = requests.post(f"{BASE_URL}/api/devices/{FID}/pid", json={"perfil": "NORMAL"})
        assert r.status_code in (401, 403)


# Accept + persistence + MQTT publish
class TestPidAccept:
    def test_custom_accepted_and_published(self, admin):
        t, out = _sub_capture()
        r = admin.post(f"{BASE_URL}/api/devices/{FID}/pid", json={"perfil": "personalizado", "kp": 45, "ti": 250, "taxa": 12, "zm": 0.3})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["pid_desejado"] == {"perfil": "PERSONALIZADO", "kp": 45, "ti": 250, "taxa": 12, "zm": 0.3}
        assert d["online"] is True and d["enviado"] is True
        t.join()
        print("captured:", out.get("v"))
        assert '"perfil": "PERSONALIZADO"' in out["v"] and '"kp": 45' in out["v"]

    def test_normal_accepted_published_and_persisted(self, admin):
        t, out = _sub_capture()
        r = admin.post(f"{BASE_URL}/api/devices/{FID}/pid", json={"perfil": "NORMAL"})
        assert r.status_code == 200
        d = r.json()
        assert d["pid_desejado"]["perfil"] == "NORMAL" and d["pid_desejado"]["kp"] == 40
        t.join()
        print("captured:", out.get("v"))
        assert out["v"].strip().endswith('{"perfil": "NORMAL"}')
        lst = admin.get(f"{BASE_URL}/api/fancoils").json()
        fc = next((f for f in lst if f["id"] == FID), None)
        assert fc is not None
        assert fc["pid_desejado"]["perfil"] == "NORMAL"
        assert (fc.get("pid_config") or {}).get("perfil") in ("NORMAL", None)

    def test_by_device_id(self, admin):
        r = admin.post(f"{BASE_URL}/api/devices/{DID}/pid", json={"perfil": "NORMAL"})
        assert r.status_code == 200
