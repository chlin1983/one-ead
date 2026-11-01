"""Automated regression test suite for Phase 2 security hardening.

Verifies:
Priority 1: WeKnora executable integrity verification & fail-closed execution before subprocess.Popen.
Priority 2: Disable automatic Paperless vault scanning & WeKnora synchronization by default (explicit user approval).
Priority 3: Reproducible, hash-verified Python dependency management (requirements.lock, verify_lockfile_integrity).
Priority 4: Windows security and permissions for portal tokens, setup tokens, replay store, and service logs (fail-closed).
Priority 5: Normal startup never silently installs dependencies automatically.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from server.app import create_app
from server.security import (
    DATA_DIR,
    SESSION_COOKIE_NAME,
    TOKEN_FILE,
    _claim_nonce,
    _replay_dir,
    get_portal_token,
    secure_path_permissions,
)
from server.check_deps import (
    LOCK_FILE,
    REQUIREMENTS_FILE,
    STAMP_FILE,
    _compute_signature,
    ensure_dependencies,
    mark_verified,
    verify_installed_against_lock,
    verify_lockfile_integrity,
)
from modules.weknora import manager as weknora_manager
from modules.paperless_ngx import manager as paperless_manager


@pytest.fixture
def auth_client():
    app = create_app()
    token = get_portal_token()
    return TestClient(app, base_url="http://127.0.0.1:8100", cookies={SESSION_COOKIE_NAME: token})


# ==============================================================================
# Priority 1: WeKnora Executable Integrity Verification
# ==============================================================================

def test_manager_verifies_primary_binary_sha256(tmp_path, monkeypatch):
    primary = tmp_path / "WeKnora-lite.exe"
    data = b"synthetic-primary-exe"
    primary.write_bytes(data)
    digest = hashlib.sha256(data).hexdigest()

    monkeypatch.setattr(weknora_manager, "BINARY_PATH", primary)
    monkeypatch.setattr(weknora_manager, "FALLBACK_BINARY_PATH", tmp_path / "nonexistent.exe")
    monkeypatch.setenv("WEKNORA_RELEASE_SHA256", digest)

    res = weknora_manager.verify_binary_integrity(primary)
    assert res["ok"] is True
    assert res["verified"] is True


def test_manager_verifies_fallback_binary_sha256(tmp_path, monkeypatch):
    fallback = tmp_path / "fallback" / "WeKnora-lite.exe"
    fallback.parent.mkdir(parents=True, exist_ok=True)
    data = b"synthetic-fallback-exe"
    fallback.write_bytes(data)
    digest = hashlib.sha256(data).hexdigest()

    monkeypatch.setattr(weknora_manager, "BINARY_PATH", tmp_path / "no-primary.exe")
    monkeypatch.setattr(weknora_manager, "FALLBACK_BINARY_PATH", fallback)
    monkeypatch.setenv("WEKNORA_RELEASE_SHA256", digest)

    res = weknora_manager.verify_binary_integrity(fallback)
    assert res["ok"] is True
    assert res["verified"] is True


def test_manager_start_service_fails_closed_on_tampered_binary(tmp_path, monkeypatch):
    primary = tmp_path / "WeKnora-lite.exe"
    primary.write_bytes(b"tampered-binary-data")
    good_digest = hashlib.sha256(b"original-data").hexdigest()

    monkeypatch.setattr(weknora_manager, "BINARY_PATH", primary)
    monkeypatch.setattr(weknora_manager, "FALLBACK_BINARY_PATH", tmp_path / "no-fb.exe")
    monkeypatch.setenv("WEKNORA_RELEASE_SHA256", good_digest)
    monkeypatch.setattr(weknora_manager, "check_http_alive", lambda *a: False)
    monkeypatch.setattr(weknora_manager, "check_port", lambda *a: False)

    mock_popen = MagicMock()
    monkeypatch.setattr(weknora_manager.subprocess, "Popen", mock_popen)

    with pytest.raises(RuntimeError, match="WeKnora executable integrity verification failed"):
        weknora_manager.start_service()

    mock_popen.assert_not_called()


def test_manager_start_service_fails_closed_without_pinned_digest(tmp_path, monkeypatch):
    primary = tmp_path / "WeKnora-lite.exe"
    primary.write_bytes(b"some-exe-binary")

    monkeypatch.setattr(weknora_manager, "BINARY_PATH", primary)
    monkeypatch.setattr(weknora_manager, "FALLBACK_BINARY_PATH", tmp_path / "no-fb.exe")
    monkeypatch.delenv("WEKNORA_RELEASE_SHA256", raising=False)
    monkeypatch.delenv("WEKNORA_ACCEPT_LOCAL_BUILD_SHA256", raising=False)
    monkeypatch.setattr(weknora_manager, "check_http_alive", lambda *a: False)
    monkeypatch.setattr(weknora_manager, "check_port", lambda *a: False)

    mock_popen = MagicMock()
    monkeypatch.setattr(weknora_manager.subprocess, "Popen", mock_popen)

    with pytest.raises(RuntimeError, match="integrity verification failed"):
        weknora_manager.start_service()

    mock_popen.assert_not_called()


def test_manager_start_service_fails_closed_on_tampered_fallback(tmp_path, monkeypatch):
    fallback = tmp_path / "WeKnora" / "WeKnora-lite.exe"
    fallback.parent.mkdir(parents=True, exist_ok=True)
    fallback.write_bytes(b"tampered-fallback-data")
    good_digest = hashlib.sha256(b"original-fb-data").hexdigest()

    monkeypatch.setattr(weknora_manager, "BINARY_PATH", tmp_path / "no-prim.exe")
    monkeypatch.setattr(weknora_manager, "FALLBACK_BINARY_PATH", fallback)
    monkeypatch.setenv("WEKNORA_RELEASE_SHA256", good_digest)
    monkeypatch.setattr(weknora_manager, "check_http_alive", lambda *a: False)
    monkeypatch.setattr(weknora_manager, "check_port", lambda *a: False)

    mock_popen = MagicMock()
    monkeypatch.setattr(weknora_manager.subprocess, "Popen", mock_popen)

    with pytest.raises(RuntimeError, match="integrity verification failed"):
        weknora_manager.start_service()

    mock_popen.assert_not_called()


def test_manager_start_service_success_when_hash_verified(tmp_path, monkeypatch):
    monkeypatch.setattr(weknora_manager, "_process", None)
    primary = tmp_path / "WeKnora-lite.exe"
    data = b"synthetic-verified-primary-exe"
    primary.write_bytes(data)
    digest = hashlib.sha256(data).hexdigest()

    monkeypatch.setattr(weknora_manager, "BINARY_PATH", primary)
    monkeypatch.setattr(weknora_manager, "FALLBACK_BINARY_PATH", tmp_path / "no-fb.exe")
    monkeypatch.setenv("WEKNORA_RELEASE_SHA256", digest)
    monkeypatch.setattr(weknora_manager, "check_http_alive", lambda *a: False)
    monkeypatch.setattr(weknora_manager, "check_port", lambda *a: False)
    monkeypatch.setattr(weknora_manager, "DATA_DIR", tmp_path)
    monkeypatch.setattr(weknora_manager, "secure_path_permissions", lambda *a, **k: True)

    fake_proc = MagicMock()
    fake_proc.poll.return_value = None
    mock_popen = MagicMock(return_value=fake_proc)
    monkeypatch.setattr(weknora_manager.subprocess, "Popen", mock_popen)

    weknora_manager.start_service()
    mock_popen.assert_called_once()


def test_status_reports_verified_flag(tmp_path, monkeypatch):
    primary = tmp_path / "WeKnora-lite.exe"
    data = b"synthetic-verified-primary-exe"
    primary.write_bytes(data)
    digest = hashlib.sha256(data).hexdigest()

    monkeypatch.setattr(weknora_manager, "BINARY_PATH", primary)
    monkeypatch.setattr(weknora_manager, "FALLBACK_BINARY_PATH", tmp_path / "no-fb.exe")
    monkeypatch.setenv("WEKNORA_RELEASE_SHA256", digest)

    st = weknora_manager.status()
    assert st["verified"] is True


# ==============================================================================
# Priority 2: Paperless Vault Scanning & WeKnora Sync Default Opt-in
# ==============================================================================

def test_vault_watcher_not_started_by_default(monkeypatch):
    assert os.environ.get("ONEEAD_ENABLE_VAULT_WATCHER") is None
    assert paperless_manager._watcher_thread is None or not paperless_manager._watcher_thread.is_alive()


def test_copy_to_weknora_vault_fails_closed_without_approval():
    with pytest.raises(PermissionError, match="without explicit user approval"):
        paperless_manager.copy_to_weknora_vault("test-doc-id", approved=False)


def test_process_document_ocr_defaults_to_no_weknora_sync(tmp_path, monkeypatch):
    mock_copy = MagicMock()
    fake_doc_file = tmp_path / "a.txt"
    fake_doc_file.write_text("Hello OCR test", encoding="utf-8")

    monkeypatch.setattr(paperless_manager, "copy_to_weknora_vault", mock_copy)
    monkeypatch.setattr(paperless_manager, "get_documents_dir", lambda: tmp_path)
    monkeypatch.setattr(paperless_manager, "get_ocr_cache_dir", lambda: tmp_path)
    monkeypatch.setattr(paperless_manager, "get_or_create_preview_pdf", lambda *a: None)
    monkeypatch.setattr(paperless_manager, "get_or_create_thumbnail", lambda *a: None)
    monkeypatch.setattr(paperless_manager.ocr_engine, "extract_and_ocr_document", lambda *a, **k: ("# Title\nContent", 1, 0))
    monkeypatch.setattr(paperless_manager, "get_document", lambda *a: {"id": "d1", "filename": "a.txt", "category": "General", "original_name": "a.txt", "tags": ""})

    fake_cur = MagicMock()
    fake_con = MagicMock()
    fake_con.cursor.return_value = fake_cur
    fake_con.__enter__.return_value = fake_con
    fake_con.__exit__.return_value = None
    monkeypatch.setattr(paperless_manager, "get_db_connection", lambda: fake_con)

    res = paperless_manager.process_document_ocr("d1", auto_sync_weknora=False)
    mock_copy.assert_not_called()


def test_upload_document_defaults_to_no_weknora_sync(monkeypatch):
    mock_copy = MagicMock()
    monkeypatch.setattr(paperless_manager, "copy_to_weknora_vault", mock_copy)
    mock_ocr = MagicMock(return_value={"id": "d1"})
    monkeypatch.setattr(paperless_manager, "process_document_ocr", mock_ocr)

    doc = paperless_manager.save_uploaded_document(
        filename="test.txt",
        file_bytes=b"dummy test content",
        auto_ocr=True,
    )
    mock_ocr.assert_called_once()
    _, kwargs = mock_ocr.call_args
    assert kwargs.get("auto_sync_weknora") is False
    mock_copy.assert_not_called()


def test_scan_and_sync_vault_defaults_to_no_weknora_sync(tmp_path, monkeypatch):
    mock_copy = MagicMock()
    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    monkeypatch.setattr(paperless_manager, "copy_to_weknora_vault", mock_copy)
    monkeypatch.setattr(paperless_manager, "upload_document_to_weknora_kb", MagicMock())
    monkeypatch.setattr(paperless_manager, "init_vault", lambda: None)
    monkeypatch.setattr(paperless_manager, "get_documents_dir", lambda: docs_dir)

    res = paperless_manager.scan_and_sync_vault()
    mock_copy.assert_not_called()


def test_sync_endpoint_requires_explicit_approval_omitted_or_false(auth_client, monkeypatch):
    monkeypatch.setattr(
        paperless_manager,
        "copy_to_weknora_vault",
        lambda doc_id, auto_ocr_if_missing=True, approved=False: (
            {"ok": True} if approved else (_ for _ in ()).throw(PermissionError("Approval required"))
        ),
    )

    # 1. Calling sync endpoint with OMITTED approval defaults to approved=False and fails with 400
    res_omitted = auth_client.post("/api/paperless-ngx/documents/test-123/sync-weknora")
    assert res_omitted.status_code == 400
    assert "explicit user approval" in res_omitted.json()["detail"]

    # 2. Calling sync endpoint with explicit approved=false fails with 400
    res_rejected = auth_client.post("/api/paperless-ngx/documents/test-123/sync-weknora?approved=false")
    assert res_rejected.status_code == 400
    assert "explicit user approval" in res_rejected.json()["detail"]

    # 3. Calling sync endpoint with explicit approved=true succeeds (200)
    res_approved = auth_client.post("/api/paperless-ngx/documents/test-123/sync-weknora?approved=true")
    assert res_approved.status_code == 200
    assert res_approved.json()["ok"] is True


def test_scan_endpoint_explicit_approval_preservation(auth_client, monkeypatch):
    captured_args = {}

    def mock_scan(auto_ocr=False, lang="eng", sync_weknora=False, approved=False):
        captured_args["auto_ocr"] = auto_ocr
        captured_args["lang"] = lang
        captured_args["sync_weknora"] = sync_weknora
        captured_args["approved"] = approved
        return {"ok": True, "scanned": 5, "new_imported": 0}

    monkeypatch.setattr(paperless_manager, "scan_and_sync_vault", mock_scan)

    # 1. Normal scan without WeKnora sync succeeds without requiring approval
    res1 = auth_client.post("/api/paperless-ngx/scan")
    assert res1.status_code == 200
    assert captured_args["sync_weknora"] is False
    assert captured_args["approved"] is False

    # 2. Requesting sync_weknora=true with omitted approved parameter fails closed with 400
    res2 = auth_client.post("/api/paperless-ngx/scan?sync_weknora=true")
    assert res2.status_code == 400
    assert "explicit user approval" in res2.json()["detail"]

    # 3. Requesting sync_weknora=true with approved=false fails closed with 400
    res3 = auth_client.post("/api/paperless-ngx/scan?sync_weknora=true&approved=false")
    assert res3.status_code == 400
    assert "explicit user approval" in res3.json()["detail"]

    # 4. Requesting sync_weknora=true with explicit approved=true succeeds and forwards approved=True
    res4 = auth_client.post("/api/paperless-ngx/scan?sync_weknora=true&approved=true")
    assert res4.status_code == 200
    assert captured_args["sync_weknora"] is True
    assert captured_args["approved"] is True


# ==============================================================================
# Priority 3: Reproducible, Hash-Verified Python Dependency Management
# ==============================================================================

def test_requirements_lock_integrity():
    assert LOCK_FILE.exists(), "requirements.lock must be committed to the repository"
    ok, msg, entries = verify_lockfile_integrity(LOCK_FILE)
    assert ok is True, f"requirements.lock verification failed: {msg}"
    assert len(entries) >= 35

    names = {e["name"].lower() for e in entries}
    for core in ["fastapi", "uvicorn", "python-multipart", "pdfplumber", "pymupdf", "numpy", "scipy", "httpx"]:
        assert core in names, f"Core package {core} missing from requirements.lock"


def test_lockfile_rejects_unpinned_or_range_specifiers(tmp_path):
    bad_lock = tmp_path / "bad.lock"
    bad_lock.write_text(
        "fastapi>=0.110 \\\n    --hash=sha256:7c7c5e2195dfb8f278eb084534e62551fb26fc4957e8417f73db1b7470697ad1\n",
        encoding="utf-8",
    )
    ok, msg, _ = verify_lockfile_integrity(bad_lock)
    assert ok is False
    assert "must be pinned with exact '==' version" in msg


def test_lockfile_rejects_missing_hash(tmp_path):
    bad_lock = tmp_path / "nohash.lock"
    bad_lock.write_text("fastapi==0.135.2\n", encoding="utf-8")
    ok, msg, _ = verify_lockfile_integrity(bad_lock)
    assert ok is False
    assert "missing required --hash verification" in msg


def test_lockfile_rejects_malformed_hash(tmp_path):
    bad_lock = tmp_path / "badhash.lock"
    bad_lock.write_text("fastapi==0.135.2 \\\n    --hash=sha256:not-a-valid-hex-digest\n", encoding="utf-8")
    ok, msg, _ = verify_lockfile_integrity(bad_lock)
    assert ok is False
    assert "Malformed SHA-256" in msg


def test_signature_computation_incorporates_lockfile(tmp_path, monkeypatch):
    monkeypatch.setattr("server.check_deps.LOCK_FILE", tmp_path / "lock.txt")
    (tmp_path / "lock.txt").write_text("initial", encoding="utf-8")
    sig1 = _compute_signature()

    (tmp_path / "lock.txt").write_text("tampered", encoding="utf-8")
    sig2 = _compute_signature()

    assert sig1 != sig2, "Changing lockfile content must invalidate dependency cache signature"


def test_installed_packages_match_lockfile():
    ok, mismatches = verify_installed_against_lock(LOCK_FILE)
    assert ok is True, f"Installed package mismatch with requirements.lock: {mismatches}"


def test_mark_verified_fails_closed_on_lock_mismatch(tmp_path, monkeypatch):
    fake_stamp = tmp_path / ".deps_ok"
    monkeypatch.setattr("server.check_deps.STAMP_FILE", fake_stamp)
    monkeypatch.setattr("server.check_deps.verify_installed_against_lock", lambda p: (False, ["pkg: mismatch"]))

    res = mark_verified()
    assert res is False
    assert not fake_stamp.exists(), "Stamp file must not be written when lockfile mismatch exists"


def test_ensure_dependencies_fails_closed_without_install_missing(monkeypatch):
    monkeypatch.setattr("server.check_deps.is_already_verified", lambda: False)
    monkeypatch.setattr("server.check_deps.get_missing_packages", lambda: [("mock-pkg", "mock", "Mock Package")])

    with patch("server.check_deps.subprocess.run") as mock_run:
        res = ensure_dependencies(install_missing=False)
        assert res is False
        mock_run.assert_not_called()


def test_ensure_dependencies_explicit_install_invokes_require_hashes(monkeypatch):
    monkeypatch.setattr("server.check_deps.is_already_verified", lambda: False)

    state = {"stage": "pre_install"}

    def fake_verify(p):
        if state["stage"] == "pre_install":
            return False, ["mock: mismatch"]
        return True, []

    def fake_missing():
        if state["stage"] == "pre_install":
            return [("mock-pkg", "mock", "Mock Package")]
        return []

    monkeypatch.setattr("server.check_deps.verify_installed_against_lock", fake_verify)
    monkeypatch.setattr("server.check_deps.get_missing_packages", fake_missing)
    monkeypatch.setattr("server.check_deps.mark_verified", lambda: True)

    def fake_run(cmd, *a, **k):
        state["stage"] = "post_install"
        res = MagicMock()
        res.returncode = 0
        return res

    with patch("server.check_deps.subprocess.run", side_effect=fake_run) as mock_run:
        res = ensure_dependencies(install_missing=True)
        assert res is True
        mock_run.assert_called_once()
        cmd_called = mock_run.call_args[0][0]
        assert "--require-hashes" in cmd_called


def test_run_py_requires_explicit_installation():
    run_file = _ROOT / "run.py"
    text = run_file.read_text(encoding="utf-8")
    assert "ensure_dependencies(install_missing=False)" in text, (
        "run.py must call ensure_dependencies with install_missing=False to prevent silent pip installs"
    )


# ==============================================================================
# Priority 4: Windows Security & Permissions for Sensitive Files
# ==============================================================================

def test_secure_path_permissions_on_file(tmp_path):
    f = tmp_path / "secret.key"
    f.write_text("confidential-token", encoding="utf-8")

    ok = secure_path_permissions(f, is_dir=False)
    assert ok is True

    if os.name == "nt":
        res = subprocess.run(["icacls", str(f)], capture_output=True, text=True, check=True)
        assert "BUILTIN\\Users:(I)" not in res.stdout
        assert "NT AUTHORITY\\Authenticated Users:(I)" not in res.stdout


def test_secure_path_permissions_on_directory(tmp_path):
    d = tmp_path / "secure_dir"
    d.mkdir()

    ok = secure_path_permissions(d, is_dir=True)
    assert ok is True

    if os.name == "nt":
        res = subprocess.run(["icacls", str(d)], capture_output=True, text=True, check=True)
        assert "BUILTIN\\Users:(I)" not in res.stdout


def test_portal_token_file_has_secured_permissions():
    token = get_portal_token()
    assert TOKEN_FILE.exists()
    if os.name == "nt":
        res = subprocess.run(["icacls", str(TOKEN_FILE)], capture_output=True, text=True, check=True)
        assert "BUILTIN\\Users:(I)" not in res.stdout
        assert "NT AUTHORITY\\Authenticated Users:(I)" not in res.stdout


def test_portal_token_fails_closed_when_permissions_fail(tmp_path, monkeypatch):
    monkeypatch.setattr("server.security.DATA_DIR", tmp_path)
    monkeypatch.setattr("server.security.TOKEN_FILE", tmp_path / "token.txt")
    monkeypatch.setattr("server.security._CACHED_TOKEN", "")
    monkeypatch.delenv("ONE_EAD_PORTAL_TOKEN", raising=False)

    monkeypatch.setattr("server.security.secure_path_permissions", lambda p, is_dir=False: False)

    with pytest.raises(PermissionError, match="Failed to confirm secure permissions|Failed to apply secure NTFS permissions"):
        get_portal_token()


def test_setup_token_file_has_secured_permissions(tmp_path, monkeypatch):
    monkeypatch.setattr(weknora_manager, "DATA_DIR", tmp_path)
    monkeypatch.setattr(weknora_manager, "_lite_setup_token", "")
    tok = weknora_manager.get_setup_token()
    token_file = tmp_path / "setup_token.txt"
    assert token_file.exists()

    if os.name == "nt":
        res = subprocess.run(["icacls", str(token_file)], capture_output=True, text=True, check=True)
        assert "BUILTIN\\Users:(I)" not in res.stdout
        assert "NT AUTHORITY\\Authenticated Users:(I)" not in res.stdout


def test_setup_token_fails_closed_when_permissions_fail(tmp_path, monkeypatch):
    monkeypatch.setattr(weknora_manager, "DATA_DIR", tmp_path)
    monkeypatch.setattr(weknora_manager, "_lite_setup_token", "")
    monkeypatch.setattr(weknora_manager, "secure_path_permissions", lambda p, is_dir=False: False)

    with pytest.raises(PermissionError, match="Failed to confirm secure permissions|Failed to apply secure permissions"):
        weknora_manager.get_setup_token()


def test_replay_dir_and_marker_files_secured(tmp_path, monkeypatch):
    monkeypatch.setattr("server.security.DATA_DIR", tmp_path)
    monkeypatch.delenv("ONE_EAD_TICKET_REPLAY_DIR", raising=False)

    claimed = _claim_nonce("test-nonce-12345")
    assert claimed is True
    rdir = tmp_path / ".used_tickets"
    assert rdir.exists()

    if os.name == "nt":
        res = subprocess.run(["icacls", str(rdir)], capture_output=True, text=True, check=True)
        assert "BUILTIN\\Users:(I)" not in res.stdout


def test_claim_nonce_fails_closed_when_permissions_fail(tmp_path, monkeypatch):
    monkeypatch.setattr("server.security.DATA_DIR", tmp_path)
    monkeypatch.delenv("ONE_EAD_TICKET_REPLAY_DIR", raising=False)
    monkeypatch.setattr("server.security.secure_path_permissions", lambda p, is_dir=False: False)

    claimed = _claim_nonce("test-nonce-fail-closed")
    assert claimed is False


def test_no_insecure_fallback_stub_returning_true():
    files_to_check = [
        _ROOT / "modules" / "weknora" / "manager.py",
        _ROOT / "modules" / "deep_tutor" / "deep_tutor.py",
        _ROOT / "server" / "security.py",
    ]
    for fp in files_to_check:
        src = fp.read_text(encoding="utf-8")
        assert "def secure_path_permissions(p, is_dir=False):" not in src


def test_log_file_permissions_secured(tmp_path, monkeypatch):
    log_file = tmp_path / "test_service.log"
    monkeypatch.setattr(weknora_manager, "LOG_FILE", log_file)

    weknora_manager.append_log("Test log entry")
    assert log_file.exists()

    if os.name == "nt":
        res = subprocess.run(["icacls", str(log_file)], capture_output=True, text=True, check=True)
        assert "BUILTIN\\Users:(I)" not in res.stdout
