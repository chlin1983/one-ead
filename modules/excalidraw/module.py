"""Excalidraw — Standalone virtual whiteboard plugin for One EAD.

Provides a rich hand-drawn style whiteboard for sketches, wireframes, and architecture charts.
Features full offline operation and multi-file local disk persistence.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Body, HTTPException

from modules.excalidraw import excalidraw
from server.module import PortalModule

ICON = (
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    '<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'
    '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>'
    '</svg>'
)

router = APIRouter()


@router.get("/status")
def tool_status() -> dict:
    return excalidraw.status()


@router.get("/files")
def list_files() -> dict:
    return excalidraw.list_files()


@router.post("/files")
def create_file(payload: dict = Body(default={})) -> dict:
    return excalidraw.create_file(payload.get("name"))


@router.patch("/files/{file_id}")
def rename_file(file_id: str, payload: dict = Body(...)) -> dict:
    name = payload.get("name", "")
    return excalidraw.rename_file(file_id, name)


@router.post("/files/{file_id}/duplicate")
def duplicate_file(file_id: str) -> dict:
    return excalidraw.duplicate_file(file_id)


@router.delete("/files/{file_id}")
def delete_file(file_id: str) -> dict:
    return excalidraw.delete_file(file_id)


@router.post("/files/{file_id}/active")
def set_active_file(file_id: str) -> dict:
    return excalidraw.set_active_file(file_id)


@router.get("/scene")
def get_scene(file: Optional[str] = None) -> dict:
    return excalidraw.get_scene(file)


@router.post("/scene")
def save_scene(payload: dict = Body(...), file: Optional[str] = None) -> dict:
    return excalidraw.save_scene(payload, file)


MODULE = PortalModule(
    id="excalidraw",
    title="Excalidraw",
    subtitle="Virtual Whiteboard & Diagrams",
    icon=ICON,
    accent="#6965db",
    order=86,
    web_dir="web",
    router=router,
)
