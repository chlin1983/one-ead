"""SolidCraft module for One EAD.

Web-based parametric 3D CAD & solid modeling environment.
Upstream repository: https://github.com/tangency-labs/solidcraft
"""

from __future__ import annotations

from fastapi import APIRouter, Body, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse

from modules.solidcraft import solidcraft
from server.module import PortalModule

ICON = (
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    '<path d="M12 2L2 7l10 5 10-5-10-5z"/>'
    '<path d="M2 17l10 5 10-5"/>'
    '<path d="M2 12l10 5 10-5"/>'
    '</svg>'
)

router = APIRouter()


@router.get("/status")
def tool_status() -> dict:
    return solidcraft.status()


@router.post("/check")
def check_updates() -> dict:
    solidcraft.check_latest(force=True)
    return solidcraft.status()


@router.post("/install")
def install(payload: dict = Body(default={})) -> dict:
    return solidcraft.start_install(force=bool(payload.get("force")))


@router.post("/config")
def configure(payload: dict = Body(...)) -> dict:
    solidcraft.set_config(payload)
    return solidcraft.status()


# ---------------------------------------------------------------- disk persistence store

@router.get("/store/index")
def store_index() -> dict:
    return solidcraft.store_index()


@router.get("/store/file/{filename:path}")
def store_get(filename: str) -> Response:
    try:
        data = solidcraft.store_get_file(filename)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if data is None:
        raise HTTPException(404, "Project not found")
    return Response(content=data, media_type="application/octet-stream")


@router.put("/store/file/{filename:path}")
async def store_put(filename: str, request: Request) -> dict:
    body = await request.body()
    try:
        return solidcraft.store_put_file(filename, body)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.delete("/store/file/{filename:path}")
def store_delete(filename: str) -> dict:
    try:
        return solidcraft.store_delete_file(filename)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.get("/store/download/{filename:path}")
def store_download(filename: str) -> Response:
    try:
        data = solidcraft.store_get_file(filename)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if data is None:
        raise HTTPException(404, "Project not found")
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return Response(content=data, media_type="application/octet-stream", headers=headers)


@router.post("/store/upload")
async def store_upload(file: UploadFile = File(...)) -> dict:
    content = await file.read()
    try:
        return solidcraft.store_put_file(file.filename, content)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.get("/store/prefs")
def store_get_prefs() -> dict:
    return solidcraft.store_get_prefs()


@router.put("/store/prefs")
def store_put_prefs(payload: dict = Body(...)) -> dict:
    return solidcraft.store_put_prefs(payload)


MODULE = PortalModule(
    id="solidcraft",
    title="SolidCraft",
    subtitle="Parametric 3D CAD & solid modeling",
    icon=ICON,
    accent="#ea580c",
    order=94,
    badge=None,
    web_dir="web",
    router=router,
)
