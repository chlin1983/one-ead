"""WeKnora — Knowledge base & RAG assistant plugin for One EAD.

Runs WeKnora in Lite mode (zero external dependencies) with local LLM integration.
"""

from __future__ import annotations

import inspect
import ipaddress
import urllib.parse
from typing import Optional, Set

import httpx
from fastapi import APIRouter, Body, HTTPException, Request, Response
from fastapi.responses import StreamingResponse

from modules.weknora import manager
from server.module import PortalModule

ICON = (
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>'
    '<path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'
    '<circle cx="12" cy="8" r="2"/>'
    '<path d="M9 13h6"/>'
    '<path d="M12 10v3"/>'
    '</svg>'
)

router = APIRouter()


def _is_loopback_ip(ip_str: Optional[str]) -> bool:
    """Checks if an IP string is a valid loopback address."""
    if not ip_str:
        return False
    ip_clean = ip_str.strip().strip("[]").lower()
    if ip_clean in ("127.0.0.1", "localhost", "::1", "testclient"):
        return True
    try:
        ip = ipaddress.ip_address(ip_clean)
        return ip.is_loopback
    except ValueError:
        return False


def is_valid_local_origin(origin_str: str, allowed_ports: Optional[Set[int]] = None) -> bool:
    """Validates that a URL strictly matches an intended local loopback portal origin.
    
    Verifies scheme, hostname, port, and rejects credentials or malformed formats.
    """
    if not origin_str or not isinstance(origin_str, str):
        return False
    cleaned = origin_str.strip()
    if not cleaned or cleaned.lower() == "null":
        return False
    try:
        parsed = urllib.parse.urlsplit(cleaned)
        port = parsed.port
    except Exception:
        return False

    if parsed.scheme not in ("http", "https"):
        return False

    if parsed.username or parsed.password or "@" in parsed.netloc:
        return False

    hostname = parsed.hostname
    if not hostname:
        return False
    hostname_clean = hostname.lower().strip("[]")

    is_loopback = False
    if hostname_clean in ("127.0.0.1", "localhost", "::1"):
        is_loopback = True
    else:
        try:
            ip = ipaddress.ip_address(hostname_clean)
            if ip.is_loopback:
                is_loopback = True
        except ValueError:
            return False

    if not is_loopback:
        return False

    if port is not None:
        if not (1 <= port <= 65535):
            return False
        if allowed_ports is not None and port not in allowed_ports:
            return False

    return True


def _verify_local_request(request: Request) -> None:
    """Verifies that the request originates from a local trusted loopback client (CSRF protection)."""
    sec_fetch_site = request.headers.get("sec-fetch-site")
    if sec_fetch_site in ("cross-site",):
        raise HTTPException(403, "Cross-site request rejected.")

    cfg = manager.read_env()
    weknora_port = int(cfg.get("SERVER_PORT", cfg.get("PORT", "8082")))
    req_port = request.url.port or (443 if request.url.scheme == "https" else 80)
    allowed_ports: Set[int] = {req_port, 8100, 8082, weknora_port}

    origin = request.headers.get("origin")
    referer = request.headers.get("referer")

    if origin is not None:
        if not is_valid_local_origin(origin, allowed_ports):
            raise HTTPException(403, f"Cross-origin request rejected: {origin}")

    if referer is not None:
        if not is_valid_local_origin(referer, allowed_ports):
            raise HTTPException(403, f"Cross-origin referer rejected: {referer}")

    # Safe policy when both Origin and Referer are missing:
    if origin is None and referer is None:
        if request.method in ("POST", "PUT", "DELETE", "PATCH"):
            # If a browser sent the mutating request, reject if Origin/Referer were stripped
            sec_fetch_mode = request.headers.get("sec-fetch-mode")
            if sec_fetch_mode or sec_fetch_site:
                raise HTTPException(403, "State-modifying browser request missing Origin and Referer headers.")
            # For non-browser requests (e.g. CLI tools or internal automated tests), require loopback client
            client_host = request.client.host if request.client else ""
            if not _is_loopback_ip(client_host):
                raise HTTPException(403, "Non-local mutating request missing Origin and Referer.")
        else:
            client_host = request.client.host if request.client else ""
            if not _is_loopback_ip(client_host):
                raise HTTPException(403, "Non-local read request rejected.")


@router.get("/status")
def get_status(request: Request) -> dict:
    _verify_local_request(request)
    return manager.status()


@router.post("/start")
def start_service(request: Request) -> dict:
    _verify_local_request(request)
    try:
        return manager.start_service()
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))


@router.post("/stop")
def stop_service(request: Request) -> dict:
    _verify_local_request(request)
    return manager.stop_service()


@router.post("/restart")
def restart_service(request: Request) -> dict:
    _verify_local_request(request)
    try:
        return manager.restart_service()
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))


@router.get("/logs")
def get_logs(request: Request, limit: int = 200) -> dict:
    _verify_local_request(request)
    return {"logs": manager.get_logs(limit)}


@router.get("/config")
def get_config(request: Request) -> dict:
    _verify_local_request(request)
    return {"config": manager.get_safe_config()}


@router.post("/config")
def update_config(request: Request, payload: dict = Body(...)) -> dict:
    _verify_local_request(request)
    updates = {str(k): str(v) for k, v in payload.items() if v is not None}
    try:
        return {"config": manager.write_env(updates)}
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.post("/config/preset/6gb")
def apply_6gb_preset(request: Request) -> dict:
    """Applies optimal tuning for 6GB VRAM & 16GB RAM."""
    _verify_local_request(request)
    presets = {
        "CONCURRENCY_POOL_SIZE": "2",
        "WEKNORA_CHAT_ATTACHMENT_OCR_CONCURRENCY": "1",
        "WEKNORA_CHAT_ATTACHMENT_OCR_MAX_PAGES": "4",
        "WEKNORA_CHAT_ATTACHMENT_WAIT_TIMEOUT_SEC": "60",
        "STREAM_MANAGER_TYPE": "memory",
        "DB_DRIVER": "sqlite",
        "RETRIEVE_DRIVER": "sqlite",
        "STORAGE_TYPE": "local",
        "GIN_MODE": "release",
        "LOG_LEVEL": "info",
    }
    return {"config": manager.write_env(presets), "message": "Applied 6GB VRAM / 16GB RAM profile presets"}


@router.post("/build/frontend")
def trigger_frontend_build(request: Request) -> dict:
    _verify_local_request(request)
    if manager._build_status.get("building"):
        return {"ok": False, "message": "Frontend build is already in progress"}
    manager.run_frontend_build()
    return {"ok": True, "message": "Frontend build started in background"}


@router.post("/download/binary")
def trigger_binary_download(request: Request, payload: Optional[dict] = Body(None)) -> dict:
    _verify_local_request(request)
    custom_url = payload.get("url") if payload else None
    force = bool(payload.get("force")) if payload else False
    return manager.start_binary_download(custom_url=custom_url, force=force)


@router.get("/download/status")
def get_download_status(request: Request) -> dict:
    _verify_local_request(request)
    return manager.get_download_status()



@router.get("/ollama/check")
def check_ollama(request: Request, url: str = "") -> dict:
    _verify_local_request(request)
    if url and not manager.is_safe_ollama_url(url):
        raise HTTPException(400, "SSRF Protection: Only local loopback Ollama endpoints (127.0.0.1 / localhost) on approved ports (11434) may be probed.")
    return manager.check_ollama(url if url else None)


@router.api_route("/proxy/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])
async def proxy_weknora(path: str, request: Request):
    """Transparent reverse-proxy with SSRF prevention and secure desktop token injection."""
    _verify_local_request(request)
    cfg = manager.read_env()
    # Force host strictly to loopback to prevent SSRF
    host = "127.0.0.1"
    port = cfg.get("SERVER_PORT", cfg.get("PORT", "8082"))
    target_base = f"http://{host}:{port}"
    target_url = f"{target_base}/{path}"
    if request.url.query:
        target_url = f"{target_url}?{request.url.query}"

    req_headers = {}
    for k, v in request.headers.items():
        if k.lower() not in {"host", "connection", "content-length"}:
            req_headers[k] = v

    # Auto-setup authorization protection:
    # Ensure proxy cannot bypass the desktop setup token barrier for unauthorized callers.
    is_auto_setup = (path == "api/v1/auth/auto-setup" or path.endswith("/auth/auto-setup"))
    if is_auto_setup:
        provided_token = request.headers.get("x-weknora-desktop-token", "")
        if not manager.verify_setup_token(provided_token):
            raise HTTPException(401, "Desktop authentication token is required or invalid for auto-setup.")
        req_headers["X-WeKnora-Desktop-Token"] = provided_token

    body = await request.body()

    try:
        client = httpx.AsyncClient(timeout=60.0)
        req = client.build_request(
            method=request.method,
            url=target_url,
            headers=req_headers,
            content=body,
        )
        resp = await client.send(req, stream=True)

        excluded_headers = {
            "x-frame-options",
            "content-encoding",
            "transfer-encoding",
            "connection",
        }
        res_headers = {
            k: v for k, v in resp.headers.items() if k.lower() not in excluded_headers
        }

        # Secure framing policy: preserve upstream CSP directives while adjusting frame-ancestors
        framing_directive = "frame-ancestors 'self' http://127.0.0.1:* http://localhost:*"
        upstream_csp = resp.headers.get("content-security-policy")
        if upstream_csp:
            directives = [d.strip() for d in upstream_csp.split(";") if d.strip()]
            updated = False
            new_directives = []
            for d in directives:
                if d.lower().startswith("frame-ancestors"):
                    new_directives.append(framing_directive)
                    updated = True
                else:
                    new_directives.append(d)
            if not updated:
                new_directives.append(framing_directive)
            res_headers["content-security-policy"] = "; ".join(new_directives)
        else:
            res_headers["content-security-policy"] = framing_directive

        res_headers["x-content-type-options"] = "nosniff"

        async def stream_generator():
            try:
                async for chunk in resp.aiter_raw():
                    yield chunk
            finally:
                if hasattr(resp, "aclose"):
                    res = resp.aclose()
                    if inspect.isawaitable(res):
                        await res
                if hasattr(client, "aclose"):
                    res = client.aclose()
                    if inspect.isawaitable(res):
                        await res

        return StreamingResponse(
            stream_generator(),
            status_code=resp.status_code,
            headers=res_headers,
            media_type=resp.headers.get("content-type"),
        )
    except httpx.ConnectError:
        raise HTTPException(502, f"WeKnora service not reachable at {target_base}. Is the service started?")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, f"Proxy error: {exc}")


MODULE = PortalModule(
    id="weknora",
    title="WeKnora",
    subtitle="Knowledge base & RAG (Lite Mode)",
    icon=ICON,
    accent="#07c160",
    order=90,
    web_dir="web",
    router=router,
)
