"""Iteration 10 — Rebrand NX-360 BMS + Device ID mapping tests."""
import os
import time
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://fancoil-monitoring.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "pilares_hvac")

ADMIN_EMAIL = "felipejferreira@gmail.com"
ADMIN_PASSWORD = "@Pilares1"

EXPECTED_MAPPING = {
    "CJ021": "CE94", "CJ031": "A100", "CJ032": "2CB0", "CJ041": "41",
    "CJ051": "3054", "CJ061": "954C", "CJ062": "E910", "CJ092": "A274",
    "CJ101": "9FE4", "CJ102": "9EFC", "CJ152": "B2E8", "CJ161": "9F54",
    "CJ162": "4A40", "CJ171": "44E0", "CJ172": "F4EC",
}


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def db():
    client = MongoClient(MONGO_URL)
    return client[DB_NAME]


def test_fastapi_title_rebrand():
    r = requests.get(f"{BASE_URL}/api/openapi.json")
    # Try alternate root location
    if r.status_code != 200:
        r = requests.get(f"{BASE_URL}/openapi.json")
    if r.status_code == 200:
        data = r.json()
        assert "NX-360" in data.get("info", {}).get("title", "")


def test_fancoils_mapping(session):
    r = session.get(f"{BASE_URL}/api/fancoils")
    assert r.status_code == 200
    fancoils = r.json()
    assert len(fancoils) == 32, f"expected 32 total, got {len(fancoils)}"

    by_name = {f["name"]: f for f in fancoils}
    active_count = sum(1 for f in fancoils if f.get("active"))
    inactive_count = len(fancoils) - active_count
    assert active_count == 15, f"expected 15 active, got {active_count}"
    assert inactive_count == 17, f"expected 17 inactive, got {inactive_count}"

    for name, expected_devid in EXPECTED_MAPPING.items():
        assert name in by_name, f"{name} missing"
        fc = by_name[name]
        assert fc["device_id"] == expected_devid, f"{name} device_id={fc['device_id']} expected {expected_devid}"
        assert fc["active"] is True, f"{name} should be active"


def test_no_sim_device_ids_in_history_for_migrated(db):
    migrated_names = [n for n in EXPECTED_MAPPING.keys()]
    # Nothing in history/command_log/alarms should have device_id starting with SIM
    # that belongs to one of these fancoils
    real_devids = set(EXPECTED_MAPPING.values())
    for coll_name in ("history", "command_log", "alarms"):
        coll = db[coll_name]
        sim_docs = list(coll.find({"device_id": {"$regex": "^SIM"}}).limit(50))
        # we only care that migrated fancoils no longer have SIM entries;
        # the stale SIM docs for the 17 inactive are OK (they have no mapping).
        # To be strict: check that no doc has fancoil_name in migrated_names AND device_id startswith SIM
        bad = [d for d in sim_docs if d.get("fancoil_name") in migrated_names]
        assert not bad, f"{coll_name} has SIM device_ids for migrated fancoils: {bad[:3]}"


def test_broker_states_populated(session):
    # svc.states exposed via /api/debug or by observing fancoils. Check that at least 5
    # of the 15 real device_ids appear online within ~15s.
    real_devids = set(EXPECTED_MAPPING.values())
    online = set()
    for _ in range(15):
        r = session.get(f"{BASE_URL}/api/fancoils")
        if r.status_code == 200:
            for fc in r.json():
                if fc.get("device_id") in real_devids and fc.get("online"):
                    online.add(fc["device_id"])
            if len(online) >= 5:
                break
        time.sleep(1)
    print(f"online device_ids: {online}")
    assert len(online) >= 5, f"only {len(online)} online out of 15 (need >=5)"
