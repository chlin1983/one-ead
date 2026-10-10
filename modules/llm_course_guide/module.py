"""LLM Course & Fundamentals Guide — Portal Module.

Provides an intuitive, beginner-friendly step-by-step roadmap and interactive visualizers
based on Maxime Labonne's acclaimed llm-course GitHub repository.
Includes local persistence for learning progress, quiz scores, personal notes, and bookmarks.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, Body
from server.module import PortalModule

DATA_DIR = Path(__file__).resolve().parent / "data"
PROGRESS_FILE = DATA_DIR / "progress.json"

router = APIRouter()


def _get_default_state() -> Dict[str, Any]:
    return {
        "completed_lessons": [],
        "current_lesson_id": "math-linear-algebra",
        "quiz_scores": {},
        "notes": {},
        "bookmarks": [],
        "last_updated": None,
    }


@router.get("/progress")
def get_progress() -> Dict[str, Any]:
    """Retrieve persisted learning progress from local disk."""
    if not PROGRESS_FILE.exists():
        return _get_default_state()
    try:
        with open(PROGRESS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            default = _get_default_state()
            default.update(data)
            return default
    except Exception as exc:
        print(f"[llm-course] Error reading {PROGRESS_FILE}: {exc}")
        return _get_default_state()


@router.post("/progress")
async def save_progress(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Atomically save learning progress to local disk."""
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        temp_file = PROGRESS_FILE.with_suffix(".tmp")
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        temp_file.replace(PROGRESS_FILE)
        return {"status": "ok"}
    except Exception as exc:
        print(f"[llm-course] Error saving progress: {exc}")
        return {"status": "error", "message": str(exc)}


@router.post("/reset")
def reset_progress() -> Dict[str, Any]:
    """Reset learning progress back to clean state."""
    state = _get_default_state()
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2, ensure_ascii=False)
        return {"status": "reset", "progress": state}
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


# Neural network node / Brain spark icon
ICON = (
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    '<circle cx="6" cy="6" r="2.5"/>'
    '<circle cx="6" cy="18" r="2.5"/>'
    '<circle cx="18" cy="6" r="2.5"/>'
    '<circle cx="18" cy="18" r="2.5"/>'
    '<circle cx="12" cy="12" r="2.5"/>'
    '<line x1="8.2" y1="7.2" x2="9.8" y2="10.8"/>'
    '<line x1="8.2" y1="16.8" x2="9.8" y2="13.2"/>'
    '<line x1="15.8" y1="7.2" x2="14.2" y2="10.8"/>'
    '<line x1="15.8" y1="16.8" x2="14.2" y2="13.2"/>'
    '<path d="M6 8.5v7"/>'
    '<path d="M18 8.5v7"/>'
    '</svg>'
)

MODULE = PortalModule(
    id="llm-course",
    title="LLM Fundamentals & Course",
    subtitle="Step-by-step master roadmap & interactive learning guide",
    icon=ICON,
    accent="#8b5cf6",
    order=15,
    router=router,
)
