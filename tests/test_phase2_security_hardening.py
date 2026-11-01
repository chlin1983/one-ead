"""Automated regression test suite for Phase 2 security hardening.

Verifies:
Priority 1: WeKnora executable integrity verification & fail-closed execution before subprocess.Popen.
Priority 2: Disable automatic Paperless vault scanning & WeKnora synchronization by default (explicit user approval).
Priority 3: Reproducible, hash-verified Python dependency management (requirements.lock, verify_lockfile_integrity).
Priority 4: Windows security and permissions for portal tokens, setup tokens, replay store, and service logs (fail-closed).
Priority 5: Normal startup never silently installs dependencies automatically.
"""

from __future__ import annotations
import sqlite3
import time

import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import urllib.request
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
    is_already_verified,
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

    def mock_scan(auto_ocr=False, lang="eng", sync_weknora=False, approved=False, **kwargs):
        captured_args["auto_ocr"] = auto_ocr
        captured_args["lang"] = lang
        captured_args["sync_weknora"] = sync_weknora
        captured_args["approved"] = approved
        captured_args.update(kwargs)
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

# ==============================================================================
# Priority 5: Additional Hardening (Lockfile Fail-Closed & Deletion Safety)
# ==============================================================================

def test_is_already_verified_rejects_missing_lockfile(tmp_path, monkeypatch):
    monkeypatch.setattr("server.check_deps.LOCK_FILE", tmp_path / "nonexistent.lock")
    monkeypatch.setattr("server.check_deps.STAMP_FILE", tmp_path / ".deps_ok")
    (tmp_path / ".deps_ok").write_text(json.dumps({"signature": "valid"}), encoding="utf-8")
    monkeypatch.setattr("server.check_deps._compute_signature", lambda: "valid")

    assert is_already_verified() is False, ".deps_ok must not be accepted when requirements.lock is missing"


def test_is_already_verified_rejects_installed_version_mismatch(tmp_path, monkeypatch):
    lock_file = tmp_path / "requirements.lock"
    lock_file.write_text("fastapi==0.135.2 \\\n    --hash=sha256:7c7c5e2195dfb8f278eb084534e62551fb26fc4957e8417f73db1b7470697ad1\n", encoding="utf-8")
    monkeypatch.setattr("server.check_deps.LOCK_FILE", lock_file)
    monkeypatch.setattr("server.check_deps.STAMP_FILE", tmp_path / ".deps_ok")
    (tmp_path / ".deps_ok").write_text(json.dumps({"signature": "valid"}), encoding="utf-8")
    monkeypatch.setattr("server.check_deps._compute_signature", lambda: "valid")
    # Simulate version mismatch in installed packages
    monkeypatch.setattr("server.check_deps.verify_installed_against_lock", lambda p: (False, ["fastapi: mismatch"]))

    assert is_already_verified() is False, ".deps_ok must not be accepted when installed packages mismatch requirements.lock"


def test_ensure_dependencies_fails_closed_when_lockfile_missing(tmp_path, monkeypatch):
    monkeypatch.setattr("server.check_deps.LOCK_FILE", tmp_path / "nonexistent.lock")
    monkeypatch.setattr("server.check_deps.STAMP_FILE", tmp_path / ".deps_ok")

    with patch("server.check_deps.subprocess.run") as mock_run:
        res = ensure_dependencies(install_missing=True)
        assert res is False
        mock_run.assert_not_called()


def test_ensure_dependencies_fails_closed_when_lockfile_invalid(tmp_path, monkeypatch):
    bad_lock = tmp_path / "bad.lock"
    bad_lock.write_text("fastapi>=0.110\n", encoding="utf-8")
    monkeypatch.setattr("server.check_deps.LOCK_FILE", bad_lock)
    monkeypatch.setattr("server.check_deps.STAMP_FILE", tmp_path / ".deps_ok")

    with patch("server.check_deps.subprocess.run") as mock_run:
        res = ensure_dependencies(install_missing=True)
        assert res is False
        mock_run.assert_not_called()


def test_mark_verified_fails_closed_when_lockfile_missing(tmp_path, monkeypatch):
    monkeypatch.setattr("server.check_deps.LOCK_FILE", tmp_path / "nonexistent.lock")
    monkeypatch.setattr("server.check_deps.STAMP_FILE", tmp_path / ".deps_ok")

    res = mark_verified()
    assert res is False
    assert not (tmp_path / ".deps_ok").exists()


def test_is_already_verified_rejects_stale_stamp_signature(tmp_path, monkeypatch):
    lock_file = tmp_path / "requirements.lock"
    lock_file.write_text("fastapi==0.110.0 \\\n    --hash=sha256:7c7c5e2195dfb8f278eb084534e62551fb26fc4957e8417f73db1b7470697ad1\n", encoding="utf-8")
    monkeypatch.setattr("server.check_deps.LOCK_FILE", lock_file)
    monkeypatch.setattr("server.check_deps.STAMP_FILE", tmp_path / ".deps_ok")
    (tmp_path / ".deps_ok").write_text(json.dumps({"signature": "stale_signature_123"}), encoding="utf-8")
    monkeypatch.setattr("server.check_deps._compute_signature", lambda: "fresh_signature_456")

    assert is_already_verified() is False, "Cached stamp with stale signature must be rejected"


def test_mark_verified_fails_closed_when_installed_mismatch(tmp_path, monkeypatch):
    lock_file = tmp_path / "requirements.lock"
    lock_file.write_text("fastapi==0.110.0 \\\n    --hash=sha256:7c7c5e2195dfb8f278eb084534e62551fb26fc4957e8417f73db1b7470697ad1\n", encoding="utf-8")
    monkeypatch.setattr("server.check_deps.LOCK_FILE", lock_file)
    monkeypatch.setattr("server.check_deps.STAMP_FILE", tmp_path / ".deps_ok")
    monkeypatch.setattr("server.check_deps.verify_installed_against_lock", lambda p: (False, ["fastapi: mismatch"]))

    res = mark_verified()
    assert res is False
    assert not (tmp_path / ".deps_ok").exists()


def test_background_vault_scan_does_not_purge_missing_files(tmp_path, monkeypatch):
    mock_delete = MagicMock()
    monkeypatch.setattr(paperless_manager, "delete_document", mock_delete)
    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    monkeypatch.setattr(paperless_manager, "get_documents_dir", lambda: docs_dir)
    monkeypatch.setattr(paperless_manager, "init_vault", lambda: None)

    fake_con = MagicMock()
    fake_cur = MagicMock()
    fake_con.cursor.return_value = fake_cur
    fake_con.__enter__.return_value = fake_con
    fake_con.__exit__.return_value = None
    # Database contains a document whose disk file was removed
    fake_cur.fetchall.return_value = [{"id": "d-del", "filename": "missing.pdf", "original_name": "missing.pdf", "file_hash": "hash1"}]
    monkeypatch.setattr(paperless_manager, "get_db_connection", lambda: fake_con)

    # Standard vault scan (which the background watcher executes) must NOT prune missing files
    res = paperless_manager.scan_and_sync_vault(auto_ocr=False, sync_weknora=False, approved=False)
    assert res.get("ok") is True
    mock_delete.assert_not_called()


def test_reconcile_missing_documents_requires_explicit_approval():
    with pytest.raises(PermissionError, match="explicit user approval"):
        paperless_manager.reconcile_missing_documents(approved=False)


def test_reconcile_missing_documents_aborts_when_dir_missing(tmp_path, monkeypatch):
    mock_delete = MagicMock()
    monkeypatch.setattr(paperless_manager, "delete_document", mock_delete)
    missing_dir = tmp_path / "nonexistent_vault_docs"
    monkeypatch.setattr(paperless_manager, "get_documents_dir", lambda: missing_dir)

    res = paperless_manager.reconcile_missing_documents(approved=True)
    assert res["ok"] is False
    assert res["cleaned_up"] == 0
    assert "does not exist or is unmounted" in res["message"]
    mock_delete.assert_not_called()


def test_reconcile_missing_documents_aborts_when_dir_inaccessible(tmp_path, monkeypatch):
    mock_delete = MagicMock()
    monkeypatch.setattr(paperless_manager, "delete_document", mock_delete)
    test_dir = tmp_path / "inaccessible_docs"
    test_dir.mkdir()
    monkeypatch.setattr(paperless_manager, "get_documents_dir", lambda: test_dir)

    def fake_walk(path, onerror=None):
        raise PermissionError("Access denied by OS / unmounted network share")

    monkeypatch.setattr("os.walk", fake_walk)

    res = paperless_manager.reconcile_missing_documents(approved=True)
    assert res["ok"] is False
    assert res["cleaned_up"] == 0
    assert "scan incomplete" in res["message"] or "Reconciliation aborted" in res["message"]
    mock_delete.assert_not_called()


def test_reconcile_missing_documents_aborts_when_partially_unreadable(tmp_path, monkeypatch):
    mock_delete = MagicMock()
    monkeypatch.setattr(paperless_manager, "delete_document", mock_delete)
    test_dir = tmp_path / "partial_docs"
    test_dir.mkdir()
    monkeypatch.setattr(paperless_manager, "get_documents_dir", lambda: test_dir)

    # Simulate os.walk encountering an unreadable subdirectory
    def fake_walk_partial(top, onerror=None):
        if onerror:
            onerror(PermissionError("Permission denied: " + str(top) + "/locked_subfolder"))
        yield (str(top), ["locked_subfolder"], ["readable.pdf"])

    monkeypatch.setattr("os.walk", fake_walk_partial)

    res = paperless_manager.reconcile_missing_documents(approved=True)
    assert res["ok"] is False
    assert res["cleaned_up"] == 0
    assert "scan incomplete" in res["message"]
    mock_delete.assert_not_called()


def test_cleanup_missing_endpoint_requires_explicit_approval(auth_client, monkeypatch):
    monkeypatch.setattr(
        paperless_manager,
        "reconcile_missing_documents",
        lambda approved=False, dry_run=False, confirmation_token=None, **kwargs: (
            {"ok": True, "cleaned_up": 0, "message": "OK"} if (approved and confirmation_token) else (_ for _ in ()).throw(PermissionError("Approval and token required"))
        ),
    )

    # 1. Calling cleanup-missing without approval fails closed with 400
    res_rejected = auth_client.post("/api/paperless-ngx/cleanup-missing")
    assert res_rejected.status_code == 400
    assert "explicit user approval" in res_rejected.json()["detail"]

    # 2. Calling cleanup-missing with approved=false fails with 400
    res_rejected2 = auth_client.post("/api/paperless-ngx/cleanup-missing?approved=false")
    assert res_rejected2.status_code == 400

    # 3. Calling cleanup-missing with approved=true but without confirmation token fails with 400
    res_no_tok = auth_client.post("/api/paperless-ngx/cleanup-missing?approved=true")
    assert res_no_tok.status_code == 400
    assert "confirmation_token" in res_no_tok.json()["detail"]

    # 4. Calling cleanup-missing with approved=true and valid confirmation token succeeds
    res_ok = auth_client.post("/api/paperless-ngx/cleanup-missing?approved=true&confirmation_token=valid_token_123")
    assert res_ok.status_code == 200
    assert res_ok.json()["ok"] is True


def test_scan_endpoint_does_not_perform_destructive_cleanup(auth_client, monkeypatch):
    mock_scan = MagicMock(return_value={"ok": True, "scanned": 0, "new_imported": 0})
    mock_cleanup = MagicMock()
    monkeypatch.setattr(paperless_manager, "scan_and_sync_vault", mock_scan)
    monkeypatch.setattr(paperless_manager, "reconcile_missing_documents", mock_cleanup)

    res = auth_client.post("/api/paperless-ngx/scan")
    assert res.status_code == 200
    mock_scan.assert_called_once()
    mock_cleanup.assert_not_called()


def test_weknora_start_service_fails_closed_when_log_file_permission_fails(tmp_path, monkeypatch):
    monkeypatch.setattr(weknora_manager, "_process", None)
    fake_exe = tmp_path / "WeKnora-lite.exe"
    data = b"synthetic-binary"
    fake_exe.write_bytes(data)
    exe_hash = hashlib.sha256(data).hexdigest()
    monkeypatch.setattr(weknora_manager, "BINARY_PATH", fake_exe)
    monkeypatch.setenv("WEKNORA_RELEASE_SHA256", exe_hash)
    data_dir = tmp_path / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(weknora_manager, "DATA_DIR", data_dir)
    test_log = data_dir / "service.log"
    monkeypatch.setattr(weknora_manager, "LOG_FILE", test_log)
    monkeypatch.setattr(weknora_manager, "check_http_alive", lambda p, h: False)
    monkeypatch.setattr(weknora_manager, "check_port", lambda p, h: False)

    def fake_secure(path, is_dir=False):
        if not is_dir and Path(path) == test_log:
            return False
        return True

    monkeypatch.setattr(weknora_manager, "secure_path_permissions", fake_secure)

    with pytest.raises(PermissionError, match="Failed to confirm secure NTFS permissions on WeKnora log file"):
        weknora_manager.start_service()


def test_weknora_append_log_does_not_mask_application_exceptions(tmp_path, monkeypatch):
    # Ordinary logging errors must not raise or mask caller exceptions
    unwritable_log = tmp_path / "nonexistent_dir" / "test.log"
    monkeypatch.setattr(weknora_manager, "LOG_FILE", unwritable_log)

    weknora_manager._logs.clear()
    # append_log must execute without raising an unhandled exception
    weknora_manager.append_log("Test message when disk logging fails")
    assert any("Test message when disk logging fails" in line for line in weknora_manager._logs)


def test_deeptutor_open_service_log_fails_closed_when_permissions_fail(tmp_path, monkeypatch):
    import modules.deep_tutor.deep_tutor as dt_module
    monkeypatch.setattr(dt_module, "DATA_DIR", tmp_path / "dt_data")
    monkeypatch.setattr(dt_module, "LOG_FILE", tmp_path / "dt_data" / "service.log")
    monkeypatch.setattr(dt_module, "secure_path_permissions", lambda p, is_dir=False: False)

    with pytest.raises(PermissionError, match="Failed to confirm secure NTFS permissions"):
        dt_module._open_service_log()


def test_weknora_start_service_fails_closed_when_data_dir_permission_fails(tmp_path, monkeypatch):
    monkeypatch.setattr(weknora_manager, "_process", None)
    fake_exe = tmp_path / "WeKnora-lite.exe"
    data = b"synthetic-binary"
    fake_exe.write_bytes(data)
    digest = hashlib.sha256(data).hexdigest()
    monkeypatch.setattr(weknora_manager, "BINARY_PATH", fake_exe)
    monkeypatch.setattr(weknora_manager, "FALLBACK_BINARY_PATH", tmp_path / "no-fb.exe")
    monkeypatch.setenv("WEKNORA_RELEASE_SHA256", digest)
    monkeypatch.setattr(weknora_manager, "check_http_alive", lambda *a: False)
    monkeypatch.setattr(weknora_manager, "check_port", lambda *a: False)
    monkeypatch.setattr(weknora_manager, "DATA_DIR", tmp_path / "data")
    monkeypatch.setattr(weknora_manager, "secure_path_permissions", lambda p, is_dir=False: False)

    with pytest.raises(PermissionError, match="Failed to confirm secure NTFS permissions"):
        weknora_manager.start_service()


# ==============================================================================
# Additional Stage 2 Regression Tests: Redirects, Process Safety, Lockfile & Vault
# ==============================================================================

def test_verify_installed_against_lock_handles_missing_package(tmp_path, monkeypatch):
    lock_file = tmp_path / "requirements.lock"
    lock_file.write_text("fastapi==0.110.0 \\\n    --hash=sha256:7c7c5e2195dfb8f278eb084534e62551fb26fc4957e8417f73db1b7470697ad1\n", encoding="utf-8")

    import importlib.metadata
    def fake_version(pkg_name):
        raise importlib.metadata.PackageNotFoundError(pkg_name)

    monkeypatch.setattr(importlib.metadata, "version", fake_version)
    ok, mismatches = verify_installed_against_lock(lock_file)
    assert ok is False
    assert any("not installed (locked at 0.110.0)" in m for m in mismatches)


def test_ensure_dependencies_handles_pip_install_failure(tmp_path, monkeypatch):
    lock_file = tmp_path / "requirements.lock"
    lock_file.write_text("fastapi==0.110.0 \\\n    --hash=sha256:7c7c5e2195dfb8f278eb084534e62551fb26fc4957e8417f73db1b7470697ad1\n", encoding="utf-8")
    monkeypatch.setattr("server.check_deps.LOCK_FILE", lock_file)
    monkeypatch.setattr("server.check_deps.is_already_verified", lambda: False)
    monkeypatch.setattr("server.check_deps.get_missing_packages", lambda: [("fastapi", "fastapi", "FastAPI")])
    monkeypatch.setattr("server.check_deps.verify_installed_against_lock", lambda p: (False, ["fastapi: not installed"]))

    # Simulate pip install failing with exit code 1
    mock_res = MagicMock()
    mock_res.returncode = 1
    monkeypatch.setattr("server.check_deps.subprocess.run", lambda *a, **k: mock_res)

    res = ensure_dependencies(install_missing=True)
    assert res is False


def test_paperless_init_vault_secures_meta_db_and_vault(tmp_path, monkeypatch):
    vault = tmp_path / "test_vault"
    monkeypatch.setattr(paperless_manager, "get_vault_path", lambda: vault)
    monkeypatch.setattr(paperless_manager, "get_documents_dir", lambda: vault / "documents")
    monkeypatch.setattr(paperless_manager, "get_ocr_cache_dir", lambda: vault / "ocr")
    monkeypatch.setattr(paperless_manager, "get_thumbnails_dir", lambda: vault / "thumbs")
    monkeypatch.setattr(paperless_manager, "get_previews_dir", lambda: vault / "previews")
    monkeypatch.setattr(paperless_manager, "get_db_path", lambda: vault / "meta.db")

    secured_paths = []
    def fake_secure(path, is_dir=False):
        secured_paths.append((Path(path), is_dir))
        return True

    monkeypatch.setattr(paperless_manager, "secure_path_permissions", fake_secure)

    paperless_manager.init_vault()

    assert (vault, True) in secured_paths
    assert (vault / "documents", True) in secured_paths
    assert (vault / "ocr", True) in secured_paths
    assert (vault / "meta.db", False) in secured_paths


def test_paperless_init_vault_fails_closed_when_permissions_fail(tmp_path, monkeypatch):
    vault = tmp_path / "test_vault_fail"
    monkeypatch.setattr(paperless_manager, "get_vault_path", lambda: vault)
    monkeypatch.setattr(paperless_manager, "get_documents_dir", lambda: vault / "documents")
    monkeypatch.setattr(paperless_manager, "get_ocr_cache_dir", lambda: vault / "ocr")
    monkeypatch.setattr(paperless_manager, "get_thumbnails_dir", lambda: vault / "thumbs")
    monkeypatch.setattr(paperless_manager, "get_previews_dir", lambda: vault / "previews")
    monkeypatch.setattr(paperless_manager, "get_db_path", lambda: vault / "meta.db")

    monkeypatch.setattr(paperless_manager, "secure_path_permissions", lambda p, is_dir=False: False)

    with pytest.raises(PermissionError, match="Failed to secure NTFS permissions on Paperless"):
        paperless_manager.init_vault()


def test_reconcile_missing_documents_dry_run_preview(tmp_path, monkeypatch):
    mock_delete = MagicMock()
    monkeypatch.setattr(paperless_manager, "delete_document", mock_delete)
    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "present.pdf").write_text("existing content")
    monkeypatch.setattr(paperless_manager, "get_documents_dir", lambda: docs_dir)
    monkeypatch.setattr(paperless_manager, "init_vault", lambda: None)

    fake_con = MagicMock()
    fake_cur = MagicMock()
    fake_con.cursor.return_value = fake_cur
    fake_con.__enter__.return_value = fake_con
    fake_con.__exit__.return_value = None
    fake_cur.fetchall.return_value = [
        {"id": "d-present", "filename": "present.pdf", "original_name": "present.pdf", "file_hash": "h_pres", "file_size": 50, "tags": "", "created_at": "2026-01-01"},
        {"id": "d-preview-1", "filename": "missing.pdf", "original_name": "missing.pdf", "file_hash": "hash1", "file_size": 100, "tags": "", "created_at": "2026-01-01"}
    ]
    monkeypatch.setattr(paperless_manager, "get_db_connection", lambda: fake_con)

    # Calling dry_run=True should preview candidates without deleting
    res = paperless_manager.reconcile_missing_documents(approved=False, dry_run=True)
    assert res["ok"] is True
    assert res["dry_run"] is True
    assert res["candidate_count"] == 1
    assert res["candidates"][0]["id"] == "d-preview-1"
    assert "confirmation_token" in res
    mock_delete.assert_not_called()


def test_reconcile_missing_documents_candidate_confirmation_guard(tmp_path, monkeypatch):
    mock_delete = MagicMock()
    monkeypatch.setattr(paperless_manager, "delete_document", mock_delete)
    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "present.pdf").write_text("existing content")
    monkeypatch.setattr(paperless_manager, "get_documents_dir", lambda: docs_dir)
    monkeypatch.setattr(paperless_manager, "init_vault", lambda: None)

    fake_con = MagicMock()
    fake_cur = MagicMock()
    fake_con.cursor.return_value = fake_cur
    fake_con.__enter__.return_value = fake_con
    fake_con.__exit__.return_value = None
    fake_cur.fetchall.return_value = [
        {"id": "d-present", "filename": "present.pdf", "original_name": "present.pdf", "file_hash": "h_pres", "file_size": 50, "tags": "", "created_at": "2026-01-01"},
        {"id": "d-guard-1", "filename": "missing.pdf", "original_name": "missing.pdf", "file_hash": "hash1", "file_size": 100, "tags": "", "created_at": "2026-01-01"}
    ]
    monkeypatch.setattr(paperless_manager, "get_db_connection", lambda: fake_con)

    # Missing or empty confirmation token fails closed with PermissionError
    with pytest.raises(PermissionError, match="non-empty confirmation token"):
        paperless_manager.reconcile_missing_documents(approved=True, confirmation_token="")

    # Calling with malformed confirmation token aborts immediately
    res_malformed = paperless_manager.reconcile_missing_documents(approved=True, confirmation_token="wrong_token_123")
    assert res_malformed["ok"] is False
    assert res_malformed["cleaned_up"] == 0
    assert "Invalid confirmation token" in res_malformed["message"]

    # Calling with expired confirmation token aborts immediately
    expired_tok = f"{int(time.time()) - 100}_fakehash_fakesig"
    res_exp = paperless_manager.reconcile_missing_documents(approved=True, confirmation_token=expired_tok)
    assert res_exp["ok"] is False
    assert "Confirmation token has expired" in res_exp["message"]

    # Calling with valid format token but mismatched candidate digest aborts
    mismatch_tok = f"{int(time.time()) + 300}_otherhash_othersig"
    res_mismatch = paperless_manager.reconcile_missing_documents(approved=True, confirmation_token=mismatch_tok)
    assert res_mismatch["ok"] is False
    assert "Candidate set changed or invalid token signature" in res_mismatch["message"]

    mock_delete.assert_not_called()


def test_reconcile_missing_documents_writes_audit_log_and_recovery(tmp_path, monkeypatch):
    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "present.pdf").write_text("existing content")
    vault = tmp_path / "vault"
    vault.mkdir()
    monkeypatch.setattr(paperless_manager, "get_vault_path", lambda: vault)
    monkeypatch.setattr(paperless_manager, "get_documents_dir", lambda: docs_dir)
    monkeypatch.setattr(paperless_manager, "get_ocr_cache_dir", lambda: vault / "ocr")
    monkeypatch.setattr(paperless_manager, "init_vault", lambda: None)
    monkeypatch.setattr(paperless_manager, "delete_document", lambda d_id: True)

    fake_con = MagicMock()
    fake_cur = MagicMock()
    fake_con.cursor.return_value = fake_cur
    fake_con.__enter__.return_value = fake_con
    fake_con.__exit__.return_value = None
    fake_cur.fetchall.return_value = [
        {"id": "d-present", "filename": "present.pdf", "original_name": "present.pdf", "file_hash": "h_pres", "file_size": 50, "tags": "", "created_at": "2026-01-01"},
        {"id": "d-audit-1", "filename": "missing.pdf", "original_name": "missing.pdf", "file_hash": "hash1", "file_size": 100, "tags": "", "created_at": "2026-01-01"}
    ]
    monkeypatch.setattr(paperless_manager, "get_db_connection", lambda: fake_con)

    # Preview to obtain legitimate confirmation token
    preview = paperless_manager.reconcile_missing_documents(approved=False, dry_run=True)
    assert preview["ok"] is True
    tok = preview["confirmation_token"]

    # Execute with valid confirmation token
    res = paperless_manager.reconcile_missing_documents(approved=True, confirmation_token=tok)
    assert res["ok"] is True
    assert res["cleaned_up"] == 1

    audit_log = vault / "cleanup_audit.log"
    assert audit_log.exists()
    audit_text = audit_log.read_text(encoding="utf-8")
    assert "[INTENT]" in audit_text
    assert "[DELETED] id=d-audit-1" in audit_text
    assert "[COMPLETE]" in audit_text

    recovery_file = vault / "recovery" / "d-audit-1.json"
    assert recovery_file.exists()
    rec_data = json.loads(recovery_file.read_text(encoding="utf-8"))
    assert rec_data["metadata"]["id"] == "d-audit-1"


def test_reconcile_missing_documents_handles_partial_failure(tmp_path, monkeypatch):
    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "present.pdf").write_text("existing content")
    vault = tmp_path / "vault"
    vault.mkdir()
    monkeypatch.setattr(paperless_manager, "get_vault_path", lambda: vault)
    monkeypatch.setattr(paperless_manager, "get_documents_dir", lambda: docs_dir)
    monkeypatch.setattr(paperless_manager, "get_ocr_cache_dir", lambda: vault / "ocr")
    monkeypatch.setattr(paperless_manager, "init_vault", lambda: None)

    call_counts = {"count": 0}

    def fake_delete(d_id):
        call_counts["count"] += 1
        if call_counts["count"] == 1:
            return True
        raise RuntimeError(f"Database locked or error deleting {d_id}")

    monkeypatch.setattr(paperless_manager, "delete_document", fake_delete)

    fake_con = MagicMock()
    fake_cur = MagicMock()
    fake_con.cursor.return_value = fake_cur
    fake_con.__enter__.return_value = fake_con
    fake_con.__exit__.return_value = None
    fake_cur.fetchall.return_value = [
        {"id": "d-present", "filename": "present.pdf", "original_name": "present.pdf", "file_hash": "h_pres", "file_size": 50, "tags": "", "created_at": "2026-01-01"},
        {"id": "d-part-1", "filename": "missing1.pdf", "original_name": "missing1.pdf", "file_hash": "hash1", "file_size": 100, "tags": "", "created_at": "2026-01-01"},
        {"id": "d-part-2", "filename": "missing2.pdf", "original_name": "missing2.pdf", "file_hash": "hash2", "file_size": 100, "tags": "", "created_at": "2026-01-01"}
    ]
    monkeypatch.setattr(paperless_manager, "get_db_connection", lambda: fake_con)

    preview = paperless_manager.reconcile_missing_documents(approved=False, dry_run=True)
    tok = preview["confirmation_token"]

    res = paperless_manager.reconcile_missing_documents(approved=True, confirmation_token=tok)
    assert res["ok"] is False
    assert res["partial_failure"] is True
    assert res["cleaned_up"] == 1
    assert len(res["errors"]) == 1

    audit_log = vault / "cleanup_audit.log"
    assert audit_log.exists()
    audit_text = audit_log.read_text(encoding="utf-8")
    assert "[PARTIAL FAILURE]" in audit_text


def test_cleanup_missing_endpoint_dry_run_and_approval(auth_client, monkeypatch):
    monkeypatch.setattr(
        paperless_manager,
        "reconcile_missing_documents",
        lambda approved=False, dry_run=False, confirmation_token=None, **k: (
            {"ok": True, "dry_run": True, "candidates": [], "confirmation_token": "token_preview_xyz"} if dry_run else (
                {"ok": True, "cleaned_up": 0} if (approved and confirmation_token == "token_preview_xyz") else (_ for _ in ()).throw(PermissionError("Approval and token required"))
            )
        ),
    )

    # 1. dry_run=true succeeds without requiring approved=true
    res_dry = auth_client.post("/api/paperless-ngx/cleanup-missing?dry_run=true")
    assert res_dry.status_code == 200
    assert res_dry.json()["dry_run"] is True
    tok = res_dry.json()["confirmation_token"]

    # 2. calling without approval fails with 400
    res_no_app = auth_client.post("/api/paperless-ngx/cleanup-missing")
    assert res_no_app.status_code == 400

    # 3. calling without token fails with 400
    res_no_tok = auth_client.post("/api/paperless-ngx/cleanup-missing?approved=true")
    assert res_no_tok.status_code == 400

    # 4. calling with approved=true and token succeeds
    res_ok = auth_client.post(f"/api/paperless-ngx/cleanup-missing?approved=true&confirmation_token={tok}")
    assert res_ok.status_code == 200


def test_check_ollama_rejects_unsafe_redirect_target(monkeypatch):
    handler = weknora_manager._SafeLoopbackRedirectHandler()
    req = urllib.request.Request("http://127.0.0.1:11434/api/tags")

    # Attempt redirect to external IP or AWS metadata
    with pytest.raises(urllib.error.HTTPError) as exc_info:
        handler.redirect_request(req, None, 302, "Found", {}, "http://169.254.169.254/latest/meta-data")
    assert exc_info.value.code == 403

    # Attempt redirect to external domain
    with pytest.raises(urllib.error.HTTPError) as exc_info2:
        handler.redirect_request(req, None, 302, "Found", {}, "http://attacker.com/api/tags")
    assert exc_info2.value.code == 403


def test_check_ollama_rejects_redirect_to_unapproved_port(monkeypatch):
    handler = weknora_manager._SafeLoopbackRedirectHandler()
    req = urllib.request.Request("http://127.0.0.1:11434/api/tags")

    # Attempt redirect to loopback on sensitive SSH/SMB port 22 or 445
    with pytest.raises(urllib.error.HTTPError) as exc_info:
        handler.redirect_request(req, None, 302, "Found", {}, "http://127.0.0.1:22/api/tags")
    assert exc_info.value.code == 403


def test_check_ollama_rejects_redirect_with_credentials(monkeypatch):
    handler = weknora_manager._SafeLoopbackRedirectHandler()
    req = urllib.request.Request("http://127.0.0.1:11434/api/tags")

    with pytest.raises(urllib.error.HTTPError) as exc_info:
        handler.redirect_request(req, None, 302, "Found", {}, "http://user:pass@127.0.0.1:11434/api/tags")
    assert exc_info.value.code == 403


def test_weknora_stop_service_eliminates_shell_injection(monkeypatch):
    monkeypatch.setattr(weknora_manager, "_process", None)
    monkeypatch.setattr(weknora_manager, "check_port", lambda p, h: False)

    with patch("subprocess.run") as mock_run, patch("subprocess.check_output") as mock_co:
        res = weknora_manager.stop_service()
        assert res["ok"] is True
        mock_co.assert_not_called()
        # Verify shell=True was never called
        for call_args in mock_run.call_args_list:
            assert call_args.kwargs.get("shell") is not True


def test_weknora_stop_service_refuses_to_kill_unrelated_process(monkeypatch):
    monkeypatch.setattr(weknora_manager, "_process", None)
    monkeypatch.setattr(weknora_manager, "check_port", lambda p, h: True)

    # netstat shows port 8082 in use by PID 9999
    fake_netstat = MagicMock()
    fake_netstat.returncode = 0
    fake_netstat.stdout = "  TCP    127.0.0.1:8082         0.0.0.0:0              LISTENING       9999\n"
    monkeypatch.setattr(subprocess, "run", lambda cmd, **k: fake_netstat if cmd[0] == "netstat" else MagicMock())

    # PID 9999 is NOT our WeKnora process
    monkeypatch.setattr(weknora_manager, "_is_expected_weknora_process", lambda pid: False)

    killed_pids = []
    def fake_run(cmd, **k):
        if cmd[0] == "netstat":
            return fake_netstat
        if cmd[0] == "taskkill":
            killed_pids.append(cmd)
        return MagicMock()

    monkeypatch.setattr(subprocess, "run", fake_run)
    weknora_manager._logs.clear()

    res = weknora_manager.stop_service()
    assert res["ok"] is True
    # Crucial assertion: PID 9999 must NOT be killed!
    assert not any("9999" in str(cmd) for cmd in killed_pids)
    assert any("refusing termination" in log for log in weknora_manager._logs)


def test_weknora_stop_service_kills_verified_orphan(monkeypatch):
    monkeypatch.setattr(weknora_manager, "_process", None)
    monkeypatch.setattr(weknora_manager, "check_port", lambda p, h: True)

    fake_netstat = MagicMock()
    fake_netstat.returncode = 0
    fake_netstat.stdout = "  TCP    127.0.0.1:8082         0.0.0.0:0              LISTENING       8888\n"

    # PID 8888 is a verified orphaned WeKnora instance
    monkeypatch.setattr(weknora_manager, "_is_expected_weknora_process", lambda pid: pid == 8888)

    killed_pids = []
    def fake_run(cmd, **k):
        if cmd[0] == "netstat":
            return fake_netstat
        if cmd[0] == "taskkill":
            killed_pids.append(cmd)
        return MagicMock()

    monkeypatch.setattr(subprocess, "run", fake_run)

    res = weknora_manager.stop_service()
    assert res["ok"] is True
    # Verified orphan PID 8888 WAS targeted
    assert any("8888" in str(cmd) for cmd in killed_pids)


def test_reconcile_missing_documents_fails_closed_on_recovery_dir_permission(tmp_path, monkeypatch):
    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "present.pdf").write_text("existing")
    vault = tmp_path / "vault"
    vault.mkdir()
    monkeypatch.setattr(paperless_manager, "get_vault_path", lambda: vault)
    monkeypatch.setattr(paperless_manager, "get_documents_dir", lambda: docs_dir)
    monkeypatch.setattr(paperless_manager, "init_vault", lambda: None)

    fake_con = MagicMock()
    fake_cur = MagicMock()
    fake_con.cursor.return_value = fake_cur
    fake_con.__enter__.return_value = fake_con
    fake_con.__exit__.return_value = None
    fake_cur.fetchall.return_value = [
        {"id": "d-present", "filename": "present.pdf", "original_name": "present.pdf", "file_hash": "h_pres", "file_size": 50, "tags": "", "created_at": "2026-01-01"},
        {"id": "d-rec-fail", "filename": "missing.pdf", "original_name": "missing.pdf", "file_hash": "h1", "file_size": 100, "tags": "", "created_at": "2026-01-01"}
    ]
    monkeypatch.setattr(paperless_manager, "get_db_connection", lambda: fake_con)

    preview = paperless_manager.reconcile_missing_documents(approved=False, dry_run=True)
    tok = preview["confirmation_token"]

    rec_dir = vault / "recovery"

    def fake_secure(path, is_dir=False):
        if is_dir and Path(path) == rec_dir:
            return False
        return True

    monkeypatch.setattr(paperless_manager, "secure_path_permissions", fake_secure)

    with pytest.raises(PermissionError, match="recovery directory"):
        paperless_manager.reconcile_missing_documents(approved=True, confirmation_token=tok)


def test_reconcile_missing_documents_fails_closed_on_audit_log_permission(tmp_path, monkeypatch):
    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "present.pdf").write_text("existing")
    vault = tmp_path / "vault"
    vault.mkdir()
    monkeypatch.setattr(paperless_manager, "get_vault_path", lambda: vault)
    monkeypatch.setattr(paperless_manager, "get_documents_dir", lambda: docs_dir)
    monkeypatch.setattr(paperless_manager, "init_vault", lambda: None)

    fake_con = MagicMock()
    fake_cur = MagicMock()
    fake_con.cursor.return_value = fake_cur
    fake_con.__enter__.return_value = fake_con
    fake_con.__exit__.return_value = None
    fake_cur.fetchall.return_value = [
        {"id": "d-present", "filename": "present.pdf", "original_name": "present.pdf", "file_hash": "h_pres", "file_size": 50, "tags": "", "created_at": "2026-01-01"},
        {"id": "d-audit-fail", "filename": "missing.pdf", "original_name": "missing.pdf", "file_hash": "h1", "file_size": 100, "tags": "", "created_at": "2026-01-01"}
    ]
    monkeypatch.setattr(paperless_manager, "get_db_connection", lambda: fake_con)

    preview = paperless_manager.reconcile_missing_documents(approved=False, dry_run=True)
    tok = preview["confirmation_token"]

    audit_f = vault / "cleanup_audit.log"

    def fake_secure(path, is_dir=False):
        if not is_dir and Path(path) == audit_f:
            return False
        return True

    monkeypatch.setattr(paperless_manager, "secure_path_permissions", fake_secure)

    with pytest.raises(PermissionError, match="cleanup audit log"):
        paperless_manager.reconcile_missing_documents(approved=True, confirmation_token=tok)


def test_reconcile_missing_documents_fails_closed_on_recovery_file_permission(tmp_path, monkeypatch):
    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "present.pdf").write_text("existing")
    vault = tmp_path / "vault"
    vault.mkdir()
    monkeypatch.setattr(paperless_manager, "get_vault_path", lambda: vault)
    monkeypatch.setattr(paperless_manager, "get_documents_dir", lambda: docs_dir)
    monkeypatch.setattr(paperless_manager, "get_ocr_cache_dir", lambda: vault / "ocr")
    monkeypatch.setattr(paperless_manager, "init_vault", lambda: None)
    mock_del = MagicMock()
    monkeypatch.setattr(paperless_manager, "delete_document", mock_del)

    fake_con = MagicMock()
    fake_cur = MagicMock()
    fake_con.cursor.return_value = fake_cur
    fake_con.__enter__.return_value = fake_con
    fake_con.__exit__.return_value = None
    fake_cur.fetchall.return_value = [
        {"id": "d-present", "filename": "present.pdf", "original_name": "present.pdf", "file_hash": "h_pres", "file_size": 50, "tags": "", "created_at": "2026-01-01"},
        {"id": "d-file-fail", "filename": "missing.pdf", "original_name": "missing.pdf", "file_hash": "h1", "file_size": 100, "tags": "", "created_at": "2026-01-01"}
    ]
    monkeypatch.setattr(paperless_manager, "get_db_connection", lambda: fake_con)

    preview = paperless_manager.reconcile_missing_documents(approved=False, dry_run=True)
    tok = preview["confirmation_token"]

    def fake_secure(path, is_dir=False):
        if not is_dir and str(path).endswith("d-file-fail.json"):
            return False
        return True

    monkeypatch.setattr(paperless_manager, "secure_path_permissions", fake_secure)

    res = paperless_manager.reconcile_missing_documents(approved=True, confirmation_token=tok)
    assert res["ok"] is False
    assert res["partial_failure"] is True
    # Crucially, delete_document was NOT invoked because recovery file securing failed!
    mock_del.assert_not_called()


def test_reconcile_missing_documents_concurrency_lock():
    # If _scan_lock is already acquired, reconcile returns busy
    with paperless_manager._scan_lock:
        res = paperless_manager.reconcile_missing_documents(approved=False, dry_run=True)
        assert res["ok"] is False
        assert res.get("busy") is True
        assert "already running" in res["message"]


def test_reconcile_missing_documents_skips_reappeared_candidate(tmp_path, monkeypatch):
    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "present.pdf").write_text("existing")
    vault = tmp_path / "vault"
    vault.mkdir()
    monkeypatch.setattr(paperless_manager, "get_vault_path", lambda: vault)
    monkeypatch.setattr(paperless_manager, "get_documents_dir", lambda: docs_dir)
    monkeypatch.setattr(paperless_manager, "get_ocr_cache_dir", lambda: vault / "ocr")
    monkeypatch.setattr(paperless_manager, "init_vault", lambda: None)
    mock_del = MagicMock()
    monkeypatch.setattr(paperless_manager, "delete_document", mock_del)

    fake_con = MagicMock()
    fake_cur = MagicMock()
    fake_con.cursor.return_value = fake_cur
    fake_con.__enter__.return_value = fake_con
    fake_con.__exit__.return_value = None
    fake_cur.fetchall.return_value = [
        {"id": "d-present", "filename": "present.pdf", "original_name": "present.pdf", "file_hash": "h_pres", "file_size": 50, "tags": "", "created_at": "2026-01-01"},
        {"id": "d-reappear", "filename": "reappear.pdf", "original_name": "reappear.pdf", "file_hash": "h1", "file_size": 100, "tags": "", "created_at": "2026-01-01"}
    ]
    monkeypatch.setattr(paperless_manager, "get_db_connection", lambda: fake_con)

    preview = paperless_manager.reconcile_missing_documents(approved=False, dry_run=True)
    tok = preview["confirmation_token"]

    # Re-create the file on disk right before execution
    (docs_dir / "reappear.pdf").write_text("I am back!")

    res = paperless_manager.reconcile_missing_documents(approved=True, confirmation_token=tok)
    # The candidate set changed because the file reappeared; execution safely aborts
    assert res["ok"] is False
    assert "Candidate set changed" in res["message"]
    mock_del.assert_not_called()


def test_reconcile_missing_documents_rejects_path_traversal_filename(tmp_path, monkeypatch):
    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "present.pdf").write_text("existing")
    vault = tmp_path / "vault"
    vault.mkdir()
    monkeypatch.setattr(paperless_manager, "get_vault_path", lambda: vault)
    monkeypatch.setattr(paperless_manager, "get_documents_dir", lambda: docs_dir)
    monkeypatch.setattr(paperless_manager, "init_vault", lambda: None)

    fake_con = MagicMock()
    fake_cur = MagicMock()
    fake_con.cursor.return_value = fake_cur
    fake_con.__enter__.return_value = fake_con
    fake_con.__exit__.return_value = None
    fake_cur.fetchall.return_value = [
        {"id": "d-present", "filename": "present.pdf", "original_name": "present.pdf", "file_hash": "h_pres", "file_size": 50, "tags": "", "created_at": "2026-01-01"},
        {"id": "d-traverse", "filename": "../../etc/shadow", "original_name": "shadow", "file_hash": "h_bad", "file_size": 500, "tags": "", "created_at": "2026-01-01"}
    ]
    monkeypatch.setattr(paperless_manager, "get_db_connection", lambda: fake_con)

    # Path traversal candidate must be ignored/skipped
    preview = paperless_manager.reconcile_missing_documents(approved=False, dry_run=True)
    assert preview["ok"] is True
    assert preview["candidate_count"] == 0


def test_paperless_init_vault_secures_thumbnails_and_previews(tmp_path, monkeypatch):
    test_vault = tmp_path / "paperless_vault"
    monkeypatch.setattr(paperless_manager, "get_vault_path", lambda: test_vault)
    monkeypatch.setattr(paperless_manager, "get_documents_dir", lambda: test_vault / "documents")
    monkeypatch.setattr(paperless_manager, "get_ocr_cache_dir", lambda: test_vault / "ocr_cache")
    thumbs_dir = test_vault / "thumbnails"
    previews_dir = test_vault / "previews"
    monkeypatch.setattr(paperless_manager, "get_thumbnails_dir", lambda: thumbs_dir)
    monkeypatch.setattr(paperless_manager, "get_previews_dir", lambda: previews_dir)
    monkeypatch.setattr(paperless_manager, "get_db_path", lambda: test_vault / "meta.db")

    secured_paths = []
    def fake_secure(path, is_dir=False):
        secured_paths.append((Path(path).resolve(), is_dir))
        return True

    monkeypatch.setattr(paperless_manager, "secure_path_permissions", fake_secure)

    paperless_manager.init_vault()

    assert (thumbs_dir.resolve(), True) in secured_paths
    assert (previews_dir.resolve(), True) in secured_paths

    # Test fail-closed when thumbnails directory permission hardening fails
    monkeypatch.setattr(paperless_manager, "secure_path_permissions", lambda p, is_dir=False: Path(p) != thumbs_dir)
    with pytest.raises(PermissionError, match="thumbnails directory"):
        paperless_manager.init_vault()


def test_paperless_legacy_database_migration(tmp_path, monkeypatch):
    # Test upgrading an older meta.db schema (lacking error_msg column)
    test_vault = tmp_path / "legacy_vault"
    test_vault.mkdir()
    legacy_db = test_vault / "meta.db"
    monkeypatch.setattr(paperless_manager, "get_vault_path", lambda: test_vault)
    monkeypatch.setattr(paperless_manager, "get_documents_dir", lambda: test_vault / "documents")
    monkeypatch.setattr(paperless_manager, "get_ocr_cache_dir", lambda: test_vault / "ocr_cache")
    monkeypatch.setattr(paperless_manager, "get_thumbnails_dir", lambda: test_vault / "thumbnails")
    monkeypatch.setattr(paperless_manager, "get_previews_dir", lambda: test_vault / "previews")
    monkeypatch.setattr(paperless_manager, "get_db_path", lambda: legacy_db)

    # Create older schema without error_msg column
    with sqlite3.connect(str(legacy_db)) as con:
        con.execute(
            """
            CREATE TABLE documents (
                id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                original_name TEXT NOT NULL,
                file_size INTEGER DEFAULT 0,
                file_hash TEXT,
                mime_type TEXT,
                tags TEXT DEFAULT '',
                page_count INTEGER DEFAULT 0,
                ocr_pages INTEGER DEFAULT 0,
                ocr_status TEXT DEFAULT 'pending',
                created_at TEXT,
                updated_at TEXT
            )
            """
        )
        con.execute(
            "INSERT INTO documents (id, filename, original_name) VALUES ('d-legacy', 'doc.pdf', 'doc.pdf')"
        )
        con.commit()

    secured_paths = []
    def fake_secure(path, is_dir=False):
        secured_paths.append(Path(path).resolve())
        return True

    monkeypatch.setattr(paperless_manager, "secure_path_permissions", fake_secure)

    # Call init_vault() which performs schema migration and permission hardening
    paperless_manager.init_vault()

    # Verify column was added and existing data preserved
    with sqlite3.connect(str(legacy_db)) as con:
        cur = con.cursor()
        cur.execute("PRAGMA table_info(documents)")
        cols = {r[1] for r in cur.fetchall()}
        assert "error_msg" in cols
        cur.execute("SELECT id, original_name FROM documents WHERE id = 'd-legacy'")
        row = cur.fetchone()
        assert row[0] == "d-legacy"

    # Confirm database permissions were explicitly secured
    assert legacy_db.resolve() in secured_paths


def test_weknora_process_verification_fails_closed_without_binary(tmp_path, monkeypatch):
    monkeypatch.setattr(weknora_manager, "BINARY_PATH", tmp_path / "nonexistent1.exe")
    monkeypatch.setattr(weknora_manager, "FALLBACK_BINARY_PATH", tmp_path / "nonexistent2.exe")

    # When no trusted binary exists on disk, process verification fails closed
    assert weknora_manager._is_expected_weknora_process(12345) is False


def test_weknora_process_verification_fails_closed_on_unverified_process(tmp_path, monkeypatch):
    real_exe = tmp_path / "WeKnora-lite.exe"
    real_exe.write_bytes(b"trusted")
    monkeypatch.setattr(weknora_manager, "BINARY_PATH", real_exe)
    monkeypatch.setattr(weknora_manager, "FALLBACK_BINARY_PATH", tmp_path / "no-fb.exe")

    # If process inspection query returns None
    monkeypatch.setattr(weknora_manager, "_get_process_executable_path_win32", lambda pid: None)
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: MagicMock(returncode=1, stdout=""))

    assert weknora_manager._is_expected_weknora_process(12345) is False


def test_weknora_process_verification_rejects_mismatched_binary_path(tmp_path, monkeypatch):
    real_exe = tmp_path / "WeKnora-lite.exe"
    real_exe.write_bytes(b"trusted")
    monkeypatch.setattr(weknora_manager, "BINARY_PATH", real_exe)
    monkeypatch.setattr(weknora_manager, "FALLBACK_BINARY_PATH", tmp_path / "no-fb.exe")

    # A process having the same filename but in a malicious or unauthorized directory
    foreign_exe = tmp_path / "malicious" / "WeKnora-lite.exe"
    monkeypatch.setattr(weknora_manager, "_get_process_executable_path_win32", lambda pid: foreign_exe)

    assert weknora_manager._is_expected_weknora_process(12345) is False


def test_weknora_process_verification_succeeds_on_exact_binary_path(tmp_path, monkeypatch):
    real_exe = tmp_path / "WeKnora-lite.exe"
    real_exe.write_bytes(b"trusted")
    monkeypatch.setattr(weknora_manager, "BINARY_PATH", real_exe)
    monkeypatch.setattr(weknora_manager, "FALLBACK_BINARY_PATH", tmp_path / "no-fb.exe")

    # When process image exactly matches authorized binary
    monkeypatch.setattr(weknora_manager, "_get_process_executable_path_win32", lambda pid: real_exe.resolve())

    assert weknora_manager._is_expected_weknora_process(12345) is True


def test_weknora_stop_service_exact_port_parsing(monkeypatch):
    monkeypatch.setattr(weknora_manager, "_process", None)
    monkeypatch.setattr(weknora_manager, "check_port", lambda p, h: True)

    # Netstat output contains port 18082, 80820, but NOT exact port 8082
    fake_netstat = MagicMock()
    fake_netstat.returncode = 0
    fake_netstat.stdout = (
        "  TCP    127.0.0.1:18082        0.0.0.0:0              LISTENING       1111\n"
        "  TCP    127.0.0.1:80820        0.0.0.0:0              LISTENING       2222\n"
    )

    killed_pids = []
    def fake_run(cmd, **k):
        if cmd[0] == "netstat":
            return fake_netstat
        if cmd[0] == "taskkill":
            killed_pids.append(cmd)
        return MagicMock()

    monkeypatch.setattr(subprocess, "run", fake_run)
    monkeypatch.setattr(weknora_manager, "_is_expected_weknora_process", lambda pid: True)

    res = weknora_manager.stop_service()
    assert res["ok"] is True
    # Exact port 8082 was requested, so neither PID 1111 nor 2222 must be killed!
    assert len(killed_pids) == 0


def test_windows_acl_removes_explicit_aces_and_verifies_acl(tmp_path):
    import os
    if os.name != "nt":
        return
    import subprocess
    from server.security import secure_path_permissions, _verify_windows_acl

    test_file = tmp_path / "test_acl_target.txt"
    test_file.write_text("sensitive-data")

    # Grant unauthorized explicit ACE to Everyone
    subprocess.run(["icacls", str(test_file), "/grant", "Everyone:(R)"], capture_output=True, check=False)

    # secure_path_permissions should remove unauthorized explicit ACE, reset, strip inheritance and verify clean ACL
    ok = secure_path_permissions(test_file, is_dir=False)
    assert ok is True

    # Verify that Everyone is no longer present in the ACL
    res = subprocess.run(["icacls", str(test_file)], capture_output=True, text=True, check=False)
    assert "Everyone" not in res.stdout
    assert "(I)" not in res.stdout


def test_windows_acl_fails_closed_when_verification_fails(tmp_path, monkeypatch):
    import os
    if os.name != "nt":
        return
    import server.security as sec

    test_file = tmp_path / "test_fail_target.txt"
    test_file.write_text("sensitive-data")

    # If verification function detects unauthorized ACL or failure
    monkeypatch.setattr(sec, "_verify_windows_acl", lambda p, u: False)
    ok = sec.secure_path_permissions(test_file, is_dir=False)
    assert ok is False


def test_reconcile_missing_documents_aborts_on_symlink_file(tmp_path, monkeypatch):
    mock_delete = MagicMock()
    monkeypatch.setattr(paperless_manager, "delete_document", mock_delete)
    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "present.pdf").write_text("real content")
    monkeypatch.setattr(paperless_manager, "get_documents_dir", lambda: docs_dir)
    monkeypatch.setattr(paperless_manager, "init_vault", lambda: None)

    fake_con = MagicMock()
    fake_cur = MagicMock()
    fake_con.cursor.return_value = fake_cur
    fake_con.__enter__.return_value = fake_con
    fake_con.__exit__.return_value = None
    fake_cur.fetchall.return_value = [
        {"id": "d-present", "filename": "present.pdf", "original_name": "present.pdf", "file_hash": "h_pres", "file_size": 50, "tags": "", "created_at": "2026-01-01"},
        {"id": "d-missing", "filename": "missing.pdf", "original_name": "missing.pdf", "file_hash": "h_miss", "file_size": 100, "tags": "", "created_at": "2026-01-01"}
    ]
    monkeypatch.setattr(paperless_manager, "get_db_connection", lambda: fake_con)

    # Simulate encountering a symlink file during traversal
    real_target = tmp_path / "external.pdf"
    real_target.write_text("external content")
    symlink_file = docs_dir / "symlink.pdf"
    try:
        import os
        os.symlink(str(real_target), str(symlink_file))
    except (OSError, NotImplementedError):
        # On Windows without SeCreateSymbolicLinkPrivilege, mock Path.is_symlink
        orig_is_symlink = Path.is_symlink
        monkeypatch.setattr(Path, "is_symlink", lambda self: True if self.name == "symlink.pdf" else orig_is_symlink(self))
        symlink_file.write_text("simulated symlink")

    res = paperless_manager.reconcile_missing_documents(approved=False, dry_run=True)
    assert res["ok"] is False
    assert "scan incomplete" in res["message"] or "Symlink" in res["message"]
    # Symlink was never classified as a missing document
    assert "candidates" not in res
    mock_delete.assert_not_called()


def test_reconcile_missing_documents_aborts_if_registered_document_is_symlink(tmp_path, monkeypatch):
    mock_delete = MagicMock()
    monkeypatch.setattr(paperless_manager, "delete_document", mock_delete)
    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "present.pdf").write_text("real content")
    sym_doc = docs_dir / "sym_doc.pdf"
    sym_doc.write_text("doc content")
    monkeypatch.setattr(paperless_manager, "get_documents_dir", lambda: docs_dir)
    monkeypatch.setattr(paperless_manager, "init_vault", lambda: None)

    fake_con = MagicMock()
    fake_cur = MagicMock()
    fake_con.cursor.return_value = fake_cur
    fake_con.__enter__.return_value = fake_con
    fake_con.__exit__.return_value = None
    fake_cur.fetchall.return_value = [
        {"id": "d-present", "filename": "present.pdf", "original_name": "present.pdf", "file_hash": "h_pres", "file_size": 50, "tags": "", "created_at": "2026-01-01"},
        {"id": "d-sym", "filename": "sym_doc.pdf", "original_name": "sym_doc.pdf", "file_hash": "h_sym", "file_size": 100, "tags": "", "created_at": "2026-01-01"}
    ]
    monkeypatch.setattr(paperless_manager, "get_db_connection", lambda: fake_con)

    orig_is_symlink = Path.is_symlink
    monkeypatch.setattr(Path, "is_symlink", lambda self: True if self.name == "sym_doc.pdf" else orig_is_symlink(self))

    res = paperless_manager.reconcile_missing_documents(approved=False, dry_run=True)
    assert res["ok"] is False
    assert ("Symlink" in res["message"] or "scan incomplete" in res["message"] or
            any("Symlink" in str(e) for e in res.get("errors", [])))
    mock_delete.assert_not_called()


def test_reconcile_missing_documents_hmac_rejects_unauthorized_signature(tmp_path, monkeypatch):
    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "present.pdf").write_text("real content")
    monkeypatch.setattr(paperless_manager, "get_documents_dir", lambda: docs_dir)
    monkeypatch.setattr(paperless_manager, "init_vault", lambda: None)

    fake_con = MagicMock()
    fake_cur = MagicMock()
    fake_con.cursor.return_value = fake_cur
    fake_con.__enter__.return_value = fake_con
    fake_con.__exit__.return_value = None
    fake_cur.fetchall.return_value = [
        {"id": "d-present", "filename": "present.pdf", "original_name": "present.pdf", "file_hash": "h_pres", "file_size": 50, "tags": "", "created_at": "2026-01-01"},
        {"id": "d-target", "filename": "missing.pdf", "original_name": "missing.pdf", "file_hash": "h_miss", "file_size": 100, "tags": "", "created_at": "2026-01-01"}
    ]
    monkeypatch.setattr(paperless_manager, "get_db_connection", lambda: fake_con)

    # Dry-run generates valid HMAC token
    preview = paperless_manager.reconcile_missing_documents(approved=False, dry_run=True)
    assert preview["ok"] is True
    valid_tok = preview["confirmation_token"]

    # Client tries forging token without knowing server secret (e.g. invalid HMAC or plain SHA-256)
    parts = valid_tok.split("_")
    forged_tok = f"{parts[0]}_{parts[1]}_badhmacsignature1234567890abcdef"

    res = paperless_manager.reconcile_missing_documents(approved=True, confirmation_token=forged_tok)
    assert res["ok"] is False
    assert "Candidate set changed or invalid token signature" in res["message"]


def test_weknora_get_status_refuses_unverified_listening_process(monkeypatch):
    monkeypatch.setattr(weknora_manager, "check_http_alive", lambda p, h: True)
    monkeypatch.setattr(weknora_manager, "get_listening_pid_for_port", lambda p: 9999)
    # PID 9999 is NOT a verified WeKnora executable
    monkeypatch.setattr(weknora_manager, "_is_expected_weknora_process", lambda pid: False)
    monkeypatch.setattr(weknora_manager, "_process", None)

    st = weknora_manager.status()
    # Unverified listening process MUST NOT be treated as a running WeKnora service
    assert st["running"] is False
    assert st["pid"] is None


def test_weknora_start_service_refuses_unverified_listening_process(tmp_path, monkeypatch):
    monkeypatch.setattr(weknora_manager, "_process", None)
    monkeypatch.setattr(weknora_manager, "check_http_alive", lambda p, h: True)
    monkeypatch.setattr(weknora_manager, "get_listening_pid_for_port", lambda p: 9999)
    monkeypatch.setattr(weknora_manager, "_is_expected_weknora_process", lambda pid: False)
    monkeypatch.setattr(weknora_manager, "check_port", lambda p, h: True)

    cleared = []
    monkeypatch.setattr(weknora_manager, "stop_service", lambda: cleared.append(True))
    fake_exe = tmp_path / "WeKnora-lite.exe"
    fake_exe.write_bytes(b"bin")
    monkeypatch.setattr(weknora_manager, "get_active_binary", lambda: fake_exe)
    monkeypatch.setattr(weknora_manager, "verify_binary_integrity", lambda *a: {"ok": False, "message": "fail-test"})

    # start_service does NOT return "Service is already running" and attempts to clear the port
    with pytest.raises(RuntimeError, match="WeKnora executable integrity verification failed"):
        weknora_manager.start_service()

    assert len(cleared) > 0


def test_weknora_get_status_accepts_verified_listening_process(monkeypatch):
    monkeypatch.setattr(weknora_manager, "check_http_alive", lambda p, h: True)
    monkeypatch.setattr(weknora_manager, "get_listening_pid_for_port", lambda p: 4321)
    # PID 4321 IS a verified WeKnora executable
    monkeypatch.setattr(weknora_manager, "_is_expected_weknora_process", lambda pid: pid == 4321)
    monkeypatch.setattr(weknora_manager, "_process", None)

    st = weknora_manager.status()
    assert st["running"] is True
    assert st["pid"] == 4321


def test_hmac_secret_retrieval_failure_aborts_reconciliation(monkeypatch):
    import server.security as sec
    # 1. When get_portal_token raises exception, _get_reconciliation_secret fails closed
    monkeypatch.setattr(sec, "get_portal_token", MagicMock(side_effect=RuntimeError("Token file unreadable")))
    with pytest.raises(RuntimeError, match="Token file unreadable"):
        paperless_manager._get_reconciliation_secret()

    # Dry-run reconciliation must fail closed immediately
    res_dry = paperless_manager.reconcile_missing_documents(dry_run=True)
    assert res_dry["ok"] is False
    assert res_dry["cleaned_up"] == 0
    assert "security token service unavailable" in res_dry["message"]

    # Destructive reconciliation must fail closed immediately
    res_exec = paperless_manager.reconcile_missing_documents(approved=True, confirmation_token="12345_abc_def")
    assert res_exec["ok"] is False
    assert res_exec["cleaned_up"] == 0
    assert "security token service unavailable" in res_exec["message"]

    # 2. When get_portal_token returns empty string or whitespace
    monkeypatch.setattr(sec, "get_portal_token", lambda: "   ")
    with pytest.raises(RuntimeError, match="Protected server secret unavailable"):
        paperless_manager._get_reconciliation_secret()


def test_reconcile_missing_documents_aborts_on_symlink_directory(tmp_path, monkeypatch):
    mock_delete = MagicMock()
    monkeypatch.setattr(paperless_manager, "delete_document", mock_delete)
    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "present.pdf").write_text("real content")
    sub_dir = docs_dir / "sub_dir"
    sub_dir.mkdir()
    (sub_dir / "inside.pdf").write_text("inside content")

    monkeypatch.setattr(paperless_manager, "get_documents_dir", lambda: docs_dir)
    monkeypatch.setattr(paperless_manager, "init_vault", lambda: None)

    fake_con = MagicMock()
    fake_cur = MagicMock()
    fake_con.cursor.return_value = fake_cur
    fake_con.__enter__.return_value = fake_con
    fake_con.__exit__.return_value = None
    fake_cur.fetchall.return_value = [
        {"id": "d-present", "filename": "present.pdf", "original_name": "present.pdf", "file_hash": "h_pres", "file_size": 50, "tags": "", "created_at": "2026-01-01"},
        {"id": "d-inside", "filename": "sub_dir/inside.pdf", "original_name": "inside.pdf", "file_hash": "h_ins", "file_size": 100, "tags": "", "created_at": "2026-01-01"},
    ]
    monkeypatch.setattr(paperless_manager, "get_db_connection", lambda: fake_con)

    # Simulate sub_dir being detected as a symlink directory
    orig_is_symlink = Path.is_symlink
    monkeypatch.setattr(Path, "is_symlink", lambda self: True if self.name == "sub_dir" else orig_is_symlink(self))

    res = paperless_manager.reconcile_missing_documents(approved=False, dry_run=True)
    # Must abort before candidate calculation
    assert res["ok"] is False
    assert res["cleaned_up"] == 0
    assert "Archive directory scan incomplete" in res["message"] or "Symlink directory rejected" in res["message"]
    # Candidate calculation was aborted, so no candidates are queued and nothing is deleted
    assert res.get("candidates") is None or len(res.get("candidates", [])) == 0
    mock_delete.assert_not_called()


def test_windows_acl_rejects_unauthorized_explicit_aces(tmp_path):
    import os
    if os.name != "nt":
        return
    import subprocess
    from server.security import _verify_windows_acl, secure_path_permissions

    test_file = tmp_path / "test_acl_reject.txt"
    test_file.write_text("secret-token")
    username = os.environ.get("USERNAME") or "user"

    # Reset and establish clean permissions first
    assert secure_path_permissions(test_file, is_dir=False) is True
    assert _verify_windows_acl(test_file, username) is True

    # 1. Grant explicit ACE to BUILTIN\Administrators - policy must not silently allow additional principals
    subprocess.run(["icacls", str(test_file), "/grant", "BUILTIN\\Administrators:(F)"], capture_output=True, check=False)
    assert _verify_windows_acl(test_file, username) is False

    # Clean back up
    assert secure_path_permissions(test_file, is_dir=False) is True
    assert _verify_windows_acl(test_file, username) is True

    # 2. Grant explicit ACE to Guest
    subprocess.run(["icacls", str(test_file), "/grant", "Guest:(R)"], capture_output=True, check=False)
    assert _verify_windows_acl(test_file, username) is False


def test_secure_path_permissions_fails_when_icacls_commands_fail(tmp_path, monkeypatch):
    import os
    if os.name != "nt":
        return
    import subprocess
    import server.security as sec

    test_file = tmp_path / "test_icacls_fail.txt"
    test_file.write_text("secret")

    orig_run = subprocess.run

    # Test failure on icacls /reset
    def fake_run_reset_fail(cmd, *args, **kwargs):
        if len(cmd) >= 3 and cmd[0] == "icacls" and cmd[2] == "/reset":
            return subprocess.CompletedProcess(cmd, returncode=1, stdout="", stderr="Access denied")
        return orig_run(cmd, *args, **kwargs)

    monkeypatch.setattr(subprocess, "run", fake_run_reset_fail)
    assert sec.secure_path_permissions(test_file, is_dir=False) is False

    # Test failure on icacls /remove:g
    def fake_run_remove_fail(cmd, *args, **kwargs):
        if len(cmd) >= 3 and cmd[0] == "icacls" and cmd[2] == "/remove:g":
            return subprocess.CompletedProcess(cmd, returncode=1, stdout="", stderr="Access denied")
        return orig_run(cmd, *args, **kwargs)

    monkeypatch.setattr(subprocess, "run", fake_run_remove_fail)
    assert sec.secure_path_permissions(test_file, is_dir=False) is False

    # Test failure on icacls /inheritance:r
    def fake_run_inherit_fail(cmd, *args, **kwargs):
        if len(cmd) >= 3 and cmd[0] == "icacls" and cmd[2] == "/inheritance:r":
            return subprocess.CompletedProcess(cmd, returncode=1, stdout="", stderr="Access denied")
        return orig_run(cmd, *args, **kwargs)

    monkeypatch.setattr(subprocess, "run", fake_run_inherit_fail)
    assert sec.secure_path_permissions(test_file, is_dir=False) is False

    # Test failure on icacls /grant:r
    def fake_run_grant_fail(cmd, *args, **kwargs):
        if len(cmd) >= 3 and cmd[0] == "icacls" and cmd[2] == "/grant:r":
            return subprocess.CompletedProcess(cmd, returncode=1, stdout="", stderr="Access denied")
        return orig_run(cmd, *args, **kwargs)

    monkeypatch.setattr(subprocess, "run", fake_run_grant_fail)
    assert sec.secure_path_permissions(test_file, is_dir=False) is False


def test_run_py_port_parsing_and_process_verification(monkeypatch):
    import run

    # 1. Test parsing netstat without shell
    fake_netstat = (
        "Active Connections\n"
        "  Proto  Local Address          Foreign Address        State           PID\n"
        "  TCP    127.0.0.1:8100         0.0.0.0:0              LISTENING       12345\n"
        "  TCP    127.0.0.1:18100        0.0.0.0:0              LISTENING       99999\n"
    )
    monkeypatch.setattr(subprocess, "run", lambda cmd, *a, **kw: MagicMock(returncode=0, stdout=fake_netstat))
    pid = run._find_pid_on_port(8100)
    assert pid == 12345

    # 2. Test refusing to kill unverified process
    monkeypatch.setattr(run, "_is_expected_one_ead_process", lambda p: False)
    killed = []
    monkeypatch.setattr(subprocess, "run", lambda cmd, *a, **kw: killed.append(cmd) or MagicMock(returncode=0))
    res = run._kill_pid(12345)
    assert res is False
    assert len(killed) == 0

    # 3. Test killing verified process
    monkeypatch.setattr(run, "_is_expected_one_ead_process", lambda p: True)
    res_ok = run._kill_pid(12345)
    assert res_ok is True
    assert len(killed) == 1
    assert "12345" in killed[0]


def test_deep_tutor_process_verification_and_orphan_safety(monkeypatch):
    from modules.deep_tutor import deep_tutor

    # 1. Non-matching process is rejected
    monkeypatch.setattr(deep_tutor, "_is_expected_deep_tutor_process", lambda p: False)
    killed = []
    orig_run = subprocess.run
    monkeypatch.setattr(subprocess, "run", lambda cmd, *a, **kw: killed.append(cmd) if cmd[0] == "taskkill" else orig_run(cmd, *a, **kw))

    deep_tutor._kill_tree(8888)
    assert len(killed) == 0

    # 2. In stop_service, unverified orphan PID is not killed
    monkeypatch.setattr(deep_tutor, "_find_pids_by_port", lambda port: [8888])
    monkeypatch.setattr(deep_tutor, "_proc", None)
    monkeypatch.setattr(deep_tutor, "_adopted_pid", None)
    deep_tutor.stop_service()
    assert len(killed) == 0


def test_deep_tutor_serve_fails_closed_when_loopback_patch_fails(monkeypatch):
    from modules.deep_tutor import _serve

    fake_launcher = MagicMock()
    mock_deeptutor_runtime = MagicMock(launcher=fake_launcher)
    monkeypatch.setitem(sys.modules, "deeptutor", MagicMock())
    monkeypatch.setitem(sys.modules, "deeptutor.runtime", mock_deeptutor_runtime)
    monkeypatch.setattr(sys, "argv", ["_serve.py", "fake_home_path"])

    # Loopback patch fails
    monkeypatch.setattr(_serve, "_patch", lambda launcher: False)

    # Calling the actual _serve.main() must raise RuntimeError and never start launcher
    with pytest.raises(RuntimeError, match="Failed to patch DeepTutor launcher for loopback-only binding"):
        _serve.main()

    fake_launcher.start.assert_not_called()


def test_deep_tutor_ollama_redirect_validation():
    from modules.deep_tutor.deep_tutor import _LoopbackRedirectHandler
    handler = _LoopbackRedirectHandler()
    req_orig = urllib.request.Request("http://127.0.0.1:11434/api/tags")

    # 1. External domain redirect is rejected
    with pytest.raises(urllib.error.HTTPError):
        handler.redirect_request(req_orig, None, 302, "Found", {}, "http://evil.com/api/tags")

    # 2. Non-http scheme is rejected
    with pytest.raises(urllib.error.HTTPError):
        handler.redirect_request(req_orig, None, 302, "Found", {}, "https://127.0.0.1:11434/api/tags")

    # 3. Credentials in URL are rejected
    with pytest.raises(urllib.error.HTTPError):
        handler.redirect_request(req_orig, None, 302, "Found", {}, "http://admin:secret@127.0.0.1:11434/api/tags")

    # 4. Unapproved port is rejected
    with pytest.raises(urllib.error.HTTPError):
        handler.redirect_request(req_orig, None, 302, "Found", {}, "http://127.0.0.1:8080/api/tags")

    # 5. Approved loopback request is allowed
    req = handler.redirect_request(req_orig, None, 302, "Found", {}, "http://127.0.0.1:11434/api/tags")
    assert req is not None


def test_open_vault_in_explorer_rejects_path_traversal(tmp_path, monkeypatch):
    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    monkeypatch.setattr(paperless_manager, "get_documents_dir", lambda: docs_dir)
    monkeypatch.setattr(paperless_manager, "init_vault", lambda: None)

    # Path traversal with ..
    res = paperless_manager.open_vault_in_explorer(subfolder="../../secret")
    assert res["ok"] is False
    assert "Path traversal rejected" in res["error"]

    # Absolute path traversal
    res_abs = paperless_manager.open_vault_in_explorer(subfolder="C:\\Windows\\System32")
    assert res_abs["ok"] is False
    assert "Path traversal rejected" in res_abs["error"]


def test_paperless_download_and_view_do_not_delete_missing_file(monkeypatch):
    import modules.paperless_ngx.module as paperless_module
    from fastapi import HTTPException

    mock_delete = MagicMock()
    monkeypatch.setattr(paperless_manager, "delete_document", mock_delete)
    monkeypatch.setattr(paperless_manager, "get_document", lambda d_id: {"id": d_id, "filename": "nonexistent.pdf", "original_name": "nonexistent.pdf"})

    with pytest.raises(HTTPException) as exc1:
        paperless_module.download_document("doc-test-1")
    assert exc1.value.status_code == 404
    mock_delete.assert_not_called()

    with pytest.raises(HTTPException) as exc2:
        paperless_module.view_document("doc-test-1")
    assert exc2.value.status_code == 404
    mock_delete.assert_not_called()


def test_check_deps_secures_stamp_permissions_fail_closed(tmp_path, monkeypatch):
    import server.check_deps as cd
    import server.security as sec

    stamp_file = tmp_path / ".deps_ok"
    lock_file = tmp_path / "requirements.lock"
    monkeypatch.setattr(cd, "STAMP_FILE", stamp_file)
    monkeypatch.setattr(cd, "LOCK_FILE", lock_file)

    # 1. When secure_path_permissions returns False during mark_verified, it must fail closed
    monkeypatch.setattr(cd, "verify_installed_against_lock", lambda *a: (True, []))
    monkeypatch.setattr(sec, "secure_path_permissions", lambda p, **kw: False)

    lock_file.write_text("package==1.0.0 --hash=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n")
    res = cd.mark_verified()
    assert res is False
    assert not stamp_file.exists()

    # 2. When is_already_verified sees stamp file whose permissions cannot be verified, it returns False
    stamp_file.write_text('{"signature": "test"}')
    monkeypatch.setattr(cd, "verify_lockfile_integrity", lambda *a: (True, "", []))
    assert cd.is_already_verified() is False


def test_deep_tutor_secures_home_dir_and_settings(tmp_path, monkeypatch):
    from modules.deep_tutor import deep_tutor

    fake_home = tmp_path / "home"
    monkeypatch.setattr(deep_tutor, "HOME_DIR", fake_home)

    # When secure_path_permissions on HOME_DIR fails, _ensure_ports must raise PermissionError
    monkeypatch.setattr(deep_tutor, "secure_path_permissions", lambda p, **kw: False)

    with pytest.raises(PermissionError, match="Failed to secure NTFS permissions on DeepTutor home directory"):
        deep_tutor._ensure_ports()


def test_deep_tutor_write_json_fails_closed_when_permissions_fail(tmp_path, monkeypatch):
    from modules.deep_tutor import deep_tutor

    test_file = tmp_path / "config.json"
    monkeypatch.setattr(deep_tutor, "secure_path_permissions", lambda p, **kw: False)

    # _write_json must raise PermissionError and clean up the file
    with pytest.raises(PermissionError, match="Failed to secure NTFS permissions"):
        deep_tutor._write_json(test_file, {"test": "value"})

    assert not test_file.exists()

    # set_config must fail closed with PermissionError
    monkeypatch.setattr(deep_tutor, "CONFIG_FILE", test_file)
    with pytest.raises(PermissionError, match="Failed to secure NTFS permissions"):
        deep_tutor.set_config({"auto_update": False})


def test_weknora_download_fails_closed_when_permissions_fail(tmp_path, monkeypatch):
    import os
    if os.name != "nt":
        return
    import zipfile
    from modules.weknora.scripts import download_binary
    import server.security as sec

    # When secure_path_permissions fails, install_from_zip and download must fail closed and clean up
    monkeypatch.setattr(sec, "secure_path_permissions", lambda p, **kw: False)

    # Create dummy zip with WeKnora-lite.exe
    zip_path = tmp_path / "test.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr(download_binary.BINARY_NAME, b"MZfakeexe")

    target_dir = tmp_path / "module_dir"
    target_dir.mkdir()

    with pytest.raises(download_binary.IntegrityError, match="Failed to secure NTFS permissions on installed binary"):
        download_binary.install_from_zip(zip_path, target_dir)

    installed_exe = target_dir / download_binary.BINARY_NAME
    assert not installed_exe.exists()


def test_deep_tutor_write_json_preserves_existing_file_when_permissions_fail(tmp_path, monkeypatch):
    from modules.deep_tutor import deep_tutor

    settings_file = tmp_path / "system.json"
    original_data = {"existing_key": "original_value", "nested": {"counter": 42}}
    settings_file.write_text(json.dumps(original_data), encoding="utf-8")

    # Simulate permission hardening failure
    monkeypatch.setattr(deep_tutor, "secure_path_permissions", lambda p, **kw: False)

    # Attempt to overwrite existing settings file
    new_data = {"existing_key": "overwritten", "malicious": True}
    with pytest.raises(PermissionError, match="Failed to secure NTFS permissions"):
        deep_tutor._write_json(settings_file, new_data)

    # Verify existing settings file remains intact and completely unchanged
    assert settings_file.exists()
    assert json.loads(settings_file.read_text(encoding="utf-8")) == original_data

    # Verify no temporary files remain in directory
    assert list(tmp_path.glob("*.tmp")) == []


def test_weknora_raw_binary_download_fails_closed_when_permissions_fail(tmp_path, monkeypatch):
    import hashlib
    from modules.weknora.scripts import download_binary
    import server.security as sec

    # Route installation directory and metadata files to isolated tmp_path
    monkeypatch.setattr(download_binary, "MODULE_DIR", tmp_path)
    monkeypatch.setattr(download_binary.os, "name", "nt")
    monkeypatch.setattr(sec, "secure_path_permissions", lambda p, **kw: False)

    fake_raw_binary = b"MZrawexecutableforweknora"
    raw_sha = hashlib.sha256(fake_raw_binary).hexdigest()

    def fake_download_stream(url, target_path, progress):
        target_path.write_bytes(fake_raw_binary)

    monkeypatch.setattr(download_binary, "download_stream", fake_download_stream)
    monkeypatch.setattr(download_binary, "expected_sha256", lambda asset, tag: raw_sha)

    custom_url = "https://github.com/chlin1983/one-ead/releases/download/v1.0.0/WeKnora-lite.exe"
    res = download_binary.download_weknora_binary(custom_url=custom_url, force=True)

    # 1. Installation reports failure
    assert res["ok"] is False
    assert any("Failed to secure NTFS permissions" in str(err) for err in res.get("errors", [])) or "Failed to secure NTFS permissions" in res.get("message", "")

    # 2. The newly downloaded executable is not left behind
    target_exe = tmp_path / download_binary.BINARY_NAME
    assert not target_exe.exists()

    # 3. No successful installation metadata is written
    build_info = tmp_path / "build_info.json"
    assert not build_info.exists()
