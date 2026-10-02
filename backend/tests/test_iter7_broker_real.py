"""Iteration 7 — Pilares HVAC
Validate: simulation disabled, SIM* fancoils inactive, broker 156.67.82.199:1883
connects, CJ101 (device_id=9FE4) receives real telemetry, mode switch clears
in-memory state, detected-devices lists real IDs.
"""
import os
import time
import pytest
import requests

def _load_base_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if not v:
        try:
            with open("/app/frontend/.env") as fp:
                for line in fp:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        v = line.split("=", 1)[1].strip()
                        break
        except FileNotFoundError:
            pass
    assert v, "REACT_APP_BACKEND_URL not set"
    return v.rstrip("/")


BASE_URL = _load_base_url()
ADMIN_EMAIL = "felipejferreira@gmail.com"
ADMIN_PASS = "NovaSenha123"


@pytest.fixture(scope="module")
def admin_client():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, f"login falhou: {r.status_code} {r.text}"
    s.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    return s


# ---------- SETTINGS / BROKER ----------
def test_settings_simulation_off_and_broker_connected(admin_client):
    r = admin_client.get(f"{BASE_URL}/api/admin/settings", timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert data.get("simulation_enabled") is False, f"simulation_enabled={data.get('simulation_enabled')}"
    assert data.get("broker_connected") is True, f"broker_connected={data.get('broker_connected')} err={data.get('broker_last_error')}"
    assert data.get("broker_last_error") in (None, ""), f"last_error={data.get('broker_last_error')}"
    broker = data.get("broker", {})
    assert broker.get("port") == 1883
    assert broker.get("tls") is False


# ---------- FANCOIL ACTIVE/INACTIVE ----------
def test_fancoils_only_cj101_active(admin_client):
    r = admin_client.get(f"{BASE_URL}/api/fancoils", timeout=10)
    assert r.status_code == 200
    fcs = r.json()
    active = [f for f in fcs if f.get("active")]
    inactive = [f for f in fcs if not f.get("active")]
    assert len(active) == 1, f"ativos esperados=1, obtido={len(active)}: {[f['device_id'] for f in active]}"
    assert active[0]["device_id"] == "9FE4", f"active device_id={active[0]['device_id']}"
    assert active[0]["name"].upper().startswith("CJ101") or "CJ101" in active[0]["name"].upper()
    # Inactive must all start with SIM
    non_sim_inactive = [f for f in inactive if not f["device_id"].startswith("SIM")]
    assert not non_sim_inactive, f"inativos não-SIM encontrados: {[f['device_id'] for f in non_sim_inactive]}"
    assert len(inactive) == 31, f"inativos esperados=31, obtido={len(inactive)}"


# ---------- CJ101 TELEMETRY ----------
def test_cj101_receives_real_broker_data(admin_client):
    # Give broker time to deliver retained messages after any recent restart
    deadline = time.time() + 20
    cj = None
    while time.time() < deadline:
        r = admin_client.get(f"{BASE_URL}/api/fancoils", timeout=10)
        assert r.status_code == 200
        for f in r.json():
            if f["device_id"] == "9FE4":
                cj = f
                break
        if cj and cj.get("online"):
            # Check at least one real field is not None
            fields = ["temperature", "status", "modo", "estado", "cmd", "setpoint", "vag"]
            if any(cj.get(k) is not None for k in fields):
                break
        time.sleep(2)
    assert cj is not None, "CJ101 (9FE4) não encontrado no GET /fancoils"
    assert cj.get("online") is True, f"CJ101 offline: {cj}"
    non_null = {k: cj.get(k) for k in ("temperature", "status", "modo", "estado", "cmd", "setpoint", "vag") if cj.get(k) is not None}
    assert non_null, f"Nenhum campo real recebido para CJ101: {cj}"
    # Sanity bound on temperature if present
    if cj.get("temperature") is not None:
        t = cj["temperature"]
        assert 5 <= t <= 50, f"temperature fora de range plausível: {t}"


# ---------- DETECTED DEVICES ----------
def test_detected_devices_real_broker(admin_client):
    # Wait a bit for broker to deliver retained topics to populate db.devices
    time.sleep(5)
    r = admin_client.get(f"{BASE_URL}/api/admin/detected-devices", timeout=10)
    assert r.status_code == 200
    devs = r.json()
    assert isinstance(devs, list)
    # Expect at least 10 real-looking devices (not SIM*)
    real = [d for d in devs if not d.get("device_id", "").startswith("SIM")]
    assert len(real) >= 10, f"Dispositivos reais detectados < 10: total={len(devs)} real={len(real)} sample={[d['device_id'] for d in devs[:20]]}"


# ---------- MODE SWITCH (sim ON -> OFF) ----------
def test_mode_switch_clears_state_and_no_sim_leak(admin_client):
    # Toggle simulation ON
    r = admin_client.put(f"{BASE_URL}/api/admin/settings",
                         json={"simulation_enabled": True}, timeout=15)
    assert r.status_code == 200
    assert r.json().get("simulation_enabled") is True
    time.sleep(3)

    # Toggle back OFF
    r = admin_client.put(f"{BASE_URL}/api/admin/settings",
                         json={"simulation_enabled": False}, timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data.get("simulation_enabled") is False
    # Allow the broker time to reconnect
    deadline = time.time() + 15
    while time.time() < deadline:
        s = admin_client.get(f"{BASE_URL}/api/admin/settings", timeout=10).json()
        if s.get("broker_connected"):
            break
        time.sleep(2)
    s = admin_client.get(f"{BASE_URL}/api/admin/settings", timeout=10).json()
    assert s.get("broker_connected") is True, f"Broker não reconectou após toggle. err={s.get('broker_last_error')}"

    # Verify that SIM* fancoils (inactive) do not expose simulated telemetry
    # right after switching to real mode. Grab any SIM device_id.
    r = admin_client.get(f"{BASE_URL}/api/fancoils", timeout=10)
    sims = [f for f in r.json() if f["device_id"].startswith("SIM")]
    assert sims, "Nenhum fancoil SIM* encontrado no cadastro"
    # Immediately after switching OFF, the real broker shouldn't publish SIM1001.
    # states dict was cleared by restart(), so SIM fancoils should have online=False
    # (default FancoilState) and no temperature/status/etc from simulation.
    leaked = []
    for f in sims:
        if f.get("online") is True:
            leaked.append(f["device_id"])
    # Accept small race: if everything migrated cleanly we expect zero leaks.
    assert not leaked, f"Fancoils SIM com online=True após sair da simulação (vazamento): {leaked[:5]}"
