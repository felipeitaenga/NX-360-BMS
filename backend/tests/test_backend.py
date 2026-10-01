"""End-to-end backend tests for Pilares HVAC Supervisório."""
import os
import time
import json
import asyncio
import pytest
import requests
import websockets

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://fancoil-monitoring.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "felipejferreira@gmail.com"
ADMIN_PASSWORD_INITIAL = "Admin@123"
ADMIN_PASSWORD_NEW = "NovaSenha123"

# Shared state across tests
STATE = {
    "admin_token": None,
    "admin_password": ADMIN_PASSWORD_INITIAL,
    "viewer_token": None,
    "viewer_id": None,
    "viewer_email": f"test_viewer_{int(time.time())}@test.com",
    "viewer_password": "ViewerPass123",
    "fancoil_id": None,
    "fancoil_device_id": None,
    "fancoil_setpoint_min": 18.0,
    "fancoil_setpoint_max": 26.0,
}


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


# ============== AUTH ==============
def test_api_root_404():
    r = requests.get(f"{API}/")
    assert r.status_code == 404


def test_admin_login_initial_or_changed():
    """Login works with initial pwd (first run) OR already-changed one."""
    for pwd in (ADMIN_PASSWORD_INITIAL, ADMIN_PASSWORD_NEW):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": pwd})
        if r.status_code == 200:
            data = r.json()
            assert "access_token" in data
            assert data["user"]["email"] == ADMIN_EMAIL
            STATE["admin_token"] = data["access_token"]
            STATE["admin_password"] = pwd
            STATE["must_change_initial"] = data.get("must_change_password", False)
            return
    pytest.fail("Admin login failed with both known passwords")


def test_auth_me():
    r = requests.get(f"{API}/auth/me", headers=_bearer(STATE["admin_token"]))
    assert r.status_code == 200
    j = r.json()
    assert j["user"]["email"] == ADMIN_EMAIL
    assert "permissions" in j


def test_change_password_if_required():
    """If must_change_password=true, change to NovaSenha123."""
    if STATE.get("must_change_initial") and STATE["admin_password"] == ADMIN_PASSWORD_INITIAL:
        r = requests.post(
            f"{API}/auth/change-password",
            json={"current_password": ADMIN_PASSWORD_INITIAL, "new_password": ADMIN_PASSWORD_NEW},
            headers=_bearer(STATE["admin_token"]),
        )
        assert r.status_code == 200, r.text
        # Re-login
        r2 = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD_NEW})
        assert r2.status_code == 200
        data = r2.json()
        assert data.get("must_change_password") is False
        STATE["admin_token"] = data["access_token"]
        STATE["admin_password"] = ADMIN_PASSWORD_NEW
    else:
        # Already changed; just verify we're logged in
        assert STATE["admin_token"] is not None


# ============== FANCOILS ==============
def test_list_fancoils_32():
    r = requests.get(f"{API}/fancoils", headers=_bearer(STATE["admin_token"]))
    assert r.status_code == 200
    fcs = r.json()
    assert isinstance(fcs, list)
    assert len(fcs) == 32, f"Expected 32 fancoils, got {len(fcs)}"
    names = sorted(fc["name"] for fc in fcs)
    assert "CJ011" in names and "CJ172" in names
    # No floor 13
    assert not any(fc["floor"] == 13 for fc in fcs)
    for fc in fcs:
        assert fc["device_id"].startswith("SIM")
        assert "online" in fc and "status" in fc and "setpoint" in fc
    STATE["fancoil_id"] = fcs[0]["id"]
    STATE["fancoil_device_id"] = fcs[0]["device_id"]
    STATE["fancoil_setpoint_min"] = fcs[0]["setpoint_min"]
    STATE["fancoil_setpoint_max"] = fcs[0]["setpoint_max"]


def test_get_fancoil_detail():
    r = requests.get(f"{API}/fancoils/{STATE['fancoil_id']}", headers=_bearer(STATE["admin_token"]))
    assert r.status_code == 200
    fc = r.json()
    assert fc["id"] == STATE["fancoil_id"]
    assert fc.get("authorized") is True


# ============== COMMANDS ==============
def test_cmd_in_automatico_returns_400():
    """CMD while ESTADO=true should fail with helpful message."""
    # Ensure fancoil is in AUTOMÁTICO first
    requests.post(
        f"{API}/fancoils/{STATE['fancoil_id']}/command",
        json={"kind": "ESTADO", "value": "true"},
        headers=_bearer(STATE["admin_token"]),
    )
    time.sleep(4)
    r = requests.post(
        f"{API}/fancoils/{STATE['fancoil_id']}/command",
        json={"kind": "CMD", "value": "true"},
        headers=_bearer(STATE["admin_token"]),
    )
    assert r.status_code == 400
    assert "AUTOM" in r.json()["detail"].upper() or "FORÇADO" in r.json()["detail"]


def test_estado_forcado_and_cmd_true():
    r = requests.post(
        f"{API}/fancoils/{STATE['fancoil_id']}/command",
        json={"kind": "ESTADO", "value": "false"},
        headers=_bearer(STATE["admin_token"]),
    )
    assert r.status_code == 200
    time.sleep(4)
    r = requests.post(
        f"{API}/fancoils/{STATE['fancoil_id']}/command",
        json={"kind": "CMD", "value": "true"},
        headers=_bearer(STATE["admin_token"]),
    )
    assert r.status_code == 200, r.text
    time.sleep(5)
    g = requests.get(f"{API}/fancoils/{STATE['fancoil_id']}", headers=_bearer(STATE["admin_token"]))
    assert g.status_code == 200
    fc = g.json()
    assert fc["online"] is True
    assert fc["status"] is True, f"Expected status=True after CMD, got {fc.get('status')}"


def test_setpoint_valid():
    r = requests.post(
        f"{API}/fancoils/{STATE['fancoil_id']}/command",
        json={"kind": "SETPOINT", "value": "24.5"},
        headers=_bearer(STATE["admin_token"]),
    )
    assert r.status_code == 200, r.text


def test_setpoint_out_of_range():
    # fancoil setpoint_max defaults to 26; use 99 to be safely out
    r = requests.post(
        f"{API}/fancoils/{STATE['fancoil_id']}/command",
        json={"kind": "SETPOINT", "value": "99"},
        headers=_bearer(STATE["admin_token"]),
    )
    assert r.status_code == 400


# ============== ADMIN / USERS / PERMISSIONS ==============
def test_create_viewer_user():
    r = requests.post(
        f"{API}/users",
        json={
            "name": "TEST Viewer",
            "email": STATE["viewer_email"],
            "password": STATE["viewer_password"],
            "role": "viewer",
            "active": True,
        },
        headers=_bearer(STATE["admin_token"]),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["email"] == STATE["viewer_email"]
    STATE["viewer_id"] = data["id"]


def test_viewer_login_and_me():
    # First login requires change_password=true but we can still get token
    r = requests.post(f"{API}/auth/login", json={
        "email": STATE["viewer_email"], "password": STATE["viewer_password"]
    })
    assert r.status_code == 200
    data = r.json()
    assert data.get("must_change_password") is True
    STATE["viewer_token"] = data["access_token"]


def test_permissions_set_and_get():
    r = requests.put(
        f"{API}/permissions",
        json={
            "user_id": STATE["viewer_id"],
            "modules": ["ar-condicionado"],
            "fancoil_ids": [STATE["fancoil_id"]],
        },
        headers=_bearer(STATE["admin_token"]),
    )
    assert r.status_code == 200
    g = requests.get(f"{API}/permissions/{STATE['viewer_id']}", headers=_bearer(STATE["admin_token"]))
    assert g.status_code == 200
    assert STATE["fancoil_id"] in g.json()["fancoil_ids"]


def test_viewer_cannot_command():
    r = requests.post(
        f"{API}/fancoils/{STATE['fancoil_id']}/command",
        json={"kind": "ESTADO", "value": "false"},
        headers=_bearer(STATE["viewer_token"]),
    )
    assert r.status_code == 403


def test_viewer_cannot_access_admin_endpoints():
    for path in ("/users", "/admin/settings", "/admin/detected-devices"):
        r = requests.get(f"{API}{path}", headers=_bearer(STATE["viewer_token"]))
        assert r.status_code == 403, f"{path} expected 403, got {r.status_code}"


def test_admin_settings_get_put():
    r = requests.get(f"{API}/admin/settings", headers=_bearer(STATE["admin_token"]))
    assert r.status_code == 200
    s = r.json()
    assert "simulation_enabled" in s
    sim = s["simulation_enabled"]
    # toggle and revert
    r2 = requests.put(f"{API}/admin/settings",
                      json={"simulation_enabled": sim},
                      headers=_bearer(STATE["admin_token"]))
    assert r2.status_code == 200


def test_admin_detected_devices():
    r = requests.get(f"{API}/admin/detected-devices", headers=_bearer(STATE["admin_token"]))
    assert r.status_code == 200
    assert isinstance(r.json(), list)


# ============== ALARMS ==============
def test_alarms_list():
    r = requests.get(f"{API}/alarms", headers=_bearer(STATE["admin_token"]))
    assert r.status_code == 200
    assert isinstance(r.json(), list)


# ============== REPORTS ==============
def test_report_commands_json():
    r = requests.get(f"{API}/reports/commands?days=30", headers=_bearer(STATE["admin_token"]))
    assert r.status_code == 200
    rows = r.json()
    assert isinstance(rows, list)
    assert len(rows) > 0, "Expected command log entries from previous tests"


def test_report_commands_csv():
    r = requests.get(f"{API}/reports/commands?days=30&format=csv", headers=_bearer(STATE["admin_token"]))
    assert r.status_code == 200
    assert "text/csv" in r.headers.get("content-type", "")
    assert "attachment" in r.headers.get("content-disposition", "").lower()


def test_report_hours_on():
    r = requests.get(f"{API}/reports/hours-on?days=30", headers=_bearer(STATE["admin_token"]))
    assert r.status_code == 200
    assert isinstance(r.json(), dict)


def test_report_access_log():
    r = requests.get(f"{API}/reports/access-log?days=30", headers=_bearer(STATE["admin_token"]))
    assert r.status_code == 200
    assert isinstance(r.json(), list)


# ============== WEBSOCKET ==============
def test_websocket_snapshot_and_telemetry():
    async def runner():
        ws_url = BASE_URL.replace("https://", "wss://").replace("http://", "ws://") + "/api/ws"
        async with websockets.connect(ws_url, open_timeout=10) as ws:
            snap_raw = await asyncio.wait_for(ws.recv(), timeout=10)
            snap = json.loads(snap_raw)
            assert snap["event"] == "snapshot"
            assert isinstance(snap["data"], list)
            assert len(snap["data"]) == 32
            # Wait for a telemetry event
            got_tele = False
            for _ in range(10):
                msg = await asyncio.wait_for(ws.recv(), timeout=5)
                data = json.loads(msg)
                if data.get("event") == "telemetry":
                    assert "device_id" in data["data"]
                    assert "state" in data["data"]
                    got_tele = True
                    break
            assert got_tele, "No telemetry event received within timeout"
    asyncio.run(runner())


# ============== CLEANUP ==============
def test_cleanup_delete_viewer():
    r = requests.delete(f"{API}/users/{STATE['viewer_id']}", headers=_bearer(STATE["admin_token"]))
    assert r.status_code == 200
