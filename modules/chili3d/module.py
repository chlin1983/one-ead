"""Chili3D — browser-based 3D CAD plugin for One EAD.

Always builds the newest upstream Chili3D from GitHub and keeps every work on
disk so it survives restarts, port changes and cleared browser data.
"""

from __future__ import annotations

from fastapi import APIRouter, Body, HTTPException, Request, Response

from modules.chili3d import chili3d
from server.module import PortalModule

ICON = (
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>'
    '<polyline points="3.27 6.96 12 12.01 20.73 6.96"/>'
    '<line x1="12" y1="22.08" x2="12" y2="12"/>'
    '</svg>'
)

router = APIRouter()


@router.get("/status")
def tool_status() -> dict:
    return chili3d.status()


@router.post("/check")
def check_updates() -> dict:
    chili3d.check_latest(force=True)
    return chili3d.status()


@router.post("/install")
def install(payload: dict = Body(default={})) -> dict:
    return chili3d.start_install(force=bool(payload.get("force")))


@router.post("/config")
def configure(payload: dict = Body(...)) -> dict:
    chili3d.set_config(payload)
    return chili3d.status()


@router.get("/store/index")
def store_index() -> dict:
    return chili3d.store_index()


@router.get("/store/{table}/{item_id:path}")
def store_get(table: str, item_id: str) -> Response:
    try:
        data = chili3d.store_get(table, item_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if data is None:
        raise HTTPException(404, "Not found")
    return Response(content=data, media_type="application/json")


@router.put("/store/{table}/{item_id:path}")
async def store_put(table: str, item_id: str, request: Request) -> dict:
    body = await request.body()
    try:
        return chili3d.store_put(table, item_id, body)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.delete("/store/{table}/{item_id:path}")
def store_delete(table: str, item_id: str) -> dict:
    try:
        return chili3d.store_delete(table, item_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


MODULE = PortalModule(
    id="chili3d",
    title="Chili3D",
    subtitle="3D CAD Modeling (always latest)",
    icon=ICON,
    accent="#e5484d",
    order=87,
    web_dir="web",
    router=router,
)
