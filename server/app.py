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

from fastapi import Body, FastAPI, Form, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from server.registry import discover_modules, save_saved_order
from server.security import (
    AUTH_HEADER_NAME,
    SESSION_COOKIE_NAME,
    TICKET_PARAM_NAME,
    consume_login_ticket,
    get_portal_token,
    install_credential_redacting_logger,
    render_lock_screen_html,
    verify_portal_token,
)

mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("text/javascript", ".js")

SHELL_DIR = Path(__file__).resolve().parent.parent / "shell"
SHARED_DIR = Path(__file__).resolve().parent.parent / "shared"


from server.security import is_same_origin_request  # noqa: E402


def create_app() -> FastAPI:
    # Ensure all server and uvicorn loggers redact auth tokens/tickets
    install_credential_redacting_logger()

    app = FastAPI(title="One EAD", version="0.1.0")
    modules = discover_modules()

    # Dedicated single-use ticket verification endpoint.
    # Exchanging the ticket immediately sets the persistent session cookie and
    # performs a 303 redirect to /, ensuring the URL in browser history and address bar is clean.
    @app.get("/auth/verify")
    async def auth_verify_ticket(request: Request):
        ticket = request.query_params.get(TICKET_PARAM_NAME) or request.query_params.get("ticket")
        if not ticket or not consume_login_ticket(ticket):
            return HTMLResponse(
                render_lock_screen_html(
                    error_message="Invalid or expired login ticket. Please re-launch from start.bat or enter your session token."
                ),
                status_code=401,
                headers={"Referrer-Policy": "no-referrer", "Cache-Control": "no-store"},
            )

        response = RedirectResponse(url="/", status_code=303)
        response.set_cookie(
            key=SESSION_COOKIE_NAME,
            value=get_portal_token(),
            max_age=31536000,  # 1 year session persistence on local machine
            httponly=True,
            samesite="lax",
            path="/",
        )
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        return response

    # Secure POST login endpoint for manual unlock.
    # Accepts token in the request body (never in the URL) and redirects with session cookie.
    @app.post("/auth/login")
    async def auth_post_login(request: Request):
        form = await request.form()
        candidate = form.get("token") or form.get("auth") or ""
        if not isinstance(candidate, str) or not verify_portal_token(candidate):
            return HTMLResponse(
                render_lock_screen_html(error_message="Invalid session authentication token."),
                status_code=401,
                headers={"Referrer-Policy": "no-referrer", "Cache-Control": "no-store"},
            )

        response = RedirectResponse(url="/", status_code=303)
        response.set_cookie(
            key=SESSION_COOKIE_NAME,
            value=get_portal_token(),
            max_age=31536000,
            httponly=True,
            samesite="lax",
            path="/",
        )
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        return response

    # Session authentication barrier: verifies caller possession of the local session token,
    # valid single-use ticket, or SameSite=Lax cookie to prevent cross-site/drive-by localhost attacks.
    @app.middleware("http")
    async def _session_auth_middleware(request: Request, call_next):
        path = request.url.path

        # 0. CSRF defence: reject untrusted cross-origin state-changing requests
        if not is_same_origin_request(request.method, request.headers, request.url.scheme):
            return JSONResponse(
                {"status": "error", "message": "Forbidden: cross-origin request blocked."},
                status_code=403,
                headers={"Referrer-Policy": "no-referrer"},
            )

        # 1. Public endpoints and static assets required before or during authentication
        if (
            path in ("/favicon.ico", "/favicon.svg", "/auth/verify", "/auth/login")
            or path.startswith("/shared/lock/")
        ):
            response = await call_next(request)
            response.headers["Referrer-Policy"] = "no-referrer"
            return response

        # 2. Check for single-use ticket parameter on root /?ticket=<ticket>
        ticket_param = request.query_params.get(TICKET_PARAM_NAME)
        if ticket_param is not None:
            if consume_login_ticket(ticket_param):
                response = RedirectResponse(url="/", status_code=303)
                response.set_cookie(
                    key=SESSION_COOKIE_NAME,
                    value=get_portal_token(),
                    max_age=31536000,
                    httponly=True,
                    samesite="lax",
                    path="/",
                )
                response.headers["Referrer-Policy"] = "no-referrer"
                response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
                return response
            else:
                return HTMLResponse(
                    render_lock_screen_html(error_message="Invalid or expired login ticket."),
                    status_code=401,
                    headers={"Referrer-Policy": "no-referrer", "Cache-Control": "no-store"},
                )

        # 3. Verify session token from cookie or header (query-string auth is NOT accepted)
        cookie_tok = request.cookies.get(SESSION_COOKIE_NAME)
        header_tok = request.headers.get(AUTH_HEADER_NAME)
        is_authenticated = (
            verify_portal_token(cookie_tok)
            or verify_portal_token(header_tok)
        )

        if not is_authenticated:
            if path.startswith("/api/"):
                return JSONResponse(
                    {
                        "status": "error",
                        "message": "Unauthorized: Valid One EAD session authentication required.",
                    },
                    status_code=401,
                    headers={"Referrer-Policy": "no-referrer"},
                )
            # Render lock screen with 200 OK for browser HTML so startup doesn't trigger console 401 warnings
            return HTMLResponse(
                render_lock_screen_html(),
                status_code=200,
                headers={"Referrer-Policy": "no-referrer"},
            )

        response = await call_next(request)

        # Apply strict Referrer-Policy and security headers
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"

        return response

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
