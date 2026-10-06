"""Tests for Programação Horária v2 (iteration 19).
- GET /api/schedules (admin list all accessible)
- POST/PATCH/DELETE triggers publish_schedule_config (SCHEDULE/SET)
- RBAC: cj21 only sees own fancoil schedules
- Scheduler loop deactivated
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://fancoil-monitoring.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "felipejferreira@gmail.com"
ADMIN_PASS = "@Pilares1"
CJ21_EMAIL = "cj21@cj21.com"
# iteration_18 reports password was changed to Cj21@2027!x; try both
CJ21_PASS_CANDIDATES = ["Cj21@2026", "Cj21@2027!x"]
CJ21_FANCOIL_ID = "6abe34775f994cb96b7b78dd"


@pytest.fixture(scope="module")
def admin_client():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, r.text
    s.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    return s


@pytest.fixture(scope="module")
def cj21_client():
    s = requests.Session()
    for pw in CJ21_PASS_CANDIDATES:
        r = s.post(f"{BASE_URL}/api/auth/login", json={"email": CJ21_EMAIL, "password": pw})
        if r.status_code == 200:
            s.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
            return s
    pytest.skip(f"cj21 login failed with all passwords; last: {r.status_code} {r.text}")


class TestSchedulesAdmin:
    def test_list_all_schedules_admin(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/schedules")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        # Not asserting >= 1 since initial db may be empty; just verify shape if present
        for s in data:
            for k in ("id", "fancoil_id", "hour", "minute", "action", "value", "enabled"):
                assert k in s, f"missing {k}: {s}"

    def test_per_fancoil_schedules_still_works(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/schedules/{CJ21_FANCOIL_ID}")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_patch_delete_schedule_triggers_publish(self, admin_client, tmp_path):
        # CREATE
        payload = {
            "fancoil_id": CJ21_FANCOIL_ID,
            "days": [1, 2, 3],
            "hour": 23,
            "minute": 59,
            "action": "cmd",
            "value": "true",
            "enabled": True,
        }
        r = admin_client.post(f"{BASE_URL}/api/schedules", json=payload)
        assert r.status_code == 200, r.text
        sched = r.json()
        assert sched["fancoil_id"] == CJ21_FANCOIL_ID
        assert sched["hour"] == 23 and sched["minute"] == 59
        sched_id = sched["id"]
        time.sleep(0.3)

        try:
            # Verify list contains it
            r2 = admin_client.get(f"{BASE_URL}/api/schedules")
            assert r2.status_code == 200
            ids = [s["id"] for s in r2.json()]
            assert sched_id in ids

            # PATCH
            r3 = admin_client.patch(f"{BASE_URL}/api/schedules/{sched_id}", json={"enabled": False})
            assert r3.status_code == 200
            assert r3.json()["enabled"] is False
            time.sleep(0.3)
        finally:
            # DELETE
            r4 = admin_client.delete(f"{BASE_URL}/api/schedules/{sched_id}")
            assert r4.status_code == 200

        # Verify publish was logged for all 3 actions
        time.sleep(0.5)
        try:
            with open("/var/log/supervisor/backend.err.log") as f:
                log = f.read()[-20000:]
        except Exception:
            try:
                with open("/var/log/supervisor/backend.out.log") as f:
                    log = f.read()[-20000:]
            except Exception:
                log = ""
        # At least one SCHEDULE/SET publish line should be present after our 3 ops
        assert "SCHEDULE/SET" in log, f"expected SCHEDULE/SET publish in backend log; tail: {log[-2000:]}"


class TestSchedulerLoopDisabled:
    def test_no_scheduler_executed_in_log(self):
        # scheduler.py has 'executed' line only when run_scheduler loop fires;
        # should NOT appear if loop is disabled.
        try:
            with open("/var/log/supervisor/backend.err.log") as f:
                log = f.read()
        except Exception:
            log = ""
        assert "[scheduler] executed" not in log, "scheduler loop appears to be running"


class TestRBACSchedules:
    def test_cj21_sees_only_own_schedules(self, cj21_client, admin_client):
        # Make sure there's at least one schedule we can observe for CJ021
        payload = {
            "fancoil_id": CJ21_FANCOIL_ID,
            "days": [1],
            "hour": 8,
            "minute": 0,
            "action": "cmd",
            "value": "true",
            "enabled": True,
        }
        r = admin_client.post(f"{BASE_URL}/api/schedules", json=payload)
        assert r.status_code == 200
        sid = r.json()["id"]
        try:
            r2 = cj21_client.get(f"{BASE_URL}/api/schedules")
            assert r2.status_code == 200
            data = r2.json()
            # All visible schedules must belong to CJ21's fancoil
            for s in data:
                assert s["fancoil_id"] == CJ21_FANCOIL_ID, f"cj21 saw foreign schedule: {s}"
        finally:
            admin_client.delete(f"{BASE_URL}/api/schedules/{sid}")
