"""PDF Arranger — Standalone offline PDF layout & page manipulator.

Merge and split PDFs, and rotate, crop, delete and reorder pages. Runs fully offline.
"""

from __future__ import annotations

from fastapi import APIRouter

from modules.pdfarranger import pdfarranger
from server.module import PortalModule

ICON = (
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    '<rect x="3" y="3" width="7" height="9" rx="1"/>'
    '<rect x="14" y="3" width="7" height="9" rx="1"/>'
    '<rect x="3" y="15" width="7" height="6" rx="1"/>'
    '<path d="M14 18h7M18 15l3 3-3 3"/>'
    '</svg>'
)

router = APIRouter()


@router.get("/status")
def tool_status() -> dict:
    return pdfarranger.status()


@router.post("/install")
def tool_install() -> dict:
    return pdfarranger.start_install()


@router.post("/launch")
def tool_launch() -> dict:
    return pdfarranger.launch()


@router.post("/restart")
def tool_restart() -> dict:
    return pdfarranger.restart()


@router.post("/stop")
def tool_stop() -> dict:
    return pdfarranger.stop()


MODULE = PortalModule(
    id="pdfarranger",
    title="PDF Arranger",
    subtitle="Merge, split, rotate, and reorder PDFs",
    icon=ICON,
    accent="#e0562b",
    order=88,
    web_dir="web",
    router=router,
)
