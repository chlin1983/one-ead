"""FastAPI application factory for the EAD Portal.

The app does three things:

1. Discovers modules and exposes their manifests at ``GET /api/modules``.
2. Mounts each module's static web folder at ``/modules/<id>/`` and its optional
   API router at ``/api/<id>``.
3. Serves the portal shell (the launcher UI) at ``/``.

Everything is served locally; no external network access is required at runtime.
"""

from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import Body, FastAPI, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from server.registry import discover_modules, save_saved_order
from server.security import (
    AUTH_HEADER_NAME,
    AUTH_PARAM_NAME,
    SESSION_COOKIE_NAME,
    render_lock_screen_html,
    verify_portal_token,
)

mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("text/javascript", ".js")

SHELL_DIR = Path(__file__).resolve().parent.parent / "shell"
SHARED_DIR = Path(__file__).resolve().parent.parent / "shared"


def create_app() -> FastAPI:
    app = FastAPI(title="One EAD", version="0.1.0")
    modules = discover_modules()

    # Session authentication barrier: verifies caller possession of the local session token
    # or SameSite=Strict cookie to prevent cross-site/drive-by localhost attacks.
    @app.middleware("http")
    async def _session_auth_middleware(request: Request, call_next):
        # 1. First-time authentication via query parameter (?auth=<token>)
        auth_param = request.query_params.get(AUTH_PARAM_NAME)
        if auth_param is not None:
            if verify_portal_token(auth_param):
                remaining_params = [
                    f"{k}={v}" for k, v in request.query_params.items() if k != AUTH_PARAM_NAME
                ]
                clean_path = request.url.path
                if remaining_params:
                    clean_path += "?" + "&".join(remaining_params)
                redirect_res = RedirectResponse(url=clean_path, status_code=303)
                redirect_res.set_cookie(
                    key=SESSION_COOKIE_NAME,
                    value=auth_param.strip(),
                    max_age=31536000,  # 1 year session persistence on local machine
                    httponly=True,
                    samesite="strict",
                    path="/",
                )
                return redirect_res
            else:
                return HTMLResponse(
                    render_lock_screen_html(error_message="Invalid session authentication token."),
                    status_code=401,
                )

        path = request.url.path

        # 2. Public browser assets required before or during authentication
        if path in ("/favicon.ico", "/favicon.svg") or path.startswith("/shared/lock/"):
            return await call_next(request)

        # 3. Verify session token from cookie, header, or query param
        cookie_tok = request.cookies.get(SESSION_COOKIE_NAME)
        header_tok = request.headers.get(AUTH_HEADER_NAME)
        is_authenticated = verify_portal_token(cookie_tok) or verify_portal_token(header_tok)

        if not is_authenticated:
            if path.startswith("/api/"):
                return JSONResponse(
                    {
                        "status": "error",
                        "message": "Unauthorized: Valid One EAD session authentication required.",
                    },
                    status_code=401,
                )
            return HTMLResponse(render_lock_screen_html(), status_code=401)

        return await call_next(request)

    # Serve HTML/JS/API with strict no-cache, but allow client-side caching of thumbnails
    # and static media assets so re-rendering cards never re-downloads images.
    @app.middleware("http")
    async def _no_cache(request, call_next):
        response = await call_next(request)
        path = request.url.path
        if "/thumbnail" in path or path.endswith((".png", ".jpg", ".jpeg", ".svg", ".ico", ".woff2")):
            response.headers["Cache-Control"] = "public, max-age=86400, immutable"
        else:
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response

    @app.get("/api/modules")
    def list_modules() -> JSONResponse:
        return JSONResponse([m.manifest() for m in modules])

    @app.post("/api/modules/order")
    async def set_module_order(payload: dict = Body(...)) -> JSONResponse:
        order = payload.get("order", [])
        if not isinstance(order, list):
            return JSONResponse({"status": "error", "message": "Expected list of module IDs"}, status_code=400)
        success = save_saved_order(order)
        if success:
            order_map = {mod_id: idx for idx, mod_id in enumerate(order)}
            modules.sort(
                key=lambda m: (
                    0 if m.id in order_map else 1,
                    order_map.get(m.id, m.order),
                    m.title,
                )
            )
            return JSONResponse({"status": "ok", "order": order})
        return JSONResponse({"status": "error", "message": "Failed to save order to disk"}, status_code=500)

    # Mount each module's backend router and static web assets.
    for module in modules:
        if module.router is not None:
            app.include_router(module.router, prefix=f"/api/{module.id}")
            if module.id == "f1-ipp-filter-simulator":
                app.include_router(module.router, prefix="/api/f1-filter-simulator")
        web_path = module.web_path
        if web_path is not None:
            app.mount(
                f"/modules/{module.id}",
                StaticFiles(directory=str(web_path), html=True),
                name=f"module-{module.id}",
            )
            if module.id == "f1-ipp-filter-simulator":
                app.mount(
                    "/modules/f1-filter-simulator",
                    StaticFiles(directory=str(web_path), html=True),
                    name="module-f1-filter-simulator-alias",
                )
            elif module.id == "balance-armature-receiver-explorer":
                app.mount(
                    "/modules/balance-armature",
                    StaticFiles(directory=str(web_path), html=True),
                    name="module-balance-armature-alias",
                )
            elif module.id == "mems-microphone-explorer":
                app.mount(
                    "/modules/mems-mic-explorer",
                    StaticFiles(directory=str(web_path), html=True),
                    name="module-mems-mic-explorer-alias",
                )


    # Shared assets (vendored libraries, common styles) available to all modules.
    app.mount("/shared", StaticFiles(directory=str(SHARED_DIR)), name="shared")

    # The shell is mounted last so it acts as the catch-all root.
    app.mount("/", StaticFiles(directory=str(SHELL_DIR), html=True), name="shell")
    return app


app = create_app()
