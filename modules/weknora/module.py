"""WeKnora — Knowledge base & RAG assistant plugin for One EAD.

Runs WeKnora in Lite mode (zero external dependencies) with local LLM integration.
"""

from __future__ import annotations

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


@router.get("/status")
def get_status() -> dict:
    return manager.status()


@router.post("/start")
def start_service() -> dict:
    try:
        return manager.start_service()
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))


@router.post("/stop")
def stop_service() -> dict:
    return manager.stop_service()


@router.post("/restart")
def restart_service() -> dict:
    try:
        return manager.restart_service()
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))


@router.get("/logs")
def get_logs(limit: int = 200) -> dict:
    return {"logs": manager.get_logs(limit)}


@router.get("/config")
def get_config() -> dict:
    return {"config": manager.read_env()}


@router.post("/config")
def update_config(payload: dict = Body(...)) -> dict:
    updates = {str(k): str(v) for k, v in payload.items() if v is not None}
    return {"config": manager.write_env(updates)}


@router.post("/config/preset/6gb")
def apply_6gb_preset() -> dict:
    """Applies optimal tuning for 6GB VRAM & 16GB RAM."""
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
def trigger_frontend_build() -> dict:
    manager.run_frontend_build()
    return {"ok": True, "message": "Frontend build started in background"}


@router.get("/ollama/check")
def check_ollama(url: str = "") -> dict:
    return manager.check_ollama(url if url else None)


@router.api_route("/proxy/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])
async def proxy_weknora(path: str, request: Request):
    """Transparent reverse-proxy that strips X-Frame-Options & CSP so WeKnora embeds in iframe."""
    cfg = manager.read_env()
    host = cfg.get("SERVER_HOST", "127.0.0.1")
    port = cfg.get("SERVER_PORT", cfg.get("PORT", "8082"))
    target_base = f"http://{host}:{port}"
    target_url = f"{target_base}/{path}"
    if request.url.query:
        target_url = f"{target_url}?{request.url.query}"

    req_headers = {}
    for k, v in request.headers.items():
        if k.lower() not in {"host", "connection", "content-length"}:
            req_headers[k] = v

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
            "content-security-policy",
            "content-encoding",
            "transfer-encoding",
            "connection",
        }
        res_headers = {
            k: v for k, v in resp.headers.items() if k.lower() not in excluded_headers
        }

        async def stream_generator():
            try:
                async for chunk in resp.aiter_raw():
                    yield chunk
            finally:
                await resp.aclose()
                await client.aclose()

        return StreamingResponse(
            stream_generator(),
            status_code=resp.status_code,
            headers=res_headers,
            media_type=resp.headers.get("content-type"),
        )
    except httpx.ConnectError:
        raise HTTPException(502, f"WeKnora service not reachable at {target_base}. Is the service started?")
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
