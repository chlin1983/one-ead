"""Supply-chain integrity tests for the WeKnora prebuilt binary downloader."""
from __future__ import annotations

import hashlib
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from modules.weknora.scripts import download_binary as db


@pytest.mark.parametrize("url", [
    "http://github.com/chlin1983/one-ead/releases/download/v1/a.zip",
    "https://evil.example/chlin1983/one-ead/releases/download/v1/a.zip",
    "https://github.com.evil.example/chlin1983/one-ead/releases/download/v1/a.zip",
    "https://github.com@evil.example/chlin1983/one-ead/releases/download/v1/a.zip",
    "https://github.com/attacker/repo/releases/download/v1/a.zip",
    "https://github.com/chlin1983/one-ead/releases/latest/download/a.zip",
    "https://github.com:8443/chlin1983/one-ead/releases/download/v1/a.zip",
    "file:///C:/Windows/System32/cmd.exe",
])
def test_rejects_unapproved_urls(url):
    with pytest.raises(db.IntegrityError):
        db.validate_download_url(url)


def test_accepts_pinned_release_url_and_cdn_redirect():
    db.validate_download_url("https://github.com/chlin1983/one-ead/releases/download/v1/a.zip")
    db.validate_download_url("https://objects.githubusercontent.com/x/y", initial=False)
    with pytest.raises(db.IntegrityError):
        db.validate_download_url("https://evil.example/x", initial=False)
    with pytest.raises(db.IntegrityError):
        db.validate_download_url("http://objects.githubusercontent.com/x", initial=False)


def test_sha256_match_and_mismatch(tmp_path):
    f = tmp_path / "p.bin"
    f.write_bytes(b"synthetic")
    db.verify_sha256(f, hashlib.sha256(b"synthetic").hexdigest())
    with pytest.raises(db.IntegrityError):
        db.verify_sha256(f, hashlib.sha256(b"tampered").hexdigest())


def test_fails_closed_without_pinned_digest(monkeypatch):
    monkeypatch.delenv("WEKNORA_RELEASE_SHA256", raising=False)
    monkeypatch.setattr(db, "load_manifest", lambda: {"tag": "v1", "assets": {}})
    with pytest.raises(db.IntegrityError):
        db.expected_sha256("WeKnora-lite.exe", "v1")


def test_manifest_digest_and_tag_pin(monkeypatch):
    digest = "a" * 64
    monkeypatch.delenv("WEKNORA_RELEASE_SHA256", raising=False)
    monkeypatch.setattr(db, "load_manifest", lambda: {"tag": "v1", "assets": {"x.zip": digest}})
    assert db.expected_sha256("x.zip", "v1") == digest
    with pytest.raises(db.IntegrityError):
        db.expected_sha256("x.zip", "v2")


def test_tampered_download_is_not_installed(monkeypatch, tmp_path):
    monkeypatch.setattr(db, "MODULE_DIR", tmp_path)
    monkeypatch.delenv("WEKNORA_RELEASE_SHA256", raising=False)
    monkeypatch.setattr(
        db, "load_manifest", lambda: {"tag": "v1", "assets": {db.DEFAULT_ASSET_ZIP: "b" * 64, db.DEFAULT_ASSET_EXE: "b" * 64}}
    )

    def fake_download(url, target, progress, timeout=60.0):
        target.write_bytes(b"malicious payload")
        return True

    monkeypatch.setattr(db, "download_stream", fake_download)
    res = db.download_weknora_binary(tag="v1", force=True, progress_callback=lambda *a: None)
    assert res["ok"] is False
    assert not (tmp_path / db.BINARY_NAME).exists()


def test_custom_url_must_be_approved(monkeypatch, tmp_path):
    monkeypatch.setattr(db, "MODULE_DIR", tmp_path)
    monkeypatch.setenv("WEKNORA_RELEASE_SHA256", "c" * 64)
    res = db.download_weknora_binary(
        custom_url="https://evil.example/WeKnora-lite.exe", force=True, progress_callback=lambda *a: None
    )
    assert res["ok"] is False
    assert not (tmp_path / db.BINARY_NAME).exists()


def test_candidate_urls_never_use_latest(monkeypatch):
    monkeypatch.setattr(db, "load_manifest", lambda: {"tag": "v9"})
    urls = db.get_candidate_urls()
    assert urls and all("/releases/download/v9/" in u and "latest" not in u for u in urls)


# ==============================================================================
# ZIP path traversal protection
# ==============================================================================
import zipfile  # noqa: E402


def _make_zip(path, entries):
    with zipfile.ZipFile(path, "w") as zf:
        for name, data in entries:
            zf.writestr(name, data)
    return path


@pytest.mark.parametrize("evil", [
    "../evil.txt",
    "dist/../../evil.txt",
    "dist/../../../evil.txt",
    "..\\evil.txt",
    "dist\\..\\..\\evil.txt",
    "/abs/evil.txt",
    "\\\\server\\share\\evil.txt",
    "C:/Windows/evil.txt",
    "C:evil.txt",
    "dist/C:/evil.txt",
    "dist/file.txt:stream",
])
def test_zip_traversal_entries_rejected(tmp_path, evil):
    module_dir = tmp_path / "mod"
    module_dir.mkdir()
    z = _make_zip(tmp_path / "bad.zip", [(db.BINARY_NAME, b"exe"), (evil, b"pwn")])
    with pytest.raises(db.IntegrityError):
        db.install_from_zip(z, module_dir)
    # Nothing escaped and nothing was installed (archive validated before any write)
    assert not (tmp_path / "evil.txt").exists()
    assert not (module_dir / db.BINARY_NAME).exists()


def test_zip_symlink_entry_rejected(tmp_path):
    module_dir = tmp_path / "mod"
    module_dir.mkdir()
    z = tmp_path / "link.zip"
    with zipfile.ZipFile(z, "w") as zf:
        info = zipfile.ZipInfo("dist/link")
        info.external_attr = (0o120777 << 16)
        zf.writestr(info, "/etc/passwd")
    with pytest.raises(db.IntegrityError):
        db.install_from_zip(z, module_dir)


def test_zip_size_limit_enforced(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "MAX_ZIP_UNCOMPRESSED_BYTES", 10)
    module_dir = tmp_path / "mod"
    module_dir.mkdir()
    z = _make_zip(tmp_path / "big.zip", [(db.BINARY_NAME, b"x" * 100)])
    with pytest.raises(db.IntegrityError):
        db.install_from_zip(z, module_dir)


def test_benign_zip_installs_inside_module_dir(tmp_path):
    module_dir = tmp_path / "mod"
    module_dir.mkdir()
    z = _make_zip(tmp_path / "ok.zip", [
        (db.BINARY_NAME, b"exe-bytes"),
        ("dist/index.html", b"<html>"),
        ("dist/assets/app.js", b"js"),
    ])
    res = db.install_from_zip(z, module_dir)
    assert res["binary"] and res["web"]
    assert (module_dir / db.BINARY_NAME).read_bytes() == b"exe-bytes"
    assert (module_dir / "dist" / "assets" / "app.js").read_bytes() == b"js"


# ==============================================================================
# Release manifest update tool
# ==============================================================================
from modules.weknora.scripts import update_release_manifest as urm  # noqa: E402


def test_manifest_build_requires_matching_sums():
    d = "a" * 64
    m = urm.build_manifest("v1", {"x.zip": d}, {"x.zip": d})
    assert m["tag"] == "v1" and m["assets"] == {"x.zip": d}
    with pytest.raises(db.IntegrityError):
        urm.build_manifest("v1", {"x.zip": d}, {"x.zip": "b" * 64})
    with pytest.raises(db.IntegrityError):
        urm.build_manifest("v1", {"x.zip": d}, {})


def test_parse_sums_rejects_malformed():
    assert urm.parse_sums(f"{'a' * 64}  x.zip\n{'b' * 64} *y.exe\n") == {"x.zip": "a" * 64, "y.exe": "b" * 64}
    with pytest.raises(db.IntegrityError):
        urm.parse_sums("nothex  x.zip")


def test_committed_manifest_still_fails_closed_without_digests(monkeypatch):
    monkeypatch.delenv("WEKNORA_RELEASE_SHA256", raising=False)
    monkeypatch.setattr(db, "load_manifest", lambda: {"tag": "v1", "assets": {}})
    with pytest.raises(db.IntegrityError):
        db.expected_sha256(db.DEFAULT_ASSET_ZIP, "v1")


# ==============================================================================
# Existing-binary verification
# ==============================================================================
def _install_fake_binary(tmp_path, monkeypatch, data=b"existing-exe"):
    monkeypatch.setattr(db, "MODULE_DIR", tmp_path)
    (tmp_path / db.BINARY_NAME).write_bytes(data)
    monkeypatch.delenv("WEKNORA_RELEASE_SHA256", raising=False)


def test_existing_binary_verified_against_pinned_digest(tmp_path, monkeypatch):
    _install_fake_binary(tmp_path, monkeypatch)
    digest = hashlib.sha256(b"existing-exe").hexdigest()
    monkeypatch.setattr(db, "load_manifest", lambda: {"tag": "v1", "assets": {db.BINARY_NAME: digest}})
    res = db.download_weknora_binary()
    assert res["ok"] and res["verified"] is True


def test_existing_binary_tampered_is_rejected(tmp_path, monkeypatch):
    _install_fake_binary(tmp_path, monkeypatch, data=b"tampered")
    digest = hashlib.sha256(b"existing-exe").hexdigest()
    monkeypatch.setattr(db, "load_manifest", lambda: {"tag": "v1", "assets": {db.BINARY_NAME: digest}})
    res = db.download_weknora_binary()
    assert res["ok"] is False and res["verified"] is False


def test_existing_binary_without_pinned_digest_rejected_unless_local_build(tmp_path, monkeypatch):
    _install_fake_binary(tmp_path, monkeypatch)
    monkeypatch.setattr(db, "load_manifest", lambda: {"tag": "v1", "assets": {}})
    assert db.download_weknora_binary()["ok"] is False  # unknown provenance: fail closed

    import json as _json
    (tmp_path / "build_info.json").write_text(_json.dumps({"pinned_commit": "abc", "edition": "lite"}))
    res = db.download_weknora_binary()
    assert res["ok"] is True and res["verified"] is False and res["local_build"] is True

    # A downloaded binary (build_info says downloaded) never gets the local-build exemption
    (tmp_path / "build_info.json").write_text(_json.dumps({"pinned_commit": "abc", "downloaded": True}))
    assert db.download_weknora_binary()["ok"] is False


# ==============================================================================
# GitHub Actions pinning
# ==============================================================================
def test_workflow_actions_pinned_to_commit_sha():
    import re
    wf = os.path.join(os.path.dirname(__file__), "..", ".github", "workflows", "build-weknora.yml")
    uses = re.findall(r"^\s*(?:-\s*)?uses:\s*(\S+)", open(wf, encoding="utf-8").read(), re.M)
    assert uses
    for ref in uses:
        assert re.fullmatch(r"[\w.-]+/[\w./-]+@[0-9a-f]{40}", ref), f"not pinned to a full commit SHA: {ref}"
