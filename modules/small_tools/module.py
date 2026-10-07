"""Small Tools — a card launcher for small, standalone utilities.

Each tool is a card on the landing page. Tools are managed through
``/api/small-tools/tools/<tool-id>/...``.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Body, HTTPException

from modules.small_tools import excalidraw, pdfarranger
from server.module import PortalModule

ICON = (
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94'
    'l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'
    '</svg>'
)

TOOLS = [
    {
        "id": pdfarranger.TOOL_ID,
        "title": "PDF Arranger",
        "description": "Merge and split PDFs, and rotate, crop, delete and reorder pages. Runs fully offline, right here.",
        "tag": "PDF",
        "color": "#e0562b",
    },
    {
        "id": excalidraw.TOOL_ID,
        "title": "Excalidraw",
        "description": "Virtual whiteboard for sketching hand-drawn diagrams, wireframes, and architecture charts. Runs fully offline with auto-save.",
        "tag": "Whiteboard",
        "color": "#e0562b",
        "embedded": True,
    },
]

_MANAGERS = {
    pdfarranger.TOOL_ID: pdfarranger,
    excalidraw.TOOL_ID: excalidraw,
}

router = APIRouter()


def _manager(tool_id: str):
    manager = _MANAGERS.get(tool_id)
    if manager is None:
        raise HTTPException(status_code=404, detail="Unknown tool")
    return manager


@router.get("/tools")
def list_tools() -> list:
    return [{**t, "status": _MANAGERS[t["id"]].status()} for t in TOOLS]


@router.get("/tools/{tool_id}/status")
def tool_status(tool_id: str) -> dict:
    return _manager(tool_id).status()


@router.post("/tools/{tool_id}/install")
def tool_install(tool_id: str) -> dict:
    return _manager(tool_id).start_install()


@router.post("/tools/{tool_id}/launch")
def tool_launch(tool_id: str) -> dict:
    return _manager(tool_id).launch()


@router.get("/tools/excalidraw/files")
def list_excalidraw_files() -> dict:
    return excalidraw.list_files()


@router.post("/tools/excalidraw/files")
def create_excalidraw_file(payload: dict = Body(default={})) -> dict:
    return excalidraw.create_file(payload.get("name"))


@router.patch("/tools/excalidraw/files/{file_id}")
def rename_excalidraw_file(file_id: str, payload: dict = Body(...)) -> dict:
    name = payload.get("name", "")
    return excalidraw.rename_file(file_id, name)


@router.post("/tools/excalidraw/files/{file_id}/duplicate")
def duplicate_excalidraw_file(file_id: str) -> dict:
    return excalidraw.duplicate_file(file_id)


@router.delete("/tools/excalidraw/files/{file_id}")
def delete_excalidraw_file(file_id: str) -> dict:
    return excalidraw.delete_file(file_id)


@router.post("/tools/excalidraw/files/{file_id}/active")
def set_active_excalidraw_file(file_id: str) -> dict:
    return excalidraw.set_active_file(file_id)


@router.get("/tools/excalidraw/scene")
def get_excalidraw_scene(file: Optional[str] = None) -> dict:
    return excalidraw.get_scene(file)


@router.post("/tools/excalidraw/scene")
def save_excalidraw_scene(payload: dict = Body(...), file: Optional[str] = None) -> dict:
    return excalidraw.save_scene(payload, file)


MODULE = PortalModule(
    id="small-tools",
    title="Small Tools",
    subtitle="Handy utilities, one click away",
    icon=ICON,
    accent="#e0562b",
    order=90,
    router=router,
)
