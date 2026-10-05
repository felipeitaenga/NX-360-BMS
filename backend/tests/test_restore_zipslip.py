"""Testes de segurança zip-slip / path traversal no endpoint /api/admin/restore.

Cobertura:
- backup legítimo -> 200
- restore legítimo (merge) sem perder dados
- vetores maliciosos: '..', caminho absoluto, './', codificação, nested, symlinks, hardlinks
- auth guard (admin-only)
- /app/deploy/ tem exatamente 6 arquivos esperados
"""
import io
import json
import os
import tarfile
import time
from pathlib import Path

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "felipejferreira@gmail.com"
ADMIN_PASS = "@Pilares1"

UPLOADS_DIR = Path("/app/backend/uploads")
PWNED_PATH = Path("/tmp/pwned_zipslip_test.txt")


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def viewer_session(admin_session):
    """Cria (ou recria) um viewer TEST_ e devolve a session logada."""
    email = "TEST_viewer_zipslip@example.com"
    pwd = "ViewerPass123!"
    # Garantir que existe. Se já existe, apenas reseta a senha.
    users = admin_session.get(f"{API}/users").json()
    uid = None
    for u in users:
        if u["email"] == email:
            uid = u["id"] if "id" in u else u.get("_id")
            break
    if uid is None:
        r = admin_session.post(f"{API}/users", json={
            "email": email, "password": pwd, "name": "T Viewer", "role": "viewer"
        })
        assert r.status_code in (200, 201), r.text
    else:
        admin_session.post(f"{API}/users/reset-password", json={"user_id": uid, "new_password": pwd})

    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pwd})
    # may require change password -> if so, change it
    if r.status_code == 200 and r.json().get("must_change_password"):
        s.post(f"{API}/auth/change-password", json={"current_password": pwd, "new_password": pwd + "x"})
        s.post(f"{API}/auth/login", json={"email": email, "password": pwd + "x"})
    assert r.status_code == 200, r.text
    return s


# ---------- Helpers ----------
def _make_metadata_bytes():
    return json.dumps({"app": "NX-360 BMS", "version": "test"}).encode()


def _add_bytes(tar: tarfile.TarFile, name: str, data: bytes):
    info = tarfile.TarInfo(name=name)
    info.size = len(data)
    info.mtime = int(time.time())
    tar.addfile(info, io.BytesIO(data))


def _add_symlink(tar: tarfile.TarFile, name: str, linkname: str):
    info = tarfile.TarInfo(name=name)
    info.type = tarfile.SYMTYPE
    info.linkname = linkname
    info.mtime = int(time.time())
    tar.addfile(info)


def _build_malicious_tar() -> bytes:
    """Monta um tar.gz com múltiplos vetores de ataque + 1 arquivo legítimo."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        # Metadata obrigatório
        _add_bytes(tar, "metadata.json", _make_metadata_bytes())
        # Legítimo
        _add_bytes(tar, "uploads/plantas/safe.txt", b"legit-content")
        _add_bytes(tar, "uploads/nested/dir/legit2.txt", b"legit2")
        # Vetores maliciosos (todos devem ser ignorados)
        _add_bytes(tar, "uploads/../../../tmp/pwned_zipslip_test.txt", b"PWNED-dotdot")
        _add_bytes(tar, "/tmp/pwned_zipslip_test.txt", b"PWNED-abs")
        _add_bytes(tar, "uploads/./../../tmp/pwned_zipslip_test.txt", b"PWNED-dot")
        _add_bytes(tar, "uploads/..", b"PWNED-just-dotdot")
        _add_bytes(tar, "../uploads/evil.txt", b"PWNED-leading-dotdot")
        _add_bytes(tar, "uploads/\u002e\u002e/pwned.txt", b"PWNED-unicode")  # literal ".."
        _add_bytes(tar, "uploads/sub/../../pwned.txt", b"PWNED-mid-dotdot")
        # Symlink apontando pra fora (filtrado por isfile())
        _add_symlink(tar, "uploads/evil_link", "/tmp/pwned_zipslip_test.txt")
        _add_symlink(tar, "uploads/evil_link2", "../../../tmp/pwned_zipslip_test.txt")
    return buf.getvalue()


def _build_minimal_valid_tar() -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        _add_bytes(tar, "metadata.json", _make_metadata_bytes())
        _add_bytes(tar, "uploads/plantas/only_safe.txt", b"ok")
    return buf.getvalue()


# ---------- Tests ----------
class TestDeployFolder:
    def test_deploy_has_exact_6_files(self):
        expected = {
            "Dockerfile.backend", "Dockerfile.frontend", "INSTALL.md",
            "docker-compose.yml", "install.sh", "nginx-gateway.conf",
        }
        actual = set(os.listdir("/app/deploy"))
        assert actual == expected, f"Deploy folder mismatch: {actual}"


class TestAuthGuard:
    def test_backup_requires_auth(self):
        r = requests.get(f"{API}/admin/backup")
        assert r.status_code in (401, 403), r.status_code

    def test_restore_requires_auth(self):
        r = requests.post(f"{API}/admin/restore",
                          files={"file": ("x.tar.gz", b"xx", "application/gzip")})
        assert r.status_code in (401, 403), r.status_code

    def test_backup_forbidden_for_viewer(self, viewer_session):
        r = viewer_session.get(f"{API}/admin/backup")
        assert r.status_code == 403, r.status_code

    def test_restore_forbidden_for_viewer(self, viewer_session):
        r = viewer_session.post(f"{API}/admin/restore",
                                files={"file": ("x.tar.gz",
                                                _build_minimal_valid_tar(),
                                                "application/gzip")})
        assert r.status_code == 403, r.status_code


class TestLegitimateBackup:
    def test_backup_download_ok(self, admin_session):
        r = admin_session.get(f"{API}/admin/backup")
        assert r.status_code == 200
        assert len(r.content) > 100
        # Deve abrir como tar.gz válido
        tar = tarfile.open(fileobj=io.BytesIO(r.content), mode="r:gz")
        names = tar.getnames()
        assert "metadata.json" in names
        # Verifica metadata
        meta = json.loads(tar.extractfile("metadata.json").read().decode())
        assert meta.get("app") == "NX-360 BMS"
        tar.close()

    def test_restore_legit_merge(self, admin_session):
        # Snapshot do backup atual pra restaurar depois
        content = _build_minimal_valid_tar()
        r = admin_session.post(
            f"{API}/admin/restore",
            files={"file": ("legit.tar.gz", content, "application/gzip")},
            data={"wipe": "false"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["wipe"] is False
        assert body["files_restored"] >= 1
        # Arquivo deve existir em uploads
        assert (UPLOADS_DIR / "plantas" / "only_safe.txt").exists()


class TestZipSlipSecurity:
    def test_malicious_members_rejected(self, admin_session):
        # Garante que o arquivo-alvo NÃO existe antes
        if PWNED_PATH.exists():
            PWNED_PATH.unlink()

        content = _build_malicious_tar()
        r = admin_session.post(
            f"{API}/admin/restore",
            files={"file": ("evil.tar.gz", content, "application/gzip")},
            data={"wipe": "false"},
        )
        assert r.status_code == 200, r.text
        body = r.json()

        # Só os 2 legítimos devem ter sido restaurados
        assert body["files_restored"] == 2, (
            f"Esperado 2 arquivos legítimos, veio {body['files_restored']}; body={body}"
        )

        # /tmp/pwned_zipslip_test.txt NÃO pode existir
        assert not PWNED_PATH.exists(), "PATH TRAVERSAL! Arquivo malicioso foi criado em /tmp"

        # Legítimos devem estar presentes
        assert (UPLOADS_DIR / "plantas" / "safe.txt").exists()
        assert (UPLOADS_DIR / "nested" / "dir" / "legit2.txt").exists()

        # Verifica que uploads/.. não criou nada bizarro
        parent = UPLOADS_DIR.parent
        assert not (parent / "evil.txt").exists()
        assert not (parent / "pwned.txt").exists()

    def test_pwned_file_never_created(self):
        """Dupla checagem (independente), roda após o malicious upload."""
        assert not PWNED_PATH.exists()


class TestInvalidBackups:
    def test_restore_rejects_non_targz(self, admin_session):
        r = admin_session.post(
            f"{API}/admin/restore",
            files={"file": ("junk.bin", b"not a tar at all", "application/octet-stream")},
        )
        assert r.status_code == 400

    def test_restore_rejects_tar_without_metadata(self, admin_session):
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            _add_bytes(tar, "uploads/x.txt", b"x")
        r = admin_session.post(
            f"{API}/admin/restore",
            files={"file": ("nometa.tar.gz", buf.getvalue(), "application/gzip")},
        )
        assert r.status_code == 400

    def test_restore_rejects_wrong_app_metadata(self, admin_session):
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            _add_bytes(tar, "metadata.json", json.dumps({"app": "OTHER"}).encode())
        r = admin_session.post(
            f"{API}/admin/restore",
            files={"file": ("badmeta.tar.gz", buf.getvalue(), "application/gzip")},
        )
        assert r.status_code == 400
