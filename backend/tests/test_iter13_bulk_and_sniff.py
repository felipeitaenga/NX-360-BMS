"""Iter13 — Bulk command endpoints + MQTT sniff diagnostic endpoints."""
import os
import time
import pytest
import requests

def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    try:
        with open("/app/frontend/.env") as fh:
            for line in fh:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().rstrip("/")
    except FileNotFoundError:
        pass
    raise RuntimeError("REACT_APP_BACKEND_URL not configured")

BASE_URL = _load_backend_url()
ADMIN_EMAIL = "felipejferreira@gmail.com"
ADMIN_PASS = "@Pilares1"


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    token = r.json()["access_token"]
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def viewer_session(admin_session):
    """Create a disposable viewer user for 403 test."""
    email = "test_viewer_iter13@example.com"
    pw = "Viewer@123"
    # Try to delete any previous user with that email
    users = admin_session.get(f"{BASE_URL}/api/users").json()
    for u in users:
        if u["email"] == email:
            admin_session.delete(f"{BASE_URL}/api/users/{u['id']}")
            break
    r = admin_session.post(f"{BASE_URL}/api/users", json={
        "name": "Test Viewer", "email": email, "password": pw,
        "role": "viewer", "active": True,
    })
    assert r.status_code == 200, r.text
    uid = r.json()["id"]

    s = requests.Session()
    rl = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=15)
    assert rl.status_code == 200, rl.text
    s.headers.update({"Authorization": f"Bearer {rl.json()['access_token']}"})
    yield s
    admin_session.delete(f"{BASE_URL}/api/users/{uid}")


# -------- Bulk commands --------
class TestBulkCommand:
    def test_unforce_all(self, admin_session):
        r = admin_session.post(f"{BASE_URL}/api/fancoils/bulk-command",
                               json={"action": "unforce_all"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "sent" in data and "skipped" in data
        assert isinstance(data["sent"], list)
        assert isinstance(data["skipped"], list)
        # Should hit at least some online devices
        assert len(data["sent"]) >= 1, f"no sent entries: {data}"
        # skipped entries should carry reason
        for sk in data["skipped"]:
            assert "device_id" in sk and "reason" in sk

    def test_force_all(self, admin_session):
        r = admin_session.post(f"{BASE_URL}/api/fancoils/bulk-command",
                               json={"action": "force_all"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "sent" in data and len(data["sent"]) >= 1

    def test_turn_on_all(self, admin_session):
        r = admin_session.post(f"{BASE_URL}/api/fancoils/bulk-command",
                               json={"action": "turn_on_all"})
        assert r.status_code == 200, r.text
        assert len(r.json()["sent"]) >= 1

    def test_turn_off_all(self, admin_session):
        r = admin_session.post(f"{BASE_URL}/api/fancoils/bulk-command",
                               json={"action": "turn_off_all"})
        assert r.status_code == 200, r.text
        # Restore to automatico
        admin_session.post(f"{BASE_URL}/api/fancoils/bulk-command",
                           json={"action": "unforce_all"})

    def test_invalid_action(self, admin_session):
        r = admin_session.post(f"{BASE_URL}/api/fancoils/bulk-command",
                               json={"action": "nuke_all"})
        assert r.status_code == 422

    def test_viewer_forbidden(self, viewer_session):
        r = viewer_session.post(f"{BASE_URL}/api/fancoils/bulk-command",
                                json={"action": "unforce_all"})
        assert r.status_code == 403, r.text


# -------- MQTT sniff --------
class TestMqttSniff:
    def test_sniff_summary_structure(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/mqtt/sniff")
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("connected", "prefix", "simulation", "devices", "unknown_sample"):
            assert k in d, f"missing key {k}"
        assert isinstance(d["devices"], list)
        assert d["connected"] is True, f"broker not connected: {d}"
        assert d["prefix"] == "TJS"
        assert d["simulation"] is False
        # At least some devices under the TJS prefix
        assert len(d["devices"]) >= 1
        for dev in d["devices"]:
            assert "device_id" in dev
            assert "vars" in dev
            assert "last_seen" in dev
            assert "msg_count" in dev

    def test_sniff_requires_admin(self, viewer_session):
        r = viewer_session.get(f"{BASE_URL}/api/admin/mqtt/sniff")
        assert r.status_code == 403

    def test_sniff_device_detail(self, admin_session):
        summary = admin_session.get(f"{BASE_URL}/api/admin/mqtt/sniff").json()
        assert summary["devices"], "no devices to drill into"
        did = summary["devices"][0]["device_id"]
        r = admin_session.get(f"{BASE_URL}/api/admin/mqtt/sniff/{did}")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["device_id"] == did
        assert isinstance(d["events"], list)
        for e in d["events"]:
            assert "ts" in e and "var" in e and "payload" in e


# -------- MQTT connection stability --------
class TestMqttStability:
    def test_broker_connected(self, admin_session):
        s = admin_session.get(f"{BASE_URL}/api/admin/settings").json()
        assert s.get("broker_connected") is True
        assert s.get("simulation_enabled") is False

    def test_no_disconnect_loop_over_60s(self, admin_session):
        """Call sniff 7 times in 70s to ensure connected stays true."""
        for _ in range(7):
            d = admin_session.get(f"{BASE_URL}/api/admin/mqtt/sniff").json()
            assert d["connected"] is True, f"broker disconnected mid-test: {d}"
            time.sleep(10)
