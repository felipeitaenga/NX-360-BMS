"""
Iteration 15 — Topic→Variable mapping tests (admin).
Covers CRUD on /api/admin/topic-mappings, 403 for viewer, duplicate 400,
sniff-based routing verification for /A100/TEMPERATURA.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://fancoil-monitoring.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "felipejferreira@gmail.com"
ADMIN_PASS = "@Pilares1"

TEST_TOPIC_UNIQUE = "/TESTE_RETEST15/XYZ"  # unique synthetic topic (never published) for CRUD
A100_TOPIC = "/A100/TEMPERATURA"  # real published topic for routing verification


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def viewer_session(admin_session):
    """Create a viewer user and log in. Skip if cannot provision."""
    s = requests.Session()
    # Try to create viewer
    email = "TEST_viewer_iter15@example.com"
    pw = "ViewerPass@123"
    r = admin_session.post(f"{BASE_URL}/api/users", json={
        "email": email, "password": pw, "role": "viewer", "name": "Viewer15"
    }, timeout=15)
    if r.status_code not in (200, 201, 400):
        pytest.skip(f"Cannot provision viewer: {r.status_code} {r.text}")
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=15)
    if r.status_code != 200:
        pytest.skip(f"Viewer login failed: {r.status_code}")
    return s


@pytest.fixture(scope="module", autouse=True)
def cleanup_before_after(admin_session):
    # Pre-clean any existing mappings for our test topics
    def _delete_topic(topic):
        r = admin_session.get(f"{BASE_URL}/api/admin/topic-mappings", timeout=10)
        if r.status_code == 200:
            for m in r.json():
                if m.get("topic") == topic:
                    admin_session.delete(f"{BASE_URL}/api/admin/topic-mappings/{m['id']}", timeout=10)

    _delete_topic(TEST_TOPIC_UNIQUE)
    yield
    _delete_topic(TEST_TOPIC_UNIQUE)


class TestTopicMappingsCRUD:
    created_id = None

    def test_01_list_initial(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/topic-mappings", timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        # Verify sorted ascending by topic
        topics = [m["topic"] for m in data]
        assert topics == sorted(topics), f"Not sorted: {topics}"

    def test_02_create_valid(self, admin_session):
        payload = {"topic": TEST_TOPIC_UNIQUE, "target_device_id": "A100", "target_var": "TEMPERATURA"}
        r = admin_session.post(f"{BASE_URL}/api/admin/topic-mappings", json=payload, timeout=10)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        d = r.json()
        assert d["topic"] == TEST_TOPIC_UNIQUE
        assert d["target_device_id"] == "A100"
        assert d["target_var"] == "TEMPERATURA"
        assert d["enabled"] is True
        assert "id" in d
        TestTopicMappingsCRUD.created_id = d["id"]

    def test_03_create_duplicate_returns_400(self, admin_session):
        payload = {"topic": TEST_TOPIC_UNIQUE, "target_device_id": "A100", "target_var": "TEMPERATURA"}
        r = admin_session.post(f"{BASE_URL}/api/admin/topic-mappings", json=payload, timeout=10)
        assert r.status_code == 400, f"expected 400 got {r.status_code} {r.text}"

    def test_04_viewer_forbidden(self, viewer_session):
        r = viewer_session.post(f"{BASE_URL}/api/admin/topic-mappings",
                                json={"topic": "/VIEWER/X", "target_device_id": "A100", "target_var": "TEMPERATURA"},
                                timeout=10)
        assert r.status_code in (401, 403), f"viewer should be blocked, got {r.status_code}"
        r2 = viewer_session.get(f"{BASE_URL}/api/admin/topic-mappings", timeout=10)
        assert r2.status_code in (401, 403)

    def test_05_patch_toggle_and_target(self, admin_session):
        mid = TestTopicMappingsCRUD.created_id
        assert mid, "needs prior create"
        # Toggle enabled=False
        r = admin_session.patch(f"{BASE_URL}/api/admin/topic-mappings/{mid}", json={"enabled": False}, timeout=10)
        assert r.status_code == 200
        assert r.json()["enabled"] is False
        # Change target_var and re-enable
        r = admin_session.patch(f"{BASE_URL}/api/admin/topic-mappings/{mid}",
                                json={"enabled": True, "target_var": "VAG"}, timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d["enabled"] is True
        assert d["target_var"] == "VAG"
        # Verify via GET list
        r = admin_session.get(f"{BASE_URL}/api/admin/topic-mappings", timeout=10)
        found = [m for m in r.json() if m["id"] == mid]
        assert found and found[0]["target_var"] == "VAG"

    def test_06_delete_mapping(self, admin_session):
        mid = TestTopicMappingsCRUD.created_id
        r = admin_session.delete(f"{BASE_URL}/api/admin/topic-mappings/{mid}", timeout=10)
        assert r.status_code == 200
        # Verify gone
        r = admin_session.get(f"{BASE_URL}/api/admin/topic-mappings", timeout=10)
        assert not any(m["id"] == mid for m in r.json())
        # Delete again -> 404
        r = admin_session.delete(f"{BASE_URL}/api/admin/topic-mappings/{mid}", timeout=10)
        assert r.status_code == 404


class TestTopicMappingRouting:
    """Validate that a mapping actually routes irregular topics in sniff + fancoils."""

    def test_07_mapping_routes_to_sniff_and_fancoil(self, admin_session):
        # Ensure a mapping for /A100/TEMPERATURA exists (recreate if cleaned)
        r = admin_session.get(f"{BASE_URL}/api/admin/topic-mappings", timeout=10)
        existing = [m for m in r.json() if m["topic"] == A100_TOPIC]
        if existing:
            mid = existing[0]["id"]
            # Make sure enabled + correct target
            admin_session.patch(f"{BASE_URL}/api/admin/topic-mappings/{mid}",
                                json={"enabled": True, "target_device_id": "A100", "target_var": "TEMPERATURA"},
                                timeout=10)
        else:
            r = admin_session.post(f"{BASE_URL}/api/admin/topic-mappings",
                                   json={"topic": A100_TOPIC, "target_device_id": "A100", "target_var": "TEMPERATURA"},
                                   timeout=10)
            assert r.status_code == 200, r.text

        # Wait for ESP32 to publish (~15s cadence); allow up to 60s
        mapped_event = None
        for _ in range(12):
            time.sleep(5)
            r = admin_session.get(f"{BASE_URL}/api/admin/mqtt/sniff/A100", timeout=10)
            if r.status_code != 200:
                continue
            events = r.json() if isinstance(r.json(), list) else r.json().get("events", [])
            for ev in events:
                if ev.get("mapped_from") == A100_TOPIC and ev.get("var") == "TEMPERATURA":
                    mapped_event = ev
                    break
            if mapped_event:
                break

        if not mapped_event:
            pytest.skip("No mapped event observed in 60s (ESP32 A100 may not be publishing).")
        assert mapped_event["var"] == "TEMPERATURA"
        assert mapped_event["mapped_from"] == A100_TOPIC

    def test_08_fancoil_cj031_online_with_temp(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/fancoils", timeout=10)
        assert r.status_code == 200
        fancoils = r.json()
        cj031 = next((f for f in fancoils if f.get("device_id") == "A100" or f.get("name") == "CJ031"), None)
        if not cj031:
            pytest.skip("CJ031/A100 not found in fancoils list")
        # After mapping, CJ031 should be online with temperature set
        # Not asserting hard (depends on live broker) but reporting
        print(f"CJ031 online={cj031.get('online')} temperature={cj031.get('temperature')}")
        assert cj031.get("temperature") is not None, "CJ031 has no temperature after mapping"
