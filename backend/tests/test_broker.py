"""Tests for broker test endpoint and settings exposing broker_connected/broker_last_error."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://fancoil-monitoring.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "felipejferreira@gmail.com"
ADMIN_PASSWORDS = ["NovaSenha123", "Admin@123"]


@pytest.fixture(scope="session")
def admin_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    last = None
    for pw in ADMIN_PASSWORDS:
        r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": pw})
        last = r
        if r.status_code == 200:
            tok = r.json().get("access_token")
            if tok:
                s.headers["Authorization"] = f"Bearer {tok}"
            return s
    pytest.skip(f"Admin login failed: {last.status_code if last else 'no response'} {last.text if last else ''}")


@pytest.fixture(scope="session")
def non_admin_session(admin_session):
    """Create a viewer user via admin and login as that user."""
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    email = "test_viewer_broker@example.com"
    pw = "ViewerTest123"
    # try create
    admin_session.post(f"{API}/users", json={"name": "TEST Viewer", "email": email, "password": pw, "role": "viewer", "active": True})
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw})
    if r.status_code != 200:
        pytest.skip("Could not create/login viewer")
    tok = r.json().get("access_token")
    s.headers["Authorization"] = f"Bearer {tok}"
    return s


class TestBrokerTestEndpoint:
    def test_valid_host_port_1883_tls_false(self, admin_session):
        r = admin_session.post(f"{API}/admin/broker/test",
                               json={"host": "156.67.82.199", "port": 1883, "tls": False},
                               timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True, f"Expected ok=True, got {data}"
        assert data["error"] is None

    def test_wrong_port_8883_tls_true(self, admin_session):
        r = admin_session.post(f"{API}/admin/broker/test",
                               json={"host": "156.67.82.199", "port": 8883, "tls": True},
                               timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is False
        assert data["error"] and len(data["error"]) > 0

    def test_wrong_port_8883_tls_false(self, admin_session):
        r = admin_session.post(f"{API}/admin/broker/test",
                               json={"host": "156.67.82.199", "port": 8883, "tls": False},
                               timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is False
        assert data["error"] and ("recusada" in data["error"].lower() or "rede" in data["error"].lower() or "timeout" in data["error"].lower())

    def test_invalid_host(self, admin_session):
        t = time.time()
        r = admin_session.post(f"{API}/admin/broker/test",
                               json={"host": "host-invalido-xyz-1234", "port": 1883, "tls": False},
                               timeout=15)
        elapsed = time.time() - t
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is False
        assert data["error"]
        assert elapsed < 12, f"Took too long: {elapsed}s"

    def test_empty_host(self, admin_session):
        r = admin_session.post(f"{API}/admin/broker/test",
                               json={"host": "", "port": 1883, "tls": False},
                               timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is False
        assert "vazio" in (data["error"] or "").lower()

    def test_viewer_forbidden(self, non_admin_session):
        r = non_admin_session.post(f"{API}/admin/broker/test",
                                   json={"host": "156.67.82.199", "port": 1883, "tls": False},
                                   timeout=10)
        assert r.status_code == 403


class TestSettingsBrokerFields:
    def test_settings_exposes_broker_fields(self, admin_session):
        r = admin_session.get(f"{API}/admin/settings")
        assert r.status_code == 200
        data = r.json()
        assert "broker_connected" in data
        assert "broker_last_error" in data
        assert isinstance(data["broker_connected"], bool)
        # In simulation default, should be true + no error
        if data.get("simulation_enabled"):
            assert data["broker_connected"] is True
            assert data["broker_last_error"] in (None, "")

    def test_real_broker_connect_cycle(self, admin_session):
        """Switch to real broker 156.67.82.199:1883, verify connected, then restore sim."""
        # Capture current config
        orig = admin_session.get(f"{API}/admin/settings").json()
        try:
            payload = {
                "simulation_enabled": False,
                "broker": {
                    "host": "156.67.82.199", "port": 1883, "tls": False,
                    "username": "", "password": "",
                    "topic_prefix": "TJS", "client_id": "pilares-backend",
                },
            }
            r = admin_session.put(f"{API}/admin/settings", json=payload, timeout=15)
            assert r.status_code == 200, r.text
            # Wait up to 6s for connection
            connected = False
            last_err = None
            for _ in range(12):
                time.sleep(0.5)
                s = admin_session.get(f"{API}/admin/settings").json()
                last_err = s.get("broker_last_error")
                if s.get("broker_connected"):
                    connected = True
                    break
            assert connected, f"broker_connected not True after 6s; last_error={last_err}"
        finally:
            # Restore simulation
            admin_session.put(f"{API}/admin/settings", json={"simulation_enabled": True,
                "broker": orig.get("broker", {"host": "", "port": 1883, "tls": False,
                                              "username": "", "password": "",
                                              "topic_prefix": "TJS", "client_id": "pilares-backend"})})
            time.sleep(1)

    def test_real_broker_bad_port_shows_error(self, admin_session):
        orig = admin_session.get(f"{API}/admin/settings").json()
        try:
            payload = {
                "simulation_enabled": False,
                "broker": {
                    "host": "156.67.82.199", "port": 8883, "tls": True,
                    "username": "", "password": "",
                    "topic_prefix": "TJS", "client_id": "pilares-backend",
                },
            }
            r = admin_session.put(f"{API}/admin/settings", json=payload, timeout=20)
            assert r.status_code == 200
            # wait and check error
            err = None
            connected = True
            for _ in range(16):
                time.sleep(0.5)
                s = admin_session.get(f"{API}/admin/settings").json()
                err = s.get("broker_last_error")
                connected = s.get("broker_connected")
                if not connected and err:
                    break
            assert connected is False, f"Expected disconnected; got connected={connected} err={err}"
            assert err and ("recusada" in err.lower() or "erro" in err.lower() or "rede" in err.lower() or "timeout" in err.lower())
        finally:
            admin_session.put(f"{API}/admin/settings", json={"simulation_enabled": True,
                "broker": orig.get("broker", {"host": "", "port": 1883, "tls": False,
                                              "username": "", "password": "",
                                              "topic_prefix": "TJS", "client_id": "pilares-backend"})})
            time.sleep(1)
