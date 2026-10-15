"""Excalidraw whiteboard manager for One EAD.

Excalidraw (MIT license, upstream https://github.com/excalidraw/excalidraw)
is a virtual whiteboard for sketching hand-drawn like diagrams, architecture
maps, wireframes, and flowcharts.

Runs fully offline in the browser within One EAD, with disk-backed multi-file persistence.
"""

from __future__ import annotations

import json
import os
import shutil
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

TOOL_ID = "excalidraw"
_HERE = Path(__file__).resolve().parent
WEB_DIR = _HERE / "web" / "canvas"
DATA_DIR = _HERE / "data"
DRAWINGS_DIR = DATA_DIR / "drawings"
TRASH_DIR = DATA_DIR / "trash"
MANIFEST_FILE = DRAWINGS_DIR / "manifest.json"
LEGACY_SCENE_FILE = DATA_DIR / "excalidraw_scene.json"
ENTRY_URL = "/modules/excalidraw/"

# Thread lock to guarantee atomic disk & manifest operations on Windows
_IO_LOCK = threading.RLock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_installed() -> bool:
    return (WEB_DIR / "index.html").exists()


def _save_manifest_locked(manifest: dict) -> None:
    """Save the manifest atomically with unique temp file and Windows retries."""
    DRAWINGS_DIR.mkdir(parents=True, exist_ok=True)
    temp_file = DRAWINGS_DIR / f"manifest_{uuid.uuid4().hex[:8]}.tmp"
    try:
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)
        # On Windows, replace may temporarily hit sharing locks from antivirus / background readers
        for attempt in range(6):
            try:
                temp_file.replace(MANIFEST_FILE)
                break
            except OSError:
                if attempt == 5:
                    shutil.copyfile(temp_file, MANIFEST_FILE)
                    break
                time.sleep(0.04)
    finally:
        if temp_file.exists():
            try:
                temp_file.unlink(missing_ok=True)
            except Exception:
                pass


def _reconcile_manifest_locked(manifest: dict) -> dict:
    """Reconcile manifest against actual files on disk.
    
    Guarantees that NO drawings on disk can ever be lost or disappear,
    even if the manifest was partially written or corrupted!
    """
    raw_files = manifest.get("files")
    if not isinstance(raw_files, list):
        raw_files = []

    # Map existing manifest items by id (deduplicating)
    files_by_id = {}
    for item in raw_files:
        if isinstance(item, dict) and "id" in item:
            files_by_id[item["id"]] = item

    # Scan DRAWINGS_DIR for all actual .json files on disk
    if DRAWINGS_DIR.exists():
        for p in DRAWINGS_DIR.glob("*.json"):
            if p.name.startswith("manifest") or p.suffix == ".tmp":
                continue
            fid = p.stem
            if fid not in files_by_id:
                # Discovered an orphaned file on disk — restore it safely!
                elements_count = 0
                updated_at = _now_iso()
                created_at = updated_at
                try:
                    with open(p, "r", encoding="utf-8") as fp:
                        d = json.load(fp)
                        if isinstance(d, dict):
                            elements_count = len(d.get("elements", []))
                    mtime = p.stat().st_mtime
                    updated_at = datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()
                    created_at = updated_at
                except Exception:
                    pass

                files_by_id[fid] = {
                    "id": fid,
                    "name": "Default Board" if fid == "default" else f"Drawing ({fid[:8]})",
                    "created_at": created_at,
                    "updated_at": updated_at,
                    "elements_count": elements_count,
                }

    # Verify that files in manifest still exist on disk (unless trash)
    clean_files = []
    for fid, item in files_by_id.items():
        if (DRAWINGS_DIR / f"{fid}.json").exists():
            clean_files.append(item)

    # Sort files by updated_at descending
    clean_files.sort(key=lambda x: x.get("updated_at", ""), reverse=True)

    manifest["files"] = clean_files
    if not manifest.get("active_id") or not any(f.get("id") == manifest.get("active_id") for f in clean_files):
        manifest["active_id"] = clean_files[0]["id"] if clean_files else "default"

    return manifest


def _get_manifest_locked() -> dict:
    """Read the drawings manifest from disk, auto-repairing if missing or corrupted."""
    DRAWINGS_DIR.mkdir(parents=True, exist_ok=True)
    if MANIFEST_FILE.exists():
        try:
            with open(MANIFEST_FILE, "r", encoding="utf-8") as f:
                content = f.read().strip()
                if content:
                    data = json.loads(content)
                    if isinstance(data, dict):
                        return _reconcile_manifest_locked(data)
        except Exception as exc:
            print(f"[excalidraw] Warning: manifest read error, repairing: {exc}")

    # Initial default structure if none exists
    initial_manifest = {
        "version": 1,
        "active_id": "default",
        "files": [
            {
                "id": "default",
                "name": "Whiteboard 1",
                "created_at": _now_iso(),
                "updated_at": _now_iso(),
                "elements_count": 0,
            }
        ],
    }
    initial_manifest = _reconcile_manifest_locked(initial_manifest)
    _save_manifest_locked(initial_manifest)
    return initial_manifest


def _ensure_initialized() -> dict:
    """Ensure data directories and initial drawing file exist."""
    with _IO_LOCK:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        DRAWINGS_DIR.mkdir(parents=True, exist_ok=True)
        TRASH_DIR.mkdir(parents=True, exist_ok=True)

        # Migrate legacy single scene file if default drawing doesn't exist yet
        default_file = DRAWINGS_DIR / "default.json"
        if not default_file.exists():
            if LEGACY_SCENE_FILE.exists():
                try:
                    shutil.copyfile(LEGACY_SCENE_FILE, default_file)
                except Exception:
                    pass
            else:
                # Create empty default scene with clean white background
                empty_scene = {
                    "version": 2,
                    "source": "one-ead-excalidraw",
                    "id": "default",
                    "elements": [],
                    "appState": {"theme": "light", "viewBackgroundColor": "#ffffff"},
                    "files": {},
                }
                with open(default_file, "w", encoding="utf-8") as f:
                    json.dump(empty_scene, f)

        manifest = _get_manifest_locked()
        return manifest


def status() -> dict:
    return {
        "installed": is_installed(),
        "ready": True,
        "running": True,
        "entry_url": ENTRY_URL,
        "url": ENTRY_URL,
    }


def launch() -> dict:
    _ensure_initialized()
    return status()


def start_install() -> dict:
    return status()


def list_files() -> dict:
    """Return all drawing files and the active board id."""
    with _IO_LOCK:
        manifest = _ensure_initialized()
        files = manifest.get("files", [])
        return {
            "active_id": manifest.get("active_id", "default"),
            "files": files,
        }


def create_file(name: Optional[str] = None) -> dict:
    """Create a new blank whiteboard drawing file."""
    with _IO_LOCK:
        manifest = _ensure_initialized()
        unique_suffix = uuid.uuid4().hex[:6]
        file_id = f"board_{int(time.time())}_{unique_suffix}"
        display_name = (name or "").strip() or f"Whiteboard {len(manifest.get('files', [])) + 1}"

        now = _now_iso()
        new_entry = {
            "id": file_id,
            "name": display_name,
            "created_at": now,
            "updated_at": now,
            "elements_count": 0,
        }

        # Initialize clean blank scene on disk
        target_path = DRAWINGS_DIR / f"{file_id}.json"
        initial_scene = {
            "version": 2,
            "source": "one-ead-excalidraw",
            "id": file_id,
            "elements": [],
            "appState": {"theme": "light", "viewBackgroundColor": "#ffffff"},
            "files": {},
        }
        with open(target_path, "w", encoding="utf-8") as f:
            json.dump(initial_scene, f)

        # Prepend to list so newest is first
        manifest.setdefault("files", []).insert(0, new_entry)
        manifest["active_id"] = file_id
        _save_manifest_locked(manifest)

        return new_entry


def rename_file(file_id: str, new_name: str) -> dict:
    """Rename a drawing whiteboard."""
    clean_name = new_name.strip()
    if not clean_name:
        raise ValueError("Drawing name cannot be empty")

    with _IO_LOCK:
        manifest = _ensure_initialized()
        target = None
        for f in manifest.get("files", []):
            if f.get("id") == file_id:
                f["name"] = clean_name
                f["updated_at"] = _now_iso()
                target = f
                break

        if not target:
            raise FileNotFoundError(f"Drawing {file_id} not found")

        _save_manifest_locked(manifest)
        return target


def duplicate_file(file_id: str) -> dict:
    """Duplicate an existing drawing file into a new independent whiteboard."""
    with _IO_LOCK:
        manifest = _ensure_initialized()
        source_meta = next((f for f in manifest.get("files", []) if f.get("id") == file_id), None)
        if not source_meta:
            raise FileNotFoundError(f"Source drawing {file_id} not found")

        source_file = DRAWINGS_DIR / f"{file_id}.json"
        if not source_file.exists():
            raise FileNotFoundError(f"Source file {file_id}.json not found on disk")

        unique_suffix = uuid.uuid4().hex[:6]
        new_id = f"board_{int(time.time())}_{unique_suffix}"
        new_name = f"{source_meta.get('name', 'Whiteboard')} (Copy)"
        now = _now_iso()

        # Copy scene data on disk
        new_file = DRAWINGS_DIR / f"{new_id}.json"
        try:
            with open(source_file, "r", encoding="utf-8") as sf:
                data = json.load(sf)
            data["id"] = new_id
            with open(new_file, "w", encoding="utf-8") as df:
                json.dump(data, df)
        except Exception as exc:
            raise IOError(f"Could not duplicate file: {exc}")

        new_entry = {
            "id": new_id,
            "name": new_name,
            "created_at": now,
            "updated_at": now,
            "elements_count": source_meta.get("elements_count", 0),
        }

        # Insert after source
        idx = manifest["files"].index(source_meta)
        manifest["files"].insert(idx + 1, new_entry)
        manifest["active_id"] = new_id
        _save_manifest_locked(manifest)

        return new_entry


def delete_file(file_id: str) -> dict:
    """Delete a drawing whiteboard with trash backup."""
    with _IO_LOCK:
        manifest = _ensure_initialized()
        all_files = manifest.get("files", [])
        if len(all_files) <= 1:
            # If it's the last remaining drawing, don't remove, reset to clean blank state
            target_file = DRAWINGS_DIR / f"{file_id}.json"
            if target_file.exists():
                try:
                    # Move old scene to trash as backup
                    TRASH_DIR.mkdir(parents=True, exist_ok=True)
                    trash_path = TRASH_DIR / f"{file_id}_{int(time.time())}.json"
                    shutil.copyfile(target_file, trash_path)
                except Exception:
                    pass
            empty_scene = {
                "version": 2,
                "source": "one-ead-excalidraw",
                "id": file_id,
                "elements": [],
                "appState": {"theme": "light", "viewBackgroundColor": "#ffffff"},
                "files": {},
            }
            with open(target_file, "w", encoding="utf-8") as f:
                json.dump(empty_scene, f)
            for item in all_files:
                if item.get("id") == file_id:
                    item["elements_count"] = 0
                    item["updated_at"] = _now_iso()
            _save_manifest_locked(manifest)
            return {"status": "cleared", "active_id": file_id}

        target_file = DRAWINGS_DIR / f"{file_id}.json"
        if target_file.exists():
            try:
                TRASH_DIR.mkdir(parents=True, exist_ok=True)
                trash_path = TRASH_DIR / f"{file_id}_{int(time.time())}.json"
                shutil.move(target_file, trash_path)
            except Exception as exc:
                print(f"[excalidraw] Trash move error: {exc}")

        remaining_files = [f for f in all_files if f.get("id") != file_id]
        if manifest.get("active_id") == file_id:
            default_candidate = next((f for f in remaining_files if f.get("id") == "default"), None)
            manifest["active_id"] = default_candidate["id"] if default_candidate else remaining_files[0]["id"]

        manifest["files"] = remaining_files
        _save_manifest_locked(manifest)
        return {"status": "deleted", "active_id": manifest["active_id"]}


def set_active_file(file_id: str) -> dict:
    """Set the currently active drawing file safely."""
    with _IO_LOCK:
        manifest = _ensure_initialized()
        exists = any(f.get("id") == file_id for f in manifest.get("files", []))
        if not exists:
            if (DRAWINGS_DIR / f"{file_id}.json").exists():
                manifest = _reconcile_manifest_locked(manifest)
            else:
                raise FileNotFoundError(f"Drawing {file_id} not found")
        manifest["active_id"] = file_id
        _save_manifest_locked(manifest)
        return {"status": "ok", "active_id": file_id}


def get_scene(file_id: Optional[str] = None) -> dict:
    """Retrieve the saved whiteboard scene from disk for the given or active file."""
    with _IO_LOCK:
        manifest = _ensure_initialized()
        target_id = file_id or manifest.get("active_id", "default")
        target_file = DRAWINGS_DIR / f"{target_id}.json"

        # Fallback to legacy file if target does not exist
        if not target_file.exists():
            if target_id == "default" and LEGACY_SCENE_FILE.exists():
                target_file = LEGACY_SCENE_FILE
            else:
                return {
                    "id": target_id,
                    "elements": [],
                    "appState": {"theme": "light", "viewBackgroundColor": "#ffffff"},
                    "files": {},
                }

        try:
            with open(target_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                if not isinstance(data, dict):
                    data = {}
                app_state = data.get("appState")
                if isinstance(app_state, dict):
                    app_state.setdefault("theme", "light")
                    bg = app_state.get("viewBackgroundColor")
                    if not bg or bg in ("#f5faff", "#f8f9fa", "#fffce8", "#fdf8f6"):
                        app_state["viewBackgroundColor"] = "#ffffff"
                else:
                    data["appState"] = {"theme": "light", "viewBackgroundColor": "#ffffff"}
                data["id"] = target_id
                return data
        except Exception as exc:
            return {
                "id": target_id,
                "elements": [],
                "appState": {"theme": "light", "viewBackgroundColor": "#ffffff"},
                "files": {},
                "error": str(exc),
            }


def save_scene(payload: dict, file_id: Optional[str] = None) -> dict:
    """Save the whiteboard scene atomically to disk for the given or active file."""
    with _IO_LOCK:
        manifest = _ensure_initialized()
        target_id = file_id or manifest.get("active_id", "default")
        DRAWINGS_DIR.mkdir(parents=True, exist_ok=True)
        target_file = DRAWINGS_DIR / f"{target_id}.json"

        elements = payload.get("elements", [])
        app_state = payload.get("appState", {})
        files = payload.get("files", {})

        if isinstance(app_state, dict):
            app_state.setdefault("theme", "light")
            bg = app_state.get("viewBackgroundColor")
            if not bg or bg in ("#f5faff", "#f8f9fa", "#fffce8", "#fdf8f6"):
                app_state["viewBackgroundColor"] = "#ffffff"

        data = {
            "version": 2,
            "source": "one-ead-excalidraw",
            "id": target_id,
            "elements": elements,
            "appState": app_state,
            "files": files,
        }

        temp_file = DRAWINGS_DIR / f"{target_id}_{uuid.uuid4().hex[:8]}.tmp"
        try:
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(data, f)
            for attempt in range(4):
                try:
                    temp_file.replace(target_file)
                    break
                except OSError:
                    if attempt == 3:
                        shutil.copyfile(temp_file, target_file)
                        break
                    time.sleep(0.02)
        finally:
            if temp_file.exists():
                try:
                    temp_file.unlink(missing_ok=True)
                except Exception:
                    pass

        # Also keep legacy file in sync if saving default
        if target_id == "default":
            try:
                with open(LEGACY_SCENE_FILE, "w", encoding="utf-8") as lf:
                    json.dump(data, lf)
            except Exception:
                pass

        # Update manifest metadata
        manifest_changed = False
        for item in manifest.get("files", []):
            if item.get("id") == target_id:
                if item.get("elements_count") != len(elements):
                    item["elements_count"] = len(elements)
                    manifest_changed = True
                item["updated_at"] = _now_iso()
                manifest_changed = True
                break
        else:
            manifest.setdefault("files", []).append({
                "id": target_id,
                "name": payload.get("name", "Whiteboard"),
                "created_at": _now_iso(),
                "updated_at": _now_iso(),
                "elements_count": len(elements),
            })
            manifest_changed = True

        if manifest.get("active_id") != target_id:
            manifest["active_id"] = target_id
            manifest_changed = True

        if manifest_changed:
            _save_manifest_locked(manifest)

        return {"status": "ok", "id": target_id, "count": len(elements)}
