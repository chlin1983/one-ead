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
