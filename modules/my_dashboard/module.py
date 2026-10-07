"""my_dashboard module — Personal productivity, task, calendar & mind map dashboard.

Provides permanent on-disk data persistence (modules/my_dashboard/data/dashboard_data.json)
along with local-first browser cache, plus a clean data clearing mechanism for safe sharing.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, Body
from server.module import PortalModule

DATA_DIR = Path(__file__).resolve().parent / "data"
DATA_FILE = DATA_DIR / "dashboard_data.json"

router = APIRouter()


@router.get("/data")
def get_dashboard_data() -> Dict[str, Any]:
    """Retrieve all persisted dashboard data from the local disk file."""
    if not DATA_FILE.exists():
        return {}
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:
        print(f"[my_dashboard] Error reading {DATA_FILE}: {exc}")
        return {}


@router.post("/data")
async def save_dashboard_data(payload: Dict[str, Any] = Body(...)) -> Dict[str, str]:
    """Atomically save all dashboard data to the local disk file."""
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        temp_file = DATA_FILE.with_suffix(".tmp")
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        temp_file.replace(DATA_FILE)
        return {"status": "ok"}
    except Exception as exc:
        print(f"[my_dashboard] Error saving data: {exc}")
        return {"status": "error", "message": str(exc)}


@router.post("/clear")
def clear_dashboard_data() -> Dict[str, Any]:
    """Clear all personal data and restore default blank state for safe sharing."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    empty_template = {
        "tasks": [],
        "boards": [{"id": "default", "name": "Main Map"}],
        "notebook": [],
        "weekly_planner": {},
        "username": "User",
    }
    try:
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(empty_template, f, indent=2, ensure_ascii=False)
        return {"status": "cleared", "data": empty_template}
    except Exception as exc:
        print(f"[my_dashboard] Error clearing data: {exc}")
        return {"status": "error", "message": str(exc)}


ICON = (
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    '<rect x="3" y="3" width="7" height="9" rx="1"/>'
    '<rect x="14" y="3" width="7" height="5" rx="1"/>'
    '<rect x="14" y="12" width="7" height="9" rx="1"/>'
    '<rect x="3" y="16" width="7" height="5" rx="1"/>'
    '</svg>'
)

MODULE = PortalModule(
    id="my_dashboard",
    title="My Dashboard",
    subtitle="Personnel work & productivity dashboard",
    icon=ICON,
    accent="#c084fc",
    order=50,
    router=router,
)
