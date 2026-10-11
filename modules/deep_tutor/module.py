"""DeepTutor — AI tutoring workspace plugin for One EAD.

Tracks the newest upstream DeepTutor release (HKUDS/DeepTutor, Apache-2.0) in a
private environment and embeds its web app. See README.md for provenance.
"""

from __future__ import annotations

from fastapi import APIRouter, Body, HTTPException

from modules.deep_tutor import deep_tutor
from server.module import PortalModule

ICON = (
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    '<path d="M22 10L12 5 2 10l10 5 10-5z"/>'
    '<path d="M6 12v5c3 3 9 3 12 0v-5"/>'
    '<line x1="22" y1="10" x2="22" y2="16"/>'
    '</svg>'
)

router = APIRouter()


@router.get("/status")
def tool_status() -> dict:
    return deep_tutor.status()


@router.post("/check")
def check_updates() -> dict:
    deep_tutor.check_latest(force=True)
    return deep_tutor.status()


@router.post("/install")
def install(payload: dict = Body(default={})) -> dict:
    return deep_tutor.start_install(force=bool(payload.get("force")))


@router.post("/config")
def configure(payload: dict = Body(...)) -> dict:
    deep_tutor.set_config(payload)
    return deep_tutor.status()


@router.post("/start")
def start() -> dict:
    try:
        return deep_tutor.start_service()
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))


@router.post("/stop")
def stop() -> dict:
    return deep_tutor.stop_service()


@router.post("/restart")
def restart() -> dict:
    try:
        return deep_tutor.restart_service()
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))


@router.get("/local-ai")
def local_ai() -> dict:
    return deep_tutor.local_ai_info()


@router.post("/local-ai/setup")
def local_ai_setup(payload: dict = Body(...)) -> dict:
    try:
        return deep_tutor.start_local_ai_setup(payload)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


MODULE = PortalModule(
    id="deep-tutor",
    title="DeepTutor",
    subtitle="AI tutoring workspace (always latest)",
    icon=ICON,
    accent="#6d5bd0",
    order=88,
    web_dir="web",
    router=router,
)
