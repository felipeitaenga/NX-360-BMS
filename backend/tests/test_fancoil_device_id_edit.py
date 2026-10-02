"""Backend tests for Admin → Fancoil device_id edit + auto-migration (iteration 4)."""
import os
import time
import pytest
import requests
from pymongo import MongoClient
from bson import ObjectId

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "felipejferreira@gmail.com"
ADMIN_PWDS = ["NovaSenha123", "Admin@123"]

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "pilares_hvac")

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
def mongo():
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    yield db
    client.close()


class TestDeviceIdEdit:
    def test_patch_same_device_id_no_change(self):
        """PATCH with same device_id as current should 200 and keep fields unchanged."""
        r = requests.get(f"{API}/fancoils", headers=_bearer(STATE["admin_token"]))
        cj011 = next(f for f in r.json() if f["name"] == "CJ011")
        current_did = cj011["device_id"]
        rp = requests.patch(f"{API}/fancoils/{cj011['id']}",
                            json={"device_id": current_did},
                            headers=_bearer(STATE["admin_token"]))
        assert rp.status_code == 200, rp.text
        assert rp.json()["device_id"] == current_did

    def test_patch_empty_device_id_returns_400(self):
        r = requests.get(f"{API}/fancoils", headers=_bearer(STATE["admin_token"]))
        cj011 = next(f for f in r.json() if f["name"] == "CJ011")
        rp = requests.patch(f"{API}/fancoils/{cj011['id']}",
                            json={"device_id": ""},
                            headers=_bearer(STATE["admin_token"]))
        assert rp.status_code == 400, f"Expected 400 for empty device_id, got {rp.status_code}: {rp.text}"

    def test_patch_duplicate_device_id_returns_400(self):
        r = requests.get(f"{API}/fancoils", headers=_bearer(STATE["admin_token"]))
        fcs = r.json()
        cj011 = next(f for f in fcs if f["name"] == "CJ011")
        cj012 = next(f for f in fcs if f["name"] == "CJ012")
        rp = requests.patch(f"{API}/fancoils/{cj011['id']}",
                            json={"device_id": cj012["device_id"]},
                            headers=_bearer(STATE["admin_token"]))
        assert rp.status_code == 400
        assert "já cadastrado" in rp.text.lower() or "ja cadastrado" in rp.text.lower()

    def test_device_id_migration_full_flow(self, mongo):
        """Create fancoil with OLDTST001, seed history/cmd/alarm docs, PATCH to NEWTST001,
        verify migration + cleanup."""
        old_did = "OLDTST001"
        new_did = "NEWTST001"
        name = f"TST_mig_{int(time.time())}"
        # Pre-cleanup
        mongo.fancoils.delete_many({"name": {"$regex": "^TST_mig_"}})
        mongo.fancoils.delete_many({"device_id": {"$in": [old_did, new_did]}})
        for coll in ("history", "command_log", "alarms"):
            mongo[coll].delete_many({"device_id": {"$in": [old_did, new_did]}})

        # Create fancoil via API
        cr = requests.post(f"{API}/fancoils", json={
            "device_id": old_did,
            "name": name,
            "description": "mig test",
            "floor": 99,
            "side": 1,
            "setpoint_min": 18,
            "setpoint_max": 25,
            "temp_alarm_min": 10,
            "temp_alarm_max": 32,
            "active": True,
        }, headers=_bearer(STATE["admin_token"]))
        assert cr.status_code in (200, 201), cr.text
        fid = cr.json()["id"]

        try:
            # Seed dependent docs
            mongo.history.insert_many([
                {"device_id": old_did, "timestamp": "2026-01-01T00:00:00", "var": "TEMP", "value": 20.0},
                {"device_id": old_did, "timestamp": "2026-01-01T00:01:00", "var": "TEMP", "value": 21.0},
            ])
            mongo.command_log.insert_one({"device_id": old_did, "var": "CMD", "value": 1, "timestamp": "2026-01-01T00:00:00"})
            mongo.alarms.insert_one({"device_id": old_did, "type": "overtemp", "timestamp": "2026-01-01T00:00:00", "active": True})

            # Verify seeds
            assert mongo.history.count_documents({"device_id": old_did}) == 2
            assert mongo.command_log.count_documents({"device_id": old_did}) == 1
            assert mongo.alarms.count_documents({"device_id": old_did}) == 1

            # PATCH to new device_id
            rp = requests.patch(f"{API}/fancoils/{fid}",
                                json={"device_id": new_did},
                                headers=_bearer(STATE["admin_token"]))
            assert rp.status_code == 200, rp.text
            assert rp.json()["device_id"] == new_did

            # GET verifies persistence
            gr = requests.get(f"{API}/fancoils/{fid}", headers=_bearer(STATE["admin_token"]))
            assert gr.status_code == 200
            assert gr.json()["device_id"] == new_did

            # Verify migration
            assert mongo.history.count_documents({"device_id": old_did}) == 0, "history not migrated from OLDTST"
            assert mongo.command_log.count_documents({"device_id": old_did}) == 0, "command_log not migrated"
            assert mongo.alarms.count_documents({"device_id": old_did}) == 0, "alarms not migrated"
            assert mongo.history.count_documents({"device_id": new_did}) >= 2
            assert mongo.command_log.count_documents({"device_id": new_did}) >= 1
            assert mongo.alarms.count_documents({"device_id": new_did}) >= 1

            # devices collection should not retain old/new entries from last snapshot
            assert mongo.devices.count_documents({"device_id": old_did}) == 0
        finally:
            # Teardown
            requests.delete(f"{API}/fancoils/{fid}", headers=_bearer(STATE["admin_token"]))
            for coll in ("history", "command_log", "alarms", "devices"):
                mongo[coll].delete_many({"device_id": {"$in": [old_did, new_did]}})
            mongo.fancoils.delete_many({"device_id": {"$in": [old_did, new_did]}})

    def test_patch_device_id_as_viewer_forbidden(self):
        r = requests.get(f"{API}/fancoils", headers=_bearer(STATE["admin_token"]))
        cj011 = next(f for f in r.json() if f["name"] == "CJ011")
        viewer_email = f"TEST_viewer_did_{int(time.time())}@test.com"
        rc = requests.post(f"{API}/users",
                           json={"name": "V", "email": viewer_email, "password": "Pwd12345", "role": "viewer"},
                           headers=_bearer(STATE["admin_token"]))
        assert rc.status_code in (200, 201)
        vid = rc.json()["id"]
        try:
            rl = requests.post(f"{API}/auth/login", json={"email": viewer_email, "password": "Pwd12345"})
            vt = rl.json()["access_token"]
            rp = requests.patch(f"{API}/fancoils/{cj011['id']}",
                                json={"device_id": "HACKED001"},
                                headers=_bearer(vt))
            assert rp.status_code == 403
        finally:
            requests.delete(f"{API}/users/{vid}", headers=_bearer(STATE["admin_token"]))

    def test_patch_device_id_as_operator_forbidden(self):
        r = requests.get(f"{API}/fancoils", headers=_bearer(STATE["admin_token"]))
        cj011 = next(f for f in r.json() if f["name"] == "CJ011")
        op_email = f"TEST_op_did_{int(time.time())}@test.com"
        rc = requests.post(f"{API}/users",
                           json={"name": "O", "email": op_email, "password": "Pwd12345", "role": "operator"},
                           headers=_bearer(STATE["admin_token"]))
        assert rc.status_code in (200, 201)
        oid = rc.json()["id"]
        try:
            rl = requests.post(f"{API}/auth/login", json={"email": op_email, "password": "Pwd12345"})
            ot = rl.json()["access_token"]
            rp = requests.patch(f"{API}/fancoils/{cj011['id']}",
                                json={"device_id": "HACKED002"},
                                headers=_bearer(ot))
            assert rp.status_code == 403
        finally:
            requests.delete(f"{API}/users/{oid}", headers=_bearer(STATE["admin_token"]))
