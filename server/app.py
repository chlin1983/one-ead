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

from fastapi import Body, FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from server.registry import discover_modules, save_saved_order

mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("text/javascript", ".js")

SHELL_DIR = Path(__file__).resolve().parent.parent / "shell"
SHARED_DIR = Path(__file__).resolve().parent.parent / "shared"


def create_app() -> FastAPI:
    app = FastAPI(title="One EAD", version="0.1.0")
    modules = discover_modules()

    # Serve everything with strict no-cache and no-store so the browser never
    # runs a stale plugin build or cached JS/HTML after files change.
    @app.middleware("http")
    async def _no_cache(request, call_next):
        response = await call_next(request)
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
