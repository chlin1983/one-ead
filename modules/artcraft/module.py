"""ArtCraft Suite plugin for One EAD.

Unified hub for all 12 ArtCraft desktop-grade creative WebAssembly applications:
PhotoCraft, VectorCraft, FilmCraft, LightCraft, EffectCraft, DesignCraft,
FigCraft, WordCraft, SoundCraft, DeckCraft, CADCraft, GridCraft.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Body, HTTPException

from modules.artcraft import artcraft
from server.module import PortalModule

ICON = (
    '<svg viewBox="0 0 116.34 97.5" width="18" height="18" fill="currentColor">'
    '<path d="M104.28,49.49L81.55,0h-31.23l-3.17,4.76L14.75,53.63,0,75.85l21.55,21.55,63.79-36.94,16.99,37.04,14.01-21.74-12.06-26.27ZM32.89,65.66l32.42-48.87,10.91,23.77-43.32,25.09Z"/>'
    '</svg>'
)

router = APIRouter()


@router.get("/status")
def get_status() -> dict:
    return artcraft.status()


@router.get("/apps")
def get_apps() -> dict:
    return {"apps": artcraft.list_apps()}


@router.get("/app/{app_id}")
def get_app(app_id: str) -> dict:
    info = artcraft.get_app_info(app_id)
    if not info:
        raise HTTPException(status_code=404, detail=f"App '{app_id}' not found")
    return info


@router.post("/install/{app_id}")
def install_single_app(app_id: str, payload: dict = Body(default={})) -> dict:
    force = bool(payload.get("force", False))
    try:
        return artcraft.install_app(app_id, force=force)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/install-all")
def install_all_apps(payload: dict = Body(default={})) -> dict:
    force = bool(payload.get("force", False))
    return artcraft.install_all(force=force)


@router.post("/check-updates")
def check_updates_endpoint(payload: dict = Body(default={})) -> dict:
    background = bool(payload.get("background", True))
    artcraft.check_updates(background=background)
    return artcraft.status()


MODULE = PortalModule(
    id="artcraft",
    title="ArtCraft",
    subtitle="Creative Studio Suite",
    icon=ICON,
    accent="#4e7bfb",
    order=86,
    web_dir="web",
    router=router,
)
