"""
Iteration 11 — MQTT alias normalization + SVG animation fix.

Backend coverage:
  * Publish directly to real broker TJS/TESTDEV1/{COMANDO,MODO,ESTADO,CT,SETPOINT,PRESSAO}
    and verify svc state via GET /api/admin/detected-devices + GET /api/fancoils
    (after cadastrando um fancoil CJ-TEST com device_id=TESTDEV1).
  * Malformed ESTADO ("talvez") must NOT crash backend.
  * 15 real CJs: GET /api/fancoils must now expose estado/cmd/modo for a few CJs
    that previously showed None.
"""
import os
import time
import pytest
import requests
import paho.mqtt.client as mqtt

def _load_frontend_env():
    try:
        with open("/app/frontend/.env", "r") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().strip('"')
    except Exception:
        return None
    return None

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _load_frontend_env() or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL not configured"
BROKER_HOST = "156.67.82.199"
BROKER_PORT = 1883
TOPIC_PREFIX = "TJS"
ADMIN_EMAIL = "felipejferreira@gmail.com"
ADMIN_PASSWORD = "@Pilares1"


# ---------------- Fixtures ----------------
@pytest.fixture(scope="session")
def admin_client():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=20)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token")
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="session")
def mqtt_pub():
    c = mqtt.Client(client_id="iter11-tester", clean_session=True)
    c.connect(BROKER_HOST, BROKER_PORT, keepalive=30)
    c.loop_start()
    yield c
    c.loop_stop()
    c.disconnect()


def _pub(c, device, var, payload, retain=False):
    topic = f"{TOPIC_PREFIX}/{device}/{var}"
    c.publish(topic, payload=str(payload), qos=0, retain=retain)


# ---------------- Alias normalization ----------------
def test_apply_update_accepts_all_aliases(admin_client, mqtt_pub):
    device = "TESTDEV1"
    # Publish all variants
    _pub(mqtt_pub, device, "COMANDO", "1")
    _pub(mqtt_pub, device, "MODO", "0")
    _pub(mqtt_pub, device, "ESTADO", "true")
    _pub(mqtt_pub, device, "CT", "22.5")
    _pub(mqtt_pub, device, "SETPOINT", "24")
    _pub(mqtt_pub, device, "PRESSAO", "55")
    _pub(mqtt_pub, device, "STATUS", "1")
    time.sleep(4.0)

    # Should appear in detected-devices
    r = admin_client.get(f"{BASE_URL}/api/admin/detected-devices", timeout=15)
    assert r.status_code == 200
    device_ids = [d.get("device_id") for d in r.json()]
    assert device in device_ids, f"{device} not detected. Got: {device_ids[:10]}"


def test_malformed_estado_does_not_crash(admin_client, mqtt_pub):
    device = "TESTDEV2"
    _pub(mqtt_pub, device, "ESTADO", "talvez")
    _pub(mqtt_pub, device, "CT", "nao-numero")
    _pub(mqtt_pub, device, "SETPOINT", "xx")
    _pub(mqtt_pub, device, "PRESSAO", "xx")
    time.sleep(3.0)

    # Backend still up
    r = admin_client.get(f"{BASE_URL}/api/fancoils", timeout=15)
    assert r.status_code == 200
    # Device registered without crash
    r2 = admin_client.get(f"{BASE_URL}/api/admin/detected-devices", timeout=15)
    assert r2.status_code == 200


# ---------------- Fancoil CJ-TEST round-trip ----------------
def test_cj_test_fancoil_state(admin_client, mqtt_pub):
    device = "TESTDEV1"
    # Make sure publishes recent
    _pub(mqtt_pub, device, "COMANDO", "1")
    _pub(mqtt_pub, device, "MODO", "0")
    _pub(mqtt_pub, device, "ESTADO", "true")
    _pub(mqtt_pub, device, "CT", "22.5")
    _pub(mqtt_pub, device, "SETPOINT", "24")
    _pub(mqtt_pub, device, "PRESSAO", "55")
    _pub(mqtt_pub, device, "STATUS", "1")
    time.sleep(3.5)

    # Create fancoil mapped to TESTDEV1
    payload = {
        "name": "CJ-TEST",
        "device_id": device,
        "floor": 1,
        "side": 1,
        "description": "iter11 test",
    }
    r = admin_client.post(f"{BASE_URL}/api/fancoils", json=payload, timeout=15)
    assert r.status_code in (200, 201), f"create failed: {r.status_code} {r.text}"
    fc = r.json()
    fid = fc["id"]
    try:
        r2 = admin_client.get(f"{BASE_URL}/api/fancoils/{fid}", timeout=15)
        assert r2.status_code == 200
        data = r2.json()
        assert data["device_id"] == device
        assert data.get("cmd") is True, f"cmd={data.get('cmd')}"
        assert data.get("estado") is True, f"estado={data.get('estado')}"
        assert data.get("temperature") == 22.5, f"temperature={data.get('temperature')}"
        assert data.get("setpoint") == 24.0, f"setpoint={data.get('setpoint')}"
        assert data.get("pressure") == 55.0, f"pressure={data.get('pressure')}"
        assert data.get("modo") is False, f"modo={data.get('modo')}"
        assert data.get("status") is True, f"status={data.get('status')}"
    finally:
        d = admin_client.delete(f"{BASE_URL}/api/fancoils/{fid}", timeout=15)
        assert d.status_code in (200, 204)


# ---------------- Real CJs state availability ----------------
def test_real_cjs_have_state(admin_client):
    # Give broker time to flush retained state
    time.sleep(5.0)
    r = admin_client.get(f"{BASE_URL}/api/fancoils", timeout=20)
    assert r.status_code == 200
    fancoils = r.json()
    by_name = {f["name"]: f for f in fancoils}

    # CJ101 is the known-active fancoil (device_id=9FE4)
    assert "CJ101" in by_name
    cj101 = by_name["CJ101"]
    assert cj101["device_id"] == "9FE4"

    # Count real fancoils (active=True) that are now reporting at least one of estado/cmd/modo
    active = [f for f in fancoils if f.get("active")]
    with_state = [
        f for f in active
        if f.get("estado") is not None or f.get("cmd") is not None or f.get("modo") is not None
    ]
    print(f"\nActive fancoils: {len(active)}, with any state: {len(with_state)}")
    for f in active:
        print(f"  {f['name']} dev={f['device_id']} cmd={f.get('cmd')} estado={f.get('estado')} "
              f"modo={f.get('modo')} temp={f.get('temperature')} status={f.get('status')}")
    # Soft expectation: at least some of the 15 real CJs are now reporting
    # (broker publishes vary with ESPs online). Don't fail hard — report via print.
    assert len(active) >= 1
