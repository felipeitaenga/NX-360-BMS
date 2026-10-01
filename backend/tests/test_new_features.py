"""Backend tests for iteration-2 features:
- Password reset (forgot + reset)
- Schedules CRUD + role permissions
- Heatmap endpoint
"""
import os
import time
import hashlib
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient
from bson import ObjectId

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://fancoil-monitoring.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "pilares_hvac")

ADMIN_EMAIL = "felipejferreira@gmail.com"
# Try these passwords in order
ADMIN_PWDS = ["NovaSenha123", "Admin@123"]

STATE = {}


def _bearer(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def db():
    client = MongoClient(MONGO_URL)
    return client[DB_NAME]


@pytest.fixture(scope="module", autouse=True)
def login_admin():
    for pwd in ADMIN_PWDS:
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": pwd})
        if r.status_code == 200:
            STATE["admin_token"] = r.json()["access_token"]
            STATE["admin_pwd"] = pwd
            return
    pytest.fail("Admin login failed")


# ============== PASSWORD RESET ==============
class TestPasswordReset:
    def test_forgot_registered_email_returns_generic(self, db):
        # Reset rate-limit tracking collection to isolate this test
        db.password_reset_requests.delete_many({"email": ADMIN_EMAIL})
        before = db.password_reset_tokens.count_documents({"email": ADMIN_EMAIL})
        r = requests.post(f"{API}/auth/forgot-password", json={"email": ADMIN_EMAIL})
        assert r.status_code == 200
        body = r.json()
        assert "message" in body
        STATE["forgot_body_registered"] = body
        time.sleep(0.5)
        after = db.password_reset_tokens.count_documents({"email": ADMIN_EMAIL})
        assert after > before, "Token should be inserted for registered email"

    def test_forgot_unknown_email_returns_same_body(self):
        r = requests.post(f"{API}/auth/forgot-password", json={"email": "nope_xyz@nowhere.com"})
        assert r.status_code == 200
        assert r.json() == STATE["forgot_body_registered"], "Response must be identical to avoid leaks"

    def test_forgot_no_token_for_unknown_email(self, db):
        c = db.password_reset_tokens.count_documents({"email": "nope_xyz@nowhere.com"})
        assert c == 0

    def test_forgot_rate_limit_does_not_break(self):
        # 6 additional calls (>5 in 15 min); all must still return 200
        for i in range(6):
            r = requests.post(f"{API}/auth/forgot-password", json={"email": ADMIN_EMAIL})
            assert r.status_code == 200

    def test_reset_invalid_token_returns_400(self):
        r = requests.post(f"{API}/auth/reset-password",
                          json={"token": "notavalidtoken_xyz", "new_password": "AnotherPass123"})
        assert r.status_code == 400

    def test_reset_full_flow_with_injected_token(self, db):
        # Inject a known raw token
        raw = f"TESTTOKEN_{int(time.time())}"
        token_hash = hashlib.sha256(raw.encode()).hexdigest()
        user = db.users.find_one({"email": ADMIN_EMAIL})
        assert user is not None
        now = datetime.now(timezone.utc)
        db.password_reset_tokens.insert_one({
            "token_hash": token_hash,
            "user_id": str(user["_id"]),
            "email": ADMIN_EMAIL,
            "expires_at": now + timedelta(hours=1),
            "used": False,
        })

        new_pwd = "ResetPwd_" + str(int(time.time()))
        r = requests.post(f"{API}/auth/reset-password",
                          json={"token": raw, "new_password": new_pwd})
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        # Token now marked used=True
        doc = db.password_reset_tokens.find_one({"token_hash": token_hash})
        assert doc is not None
        assert doc.get("used") is True

        # Login with new password works
        r2 = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": new_pwd})
        assert r2.status_code == 200, r2.text

        # Reset back to NovaSenha123 to leave state clean
        raw2 = f"TESTTOKEN2_{int(time.time())}"
        th2 = hashlib.sha256(raw2.encode()).hexdigest()
        db.password_reset_tokens.insert_one({
            "token_hash": th2,
            "user_id": str(user["_id"]),
            "email": ADMIN_EMAIL,
            "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
            "used": False,
        })
        r3 = requests.post(f"{API}/auth/reset-password",
                          json={"token": raw2, "new_password": "NovaSenha123"})
        assert r3.status_code == 200
        # Re-login and refresh admin token for subsequent test modules
        r4 = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "NovaSenha123"})
        assert r4.status_code == 200
        STATE["admin_token"] = r4.json()["access_token"]


# ============== SCHEDULES ==============
class TestSchedules:
    def _get_fancoil(self):
        r = requests.get(f"{API}/fancoils", headers=_bearer(STATE["admin_token"]))
        assert r.status_code == 200
        fcs = r.json()
        assert len(fcs) > 0
        return fcs[0]

    def test_create_schedule(self, db):
        fc = self._get_fancoil()
        STATE["fancoil_id"] = fc["id"]
        payload = {
            "fancoil_id": fc["id"],
            "days": [1, 2, 3, 4, 5],
            "hour": 7,
            "minute": 30,
            "action": "cmd",
            "value": "true",
            "enabled": True,
        }
        r = requests.post(f"{API}/schedules", json=payload, headers=_bearer(STATE["admin_token"]))
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["fancoil_id"] == fc["id"]
        assert j["days"] == [1, 2, 3, 4, 5]
        assert j["action"] == "cmd"
        assert j["value"] == "true"
        assert j["enabled"] is True
        assert "id" in j
        STATE["schedule_id"] = j["id"]

    def test_list_schedules(self):
        r = requests.get(f"{API}/schedules/{STATE['fancoil_id']}",
                         headers=_bearer(STATE["admin_token"]))
        assert r.status_code == 200
        lst = r.json()
        assert any(s["id"] == STATE["schedule_id"] for s in lst)

    def test_toggle_enabled(self):
        r = requests.patch(f"{API}/schedules/{STATE['schedule_id']}",
                           json={"enabled": False},
                           headers=_bearer(STATE["admin_token"]))
        assert r.status_code == 200
        assert r.json()["enabled"] is False

    def test_delete_schedule(self):
        r = requests.delete(f"{API}/schedules/{STATE['schedule_id']}",
                            headers=_bearer(STATE["admin_token"]))
        assert r.status_code == 200
        # verify removed
        r2 = requests.get(f"{API}/schedules/{STATE['fancoil_id']}",
                         headers=_bearer(STATE["admin_token"]))
        assert all(s["id"] != STATE["schedule_id"] for s in r2.json())

    def test_viewer_cannot_create_schedule(self):
        # Create viewer
        viewer_email = f"TEST_viewer_{int(time.time())}@test.com"
        viewer_pwd = "ViewerPwd123"
        r = requests.post(f"{API}/users",
                          json={"name": "T Viewer", "email": viewer_email, "password": viewer_pwd, "role": "viewer"},
                          headers=_bearer(STATE["admin_token"]))
        assert r.status_code in (200, 201), r.text
        vid = r.json()["id"]
        STATE["viewer_id"] = vid
        # grant permission to fancoil
        rp = requests.put(f"{API}/permissions",
                          json={"user_id": vid, "modules": ["fancoils"], "fancoil_ids": [STATE["fancoil_id"]]},
                          headers=_bearer(STATE["admin_token"]))
        assert rp.status_code == 200
        # login viewer
        rl = requests.post(f"{API}/auth/login", json={"email": viewer_email, "password": viewer_pwd})
        assert rl.status_code == 200
        vt = rl.json()["access_token"]
        STATE["viewer_token"] = vt
        # viewer tries to create schedule
        r = requests.post(f"{API}/schedules",
                          json={"fancoil_id": STATE["fancoil_id"], "days": [], "hour": 8, "minute": 0,
                                "action": "cmd", "value": "false"},
                          headers=_bearer(vt))
        assert r.status_code == 403

    def test_cleanup_viewer(self):
        if STATE.get("viewer_id"):
            requests.delete(f"{API}/users/{STATE['viewer_id']}",
                            headers=_bearer(STATE["admin_token"]))


# ============== HEATMAP ==============
class TestHeatmap:
    def test_heatmap_admin(self):
        r = requests.get(f"{API}/heatmap", headers=_bearer(STATE["admin_token"]))
        assert r.status_code == 200
        cells = r.json()
        assert isinstance(cells, list)
        assert len(cells) == 32, f"Expected 32 cells, got {len(cells)}"
        for c in cells:
            assert "temperature" in c
            assert "setpoint" in c
            assert "status" in c
            assert "online" in c
            assert "name" in c

    def test_heatmap_viewer_no_perms_empty(self):
        # Create a viewer without any fancoil permissions
        vemail = f"TEST_viewer_nop_{int(time.time())}@test.com"
        vpwd = "V123456"
        r = requests.post(f"{API}/users",
                          json={"name": "V NoPerm", "email": vemail, "password": vpwd, "role": "viewer"},
                          headers=_bearer(STATE["admin_token"]))
        assert r.status_code in (200, 201)
        vid = r.json()["id"]
        try:
            rl = requests.post(f"{API}/auth/login", json={"email": vemail, "password": vpwd})
            vt = rl.json()["access_token"]
            rh = requests.get(f"{API}/heatmap", headers=_bearer(vt))
            assert rh.status_code == 200
            assert rh.json() == []
        finally:
            requests.delete(f"{API}/users/{vid}", headers=_bearer(STATE["admin_token"]))
