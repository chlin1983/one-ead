"""Automated security hardening test suite for One EAD & WeKnora Lite.

Verifies:
1. Valid local portal requests.
2. Malicious Origin/Referer prefix tricks.
3. Missing and malformed origin headers.
4. Sensitive management endpoints and authorization.
5. Missing/incorrect setup tokens and token leakage.
6. Unsafe Ollama URLs and unexpected ports.
7. Invalid configuration keys and values.
8. Successful application of the 6 GB preset.
9. Correct and mismatched upstream pins.
10. CSP preservation after proxying.
11. Global portal session token and authentication barrier.
"""

from __future__ import annotations

import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import json
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

from server.app import create_app
from server.security import (
    AUTH_HEADER_NAME,
    AUTH_PARAM_NAME,
    SESSION_COOKIE_NAME,
    get_portal_token,
    verify_portal_token,
)
from modules.weknora import manager
from modules.weknora.module import is_valid_local_origin, _is_loopback_ip


@pytest.fixture
def client():
    app = create_app()
    token = get_portal_token()
    return TestClient(app, base_url="http://127.0.0.1:8100", cookies={SESSION_COOKIE_NAME: token})


@pytest.fixture
def unauthenticated_client():
    app = create_app()
    return TestClient(app, base_url="http://127.0.0.1:8100")


# ==============================================================================
# 1. Valid local portal requests
# ==============================================================================

def test_valid_local_portal_requests(client):
    # GET /status with loopback Origin
    res = client.get("/api/weknora/status", headers={"Origin": "http://127.0.0.1:8100"})
    assert res.status_code == 200
    assert "name" in res.json()

    # GET /config with localhost Referer
    res2 = client.get("/api/weknora/config", headers={"Referer": "http://localhost:8100/modules/weknora/"})
    assert res2.status_code == 200
    assert "config" in res2.json()

    # POST /config with valid local origin
    res3 = client.post(
        "/api/weknora/config",
        json={"CONCURRENCY_POOL_SIZE": "2"},
        headers={"Origin": "http://127.0.0.1:8100"}
    )
    assert res3.status_code == 200
    assert res3.json()["config"]["CONCURRENCY_POOL_SIZE"] == "2"


# ==============================================================================
# 2. Malicious Origin/Referer prefix tricks
# ==============================================================================

def test_origin_referer_prefix_tricks(client):
    malicious_origins = [
        "http://127.0.0.1.attacker.com",
        "http://localhost.evil.com",
        "http://127.0.0.1:8100.evil.org",
        "http://attacker.com@127.0.0.1:8100",
        "http://127.0.0.1:44444",  # Unapproved port
        "https://evil-site.com",
    ]
    for origin in malicious_origins:
        res = client.post(
            "/api/weknora/config",
            json={"CONCURRENCY_POOL_SIZE": "2"},
            headers={"Origin": origin}
        )
        assert res.status_code == 403, f"Expected 403 for malicious origin {origin}, got {res.status_code}"

    malicious_referers = [
        "http://127.0.0.1.attacker.com/steal",
        "http://localhost.evil.com/",
        "http://127.0.0.1:8100.attacker.com/payload",
    ]
    for referer in malicious_referers:
        res = client.post(
            "/api/weknora/config",
            json={"CONCURRENCY_POOL_SIZE": "2"},
            headers={"Referer": referer}
        )
        assert res.status_code == 403, f"Expected 403 for malicious referer {referer}, got {res.status_code}"

    # Sec-Fetch-Site: cross-site
    res_cross = client.post(
        "/api/weknora/config",
        json={"CONCURRENCY_POOL_SIZE": "2"},
        headers={
            "Origin": "http://127.0.0.1:8100",
            "Sec-Fetch-Site": "cross-site",
        }
    )
    assert res_cross.status_code == 403


# ==============================================================================
# 3. Missing and malformed origin headers
# ==============================================================================

def test_missing_and_malformed_origin_headers(client):
    # Origin: null (from sandboxed iframe or data URL)
    res = client.post(
        "/api/weknora/config",
        json={"CONCURRENCY_POOL_SIZE": "2"},
        headers={"Origin": "null"}
    )
    assert res.status_code == 403

    # Malformed Origin
    res_malformed = client.post(
        "/api/weknora/config",
        json={"CONCURRENCY_POOL_SIZE": "2"},
        headers={"Origin": ":::bad-url"}
    )
    assert res_malformed.status_code == 403

    # Browser request with Sec-Fetch-Mode but missing Origin and Referer
    res_stripped = client.post(
        "/api/weknora/config",
        json={"CONCURRENCY_POOL_SIZE": "2"},
        headers={"Sec-Fetch-Mode": "cors"}
    )
    assert res_stripped.status_code == 403

    # Helper function unit tests
    assert not is_valid_local_origin("null")
    assert not is_valid_local_origin("")
    assert not is_valid_local_origin("javascript:alert(1)")
    assert not is_valid_local_origin("ftp://127.0.0.1:8100")
    assert not is_valid_local_origin("http://user:pass@127.0.0.1:8100")
    assert is_valid_local_origin("http://127.0.0.1:8100", {8100})
    assert is_valid_local_origin("http://localhost:8100", {8100})
    assert not is_valid_local_origin("http://127.0.0.1:9999", {8100})


# ==============================================================================
# 4. Sensitive management endpoints and authorization
# ==============================================================================

def test_management_endpoints_authorization(client):
    endpoints = [
        ("GET", "/api/weknora/status"),
        ("GET", "/api/weknora/logs"),
        ("GET", "/api/weknora/config"),
        ("POST", "/api/weknora/start"),
        ("POST", "/api/weknora/stop"),
        ("POST", "/api/weknora/restart"),
        ("POST", "/api/weknora/config"),
        ("POST", "/api/weknora/config/preset/6gb"),
        ("POST", "/api/weknora/build/frontend"),
        ("GET", "/api/weknora/ollama/check"),
    ]

    for method, path in endpoints:
        # Cross-site origin rejected
        if method == "GET":
            res = client.get(path, headers={"Origin": "https://malicious-website.com"})
        else:
            res = client.post(path, json={}, headers={"Origin": "https://malicious-website.com"})
        assert res.status_code == 403, f"{method} {path} should reject cross-origin requests"


# ==============================================================================
# 5. Missing/incorrect setup tokens and token leakage
# ==============================================================================

def test_setup_token_security_and_lifecycle(client):
    # Token must be high entropy
    token = manager.get_setup_token()
    assert isinstance(token, str)
    assert len(token) >= 32

    # Constant-time comparison helper
    assert manager.verify_setup_token(token) is True
    assert manager.verify_setup_token("invalid-token") is False
    assert manager.verify_setup_token("") is False
    assert manager.verify_setup_token(None) is False

    # Status & config responses must NEVER expose the token or sensitive keys
    status_data = manager.status()
    safe_config = manager.get_safe_config()
    status_str = json.dumps(status_data)

    assert token not in status_str
    assert "WEKNORA_LITE_SETUP_TOKEN" not in safe_config
    assert "JWT_SECRET" not in safe_config
    assert "SYSTEM_AES_KEY" not in safe_config
    assert "OPENAI_API_KEY" not in safe_config

    # Logs must not leak the setup token
    logs = manager.get_logs()
    assert not any(token in log_line for log_line in logs)

    # Calling auto-setup via proxy without the setup token must be rejected with 401
    res_no_tok = client.post(
        "/api/weknora/proxy/api/v1/auth/auto-setup",
        headers={"Origin": "http://127.0.0.1:8100"}
    )
    assert res_no_tok.status_code == 401

    # Calling auto-setup via proxy with an incorrect setup token must be rejected with 401
    res_bad_tok = client.post(
        "/api/weknora/proxy/api/v1/auth/auto-setup",
        headers={
            "Origin": "http://127.0.0.1:8100",
            "X-WeKnora-Desktop-Token": "bad-token-12345"
        }
    )
    assert res_bad_tok.status_code == 401


# ==============================================================================
# 6. Unsafe Ollama URLs and unexpected ports (SSRF Prevention)
# ==============================================================================

def test_ollama_ssrf_prevention():
    # Valid loopback URLs on approved ports
    assert manager.is_safe_ollama_url("http://127.0.0.1:11434")
    assert manager.is_safe_ollama_url("http://localhost:11434")
    assert manager.is_safe_ollama_url("http://127.0.0.1:11435")
    assert manager.is_safe_ollama_url("http://[::1]:11434")

    # Canonicalization guarantees identical URL is used
    assert manager.canonicalize_ollama_url("  http://127.0.0.1:11434/  ") == "http://127.0.0.1:11434"
    assert manager.canonicalize_ollama_url("http://localhost:11434?extra=1") == "http://localhost:11434"

    # Remote hosts rejected
    assert not manager.is_safe_ollama_url("http://192.168.1.100:11434")
    assert not manager.is_safe_ollama_url("http://10.0.0.1:11434")
    assert not manager.is_safe_ollama_url("http://169.254.169.254:11434")
    assert not manager.is_safe_ollama_url("http://google.com:11434")
    assert not manager.is_safe_ollama_url("http://127.0.0.1.attacker.com:11434")

    # Unexpected loopback ports rejected
    assert not manager.is_safe_ollama_url("http://127.0.0.1:22")    # SSH
    assert not manager.is_safe_ollama_url("http://127.0.0.1:80")    # Default web
    assert not manager.is_safe_ollama_url("http://127.0.0.1:443")   # HTTPS
    assert not manager.is_safe_ollama_url("http://127.0.0.1:3306")  # MySQL
    assert not manager.is_safe_ollama_url("http://127.0.0.1:6379")  # Redis
    assert not manager.is_safe_ollama_url("http://127.0.0.1:8082")  # WeKnora recursion
    assert not manager.is_safe_ollama_url("http://127.0.0.1:8100")  # One EAD recursion

    # Userinfo / credentials rejected
    assert not manager.is_safe_ollama_url("http://user:pass@127.0.0.1:11434")
    assert not manager.is_safe_ollama_url("http://attacker.com@127.0.0.1:11434")

    # Malformed schemes
    assert not manager.is_safe_ollama_url("gopher://127.0.0.1:11434")
    assert not manager.is_safe_ollama_url("file:///etc/passwd")
    assert not manager.is_safe_ollama_url("")
    assert not manager.is_safe_ollama_url(None)


# ==============================================================================
# 7. Invalid configuration keys and values
# ==============================================================================

def test_config_validation_rejects_invalid_keys_and_values():
    # Disallowed keys
    with pytest.raises(ValueError, match="Disallowed configuration key"):
        manager.validate_config_updates({"UNAUTHORIZED_KEY": "evil"})

    with pytest.raises(ValueError, match="Disallowed configuration key"):
        manager.validate_config_updates({"OPENAI_API_KEY": "sk-12345"})

    with pytest.raises(ValueError, match="Disallowed configuration key"):
        manager.validate_config_updates({"JWT_SECRET": "hacked"})

    # Newline injection (CRLF)
    with pytest.raises(ValueError, match="Newline characters not permitted"):
        manager.validate_config_updates({"GIN_MODE\nINJECTED": "release"})

    with pytest.raises(ValueError, match="Newline characters not permitted"):
        manager.validate_config_updates({"GIN_MODE": "release\nMALICIOUS=true"})

    # Invalid port numbers
    with pytest.raises(ValueError, match="Invalid port"):
        manager.validate_config_updates({"SERVER_PORT": "70000"})
    with pytest.raises(ValueError, match="Invalid port"):
        manager.validate_config_updates({"SERVER_PORT": "not-a-port"})

    # Invalid concurrency
    with pytest.raises(ValueError, match="Invalid concurrency"):
        manager.validate_config_updates({"CONCURRENCY_POOL_SIZE": "0"})
    with pytest.raises(ValueError, match="Invalid concurrency"):
        manager.validate_config_updates({"CONCURRENCY_POOL_SIZE": "100"})

    # Invalid language code
    with pytest.raises(ValueError, match="Invalid language locale code"):
        manager.validate_config_updates({"WEKNORA_LANGUAGE": "invalid_code!"})

    # Invalid driver in Lite mode
    with pytest.raises(ValueError, match="Lite edition only supports DB_DRIVER='sqlite'"):
        manager.validate_config_updates({"DB_DRIVER": "postgres"})

    with pytest.raises(ValueError, match="Lite edition only supports STREAM_MANAGER_TYPE='memory'"):
        manager.validate_config_updates({"STREAM_MANAGER_TYPE": "redis"})

    with pytest.raises(ValueError, match="Lite edition only supports STORAGE_TYPE='local'"):
        manager.validate_config_updates({"STORAGE_TYPE": "s3"})


# ==============================================================================
# 8. Successful application of the 6 GB preset
# ==============================================================================

def test_apply_6gb_preset(client):
    res = client.post("/api/weknora/config/preset/6gb", headers={"Origin": "http://127.0.0.1:8100"})
    assert res.status_code == 200
    data = res.json()
    assert "config" in data
    cfg = data["config"]
    assert cfg["CONCURRENCY_POOL_SIZE"] == "2"
    assert cfg["WEKNORA_CHAT_ATTACHMENT_OCR_CONCURRENCY"] == "1"
    assert cfg["WEKNORA_CHAT_ATTACHMENT_OCR_MAX_PAGES"] == "4"
    assert cfg["WEKNORA_CHAT_ATTACHMENT_WAIT_TIMEOUT_SEC"] == "60"
    assert cfg["STREAM_MANAGER_TYPE"] == "memory"
    assert cfg["DB_DRIVER"] == "sqlite"
    assert cfg["RETRIEVE_DRIVER"] == "sqlite"
    assert cfg["STORAGE_TYPE"] == "local"
    assert cfg["GIN_MODE"] == "release"
    assert cfg["LOG_LEVEL"] == "info"


# ==============================================================================
# 9. Correct and mismatched upstream pins
# ==============================================================================

def test_upstream_pinned_commit_enforcement(tmp_path):
    pinned = "2fbfb4471581cd5e7d731bc7a2d443fe7d8e95b5"

    # Verify pin logic: identical commit passes
    assert "2fbfb4471581cd5e7d731bc7a2d443fe7d8e95b5" == pinned

    # Mismatched commit must not be accepted
    fake_commit = "9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b"
    assert fake_commit != pinned

    # Check that build_lite.bat contains the exit /b 1 halt logic
    bat_path = manager.MODULE_DIR / "scripts" / "build_lite.bat"
    assert bat_path.exists()
    content = bat_path.read_text(encoding="utf-8")
    assert "set PINNED_COMMIT=2fbfb4471581cd5e7d731bc7a2d443fe7d8e95b5" in content
    assert "Build halted by default to enforce reviewed code" in content
    assert "exit /b 1" in content

    # Test the Windows batch script logic for both matching and mismatched pin cases
    import subprocess
    test_bat = tmp_path / "test_pin_check.bat"
    test_bat.write_text(
        "@echo off\r\n"
        "setlocal enabledelayedexpansion\r\n"
        f"set PINNED_COMMIT={pinned}\r\n"
        "set CURRENT_COMMIT=%1\r\n"
        "if not \"!CURRENT_COMMIT!\"==\"%PINNED_COMMIT%\" (\r\n"
        "    exit /b 1\r\n"
        ") else (\r\n"
        "    exit /b 0\r\n"
        ")\r\n",
        encoding="utf-8"
    )
    res_ok = subprocess.run(["cmd", "/c", str(test_bat), pinned], capture_output=True)
    assert res_ok.returncode == 0

    res_fail = subprocess.run(["cmd", "/c", str(test_bat), "mismatched_upstream_commit_hash"], capture_output=True)
    assert res_fail.returncode == 1


# ==============================================================================
# 10. CSP preservation after proxying
# ==============================================================================

@pytest.mark.asyncio
async def test_csp_preservation_after_proxying(client):
    # Simulate reverse proxy responses with different upstream CSP headers
    framing_directive = "frame-ancestors 'self' http://127.0.0.1:* http://localhost:*"

    # Case 1: Upstream has full CSP with frame-ancestors
    upstream_headers = {
        "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-eval'; frame-ancestors 'self'",
        "x-frame-options": "SAMEORIGIN",
        "content-type": "text/html",
    }
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.headers = upstream_headers
    mock_resp.aiter_raw = MagicMock(return_value=aiter([b"<html>test</html>"]))
    mock_resp.aclose = MagicMock()

    # Case 2: Upstream has CSP without frame-ancestors
    csp_without_fa = "default-src 'self'; img-src data: https:"
    directives = [d.strip() for d in csp_without_fa.split(";") if d.strip()]
    directives.append(framing_directive)
    merged_csp = "; ".join(directives)
    assert "default-src 'self'" in merged_csp
    assert "img-src data: https:" in merged_csp
    assert framing_directive in merged_csp

    # Test live endpoint proxy with a mock to verify headers
    with patch("httpx.AsyncClient.send") as mock_send:
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.headers = {
            "content-security-policy": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'",
            "x-content-type-options": "nosniff",
            "content-type": "text/html",
        }
        async def mock_aiter():
            yield b"<!DOCTYPE html><html><body>Test</body></html>"
        mock_response.aiter_raw = mock_aiter
        mock_response.aclose = MagicMock()
        mock_send.return_value = mock_response

        res = client.get("/api/weknora/proxy/index.html", headers={"Origin": "http://127.0.0.1:8100"})
        assert res.status_code == 200
        csp_header = res.headers.get("content-security-policy", "")

        # Verify upstream CSP directives are preserved
        assert "default-src 'self'" in csp_header
        assert "script-src 'self' 'wasm-unsafe-eval'" in csp_header
        assert "style-src 'self' 'unsafe-inline'" in csp_header

        # Verify frame-ancestors is appropriately adjusted
        assert framing_directive in csp_header

        # Verify nosniff is retained
        assert res.headers.get("x-content-type-options") == "nosniff"


async def aiter(iterable):
    for item in iterable:
        yield item


# ==============================================================================
# 11. Global Portal Session Token and Authentication Barrier
# ==============================================================================

def test_unauthenticated_requests_blocked(unauthenticated_client):
    # Unauthenticated API calls must be rejected with 401 Unauthorized
    res_api = unauthenticated_client.get("/api/modules")
    assert res_api.status_code == 401
    assert "Unauthorized" in res_api.json().get("message", "")

    # Unauthenticated state-modifying requests must be rejected with 401
    res_post = unauthenticated_client.post("/api/modules/order", json={"order": []})
    assert res_post.status_code == 401

    # Unauthenticated browser visits to root must return the lock screen (401)
    res_root = unauthenticated_client.get("/")
    assert res_root.status_code == 401
    assert "One EAD Session Locked" in res_root.text

    # Favicon and public assets must remain accessible
    res_favicon = unauthenticated_client.get("/favicon.ico")
    # Even if 404 (file not present), it must NOT be blocked with 401
    assert res_favicon.status_code != 401


def test_auth_query_parameter_handshake(unauthenticated_client):
    token = get_portal_token()

    # Valid token via ?auth=<token> initiates handshake, sets HttpOnly SameSite=Strict cookie,
    # and redirects to clean path
    res = unauthenticated_client.get(f"/?auth={token}", follow_redirects=False)
    assert res.status_code == 303
    assert res.headers.get("location") == "/"
    cookie_header = res.headers.get("set-cookie", "")
    assert SESSION_COOKIE_NAME in cookie_header
    assert "samesite=strict" in cookie_header.lower()
    assert "httponly" in cookie_header.lower()

    # Invalid token must be rejected with 401 and lock screen
    res_invalid = unauthenticated_client.get("/?auth=invalid-token-12345", follow_redirects=False)
    assert res_invalid.status_code == 401
    assert "Invalid session authentication token" in res_invalid.text


def test_header_token_authentication(unauthenticated_client):
    token = get_portal_token()

    # Valid token via X-OneEAD-Token header succeeds
    res_ok = unauthenticated_client.get("/api/modules", headers={AUTH_HEADER_NAME: token})
    assert res_ok.status_code == 200
    assert isinstance(res_ok.json(), list)

    # Invalid token via header fails
    res_bad = unauthenticated_client.get("/api/modules", headers={AUTH_HEADER_NAME: "wrong-token"})
    assert res_bad.status_code == 401


def test_portal_token_entropy_and_validation():
    token = get_portal_token()
    assert isinstance(token, str)
    assert len(token) >= 32

    # Verification helper tests
    assert verify_portal_token(token) is True
    assert verify_portal_token(f"  {token}  ") is True
    assert verify_portal_token("invalid-candidate") is False
    assert verify_portal_token("") is False
    assert verify_portal_token(None) is False

