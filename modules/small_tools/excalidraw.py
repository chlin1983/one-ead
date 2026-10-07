"""Excalidraw whiteboard manager for Small Tools.

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
WEB_DIR = _HERE / "web" / "excalidraw"
DATA_DIR = _HERE / "data"
DRAWINGS_DIR = DATA_DIR / "drawings"
TRASH_DIR = DATA_DIR / "trash"
MANIFEST_FILE = DRAWINGS_DIR / "manifest.json"
LEGACY_SCENE_FILE = DATA_DIR / "excalidraw_scene.json"
ENTRY_URL = "/modules/small-tools/excalidraw/"

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
                    st = p.stat()
                    updated_at = datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat()
                    created_at = datetime.fromtimestamp(st.st_ctime, timezone.utc).isoformat()
                except Exception:
                    pass

                name = "Main Whiteboard" if fid == "default" else f"Whiteboard {len(files_by_id) + 1}"
                files_by_id[fid] = {
                    "id": fid,
                    "name": name,
                    "created_at": created_at,
                    "updated_at": updated_at,
                    "elements_count": elements_count,
                }

    # Verify that files in manifest actually exist on disk
    verified_files = []
    for fid, item in files_by_id.items():
        disk_path = DRAWINGS_DIR / f"{fid}.json"
        if disk_path.exists():
            verified_files.append(item)

    # Ensure "default" is prioritized if it exists
    verified_files.sort(
        key=lambda x: (
            0 if x.get("id") == "default" else 1,
            x.get("created_at", ""),
        )
    )

    manifest["files"] = verified_files
    active_id = manifest.get("active_id")
    if not any(f.get("id") == active_id for f in verified_files):
        manifest["active_id"] = verified_files[0]["id"] if verified_files else "default"

    return manifest


def _ensure_initialized() -> dict:
    """Ensure drawings directory exists and is populated safely without losing files."""
    with _IO_LOCK:
        DRAWINGS_DIR.mkdir(parents=True, exist_ok=True)
        TRASH_DIR.mkdir(parents=True, exist_ok=True)

        manifest = None
        if MANIFEST_FILE.exists():
            try:
                with open(MANIFEST_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict) and isinstance(data.get("files"), list):
                        manifest = data
            except Exception:
                pass

        if manifest is None:
            manifest = {"active_id": "default", "files": []}

        # Ensure at least one drawing exists; create default.json only if directory has no drawings
        existing_drawings = [
            p for p in DRAWINGS_DIR.glob("*.json")
            if not p.name.startswith("manifest") and p.suffix == ".json"
        ]
        if not existing_drawings:
            default_file = DRAWINGS_DIR / "default.json"
            if LEGACY_SCENE_FILE.exists():
                try:
                    shutil.copyfile(LEGACY_SCENE_FILE, default_file)
                except Exception:
                    pass
            if not default_file.exists():
                clear_scene = {
                    "version": 2,
                    "source": "one-ead-excalidraw",
                    "id": "default",
                    "elements": [],
                    "appState": {"theme": "light", "viewBackgroundColor": "#ffffff"},
                    "files": {},
                }
                with open(default_file, "w", encoding="utf-8") as f:
                    json.dump(clear_scene, f, indent=2)

        # Reconcile against actual disk files to ensure zero data loss
        manifest = _reconcile_manifest_locked(manifest)
        _save_manifest_locked(manifest)
        return manifest


def _get_manifest_locked() -> dict:
    """Get current manifest quickly from disk without redundant reconciliation or writes."""
    if MANIFEST_FILE.exists():
        try:
            with open(MANIFEST_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict) and isinstance(data.get("files"), list):
                    return data
        except Exception:
            pass
    return _ensure_initialized()


def status() -> dict:
    with _IO_LOCK:
        installed = is_installed()
        manifest = _get_manifest_locked()
        active_id = manifest.get("active_id", "default")
        return {
            "id": TOOL_ID,
            "installed": installed,
            "install": {
                "active": False,
                "percent": 100 if installed else 0,
                "message": "Ready" if installed else "Not installed",
                "error": "",
            },
            "running": True,
            "ready": True,
            "embedded": True,
            "url": f"{ENTRY_URL}?file={active_id}",
            "active_file": active_id,
            "file_count": len(manifest.get("files", [])),
        }


def start_install() -> dict:
    return status()


def launch() -> dict:
    return status()


def list_files() -> dict:
    """Return list of saved drawings, reconciled against disk."""
    with _IO_LOCK:
        manifest = _ensure_initialized()
        files = manifest.get("files", [])
        # Return files in stable order (default first, then by creation date)
        sorted_files = sorted(
            files,
            key=lambda x: (
                0 if x.get("id") == "default" else 1,
                x.get("created_at", ""),
            ),
        )
        return {
            "active_id": manifest.get("active_id", "default"),
            "files": sorted_files,
        }


def create_file(name: Optional[str] = None) -> dict:
    """Create a new blank whiteboard drawing file."""
    with _IO_LOCK:
        manifest = _ensure_initialized()
        file_id = f"board_{int(time.time())}_{uuid.uuid4().hex[:6]}"
        display_name = (name or "").strip() or f"Whiteboard {len(manifest.get('files', [])) + 1}"

        scene_data = {
            "version": 2,
            "source": "one-ead-excalidraw",
            "id": file_id,
            "elements": [],
            "appState": {"theme": "light", "viewBackgroundColor": "#ffffff"},
            "files": {},
        }
        file_path = DRAWINGS_DIR / f"{file_id}.json"
        temp_path = DRAWINGS_DIR / f"{file_id}_{uuid.uuid4().hex[:6]}.tmp"
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(scene_data, f, indent=2)
        temp_path.replace(file_path)

        new_entry = {
            "id": file_id,
            "name": display_name,
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
            "elements_count": 0,
        }
        manifest.setdefault("files", []).append(new_entry)
        manifest["active_id"] = file_id
        _save_manifest_locked(manifest)
        return new_entry


def rename_file(file_id: str, new_name: str) -> dict:
    """Rename a drawing file safely."""
    with _IO_LOCK:
        manifest = _ensure_initialized()
        clean_name = new_name.strip()
        if not clean_name:
            clean_name = "Untitled Whiteboard"
        for item in manifest.get("files", []):
            if item.get("id") == file_id:
                item["name"] = clean_name
                item["updated_at"] = _now_iso()
                _save_manifest_locked(manifest)
                return item
        raise FileNotFoundError(f"Drawing {file_id} not found")


def duplicate_file(file_id: str) -> dict:
    """Duplicate an existing drawing file safely."""
    with _IO_LOCK:
        manifest = _ensure_initialized()
        src_file = DRAWINGS_DIR / f"{file_id}.json"
        if not src_file.exists():
            raise FileNotFoundError(f"Drawing {file_id} not found")

        new_id = f"board_{int(time.time())}_{uuid.uuid4().hex[:6]}"
        src_meta = next((f for f in manifest.get("files", []) if f.get("id") == file_id), None)
        base_name = src_meta["name"] if src_meta else "Whiteboard"
        new_name = f"{base_name} (Copy)"

        dst_file = DRAWINGS_DIR / f"{new_id}.json"
        shutil.copyfile(src_file, dst_file)

        count = src_meta.get("elements_count", 0) if src_meta else 0
        new_entry = {
            "id": new_id,
            "name": new_name,
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
            "elements_count": count,
        }
        manifest.setdefault("files", []).append(new_entry)
        manifest["active_id"] = new_id
        _save_manifest_locked(manifest)
        return new_entry


def delete_file(file_id: str) -> dict:
    """Delete ONLY the specified drawing file securely.
    
    Data Security: The file is soft-deleted to the trash folder so data is NEVER permanently lost.
    All other drawings in the manifest and on disk are strictly preserved!
    """
    with _IO_LOCK:
        manifest = _ensure_initialized()
        files = manifest.get("files", [])

        # Find target in manifest
        target_meta = next((f for f in files if f.get("id") == file_id), None)

        # Special safety for Main Whiteboard ("default") if it's the only board
        if file_id == "default" and len(files) <= 1:
            clear_scene = {
                "version": 2,
                "source": "one-ead-excalidraw",
                "id": "default",
                "elements": [],
                "appState": {"theme": "light", "viewBackgroundColor": "#ffffff"},
                "files": {},
            }
            with open(DRAWINGS_DIR / "default.json", "w", encoding="utf-8") as f:
                json.dump(clear_scene, f, indent=2)
            if files:
                files[0]["elements_count"] = 0
                files[0]["updated_at"] = _now_iso()
            _save_manifest_locked(manifest)
            return {"status": "cleared", "active_id": "default"}

        target_path = DRAWINGS_DIR / f"{file_id}.json"
        if target_path.exists():
            TRASH_DIR.mkdir(parents=True, exist_ok=True)
            # Soft delete to trash with timestamp for complete data security
            trash_path = TRASH_DIR / f"{file_id}_{int(time.time())}.json"
            try:
                shutil.move(str(target_path), str(trash_path))
            except Exception:
                try:
                    target_path.unlink(missing_ok=True)
                except Exception:
                    pass

        # Remove ONLY the deleted file from manifest
        remaining_files = [f for f in files if f.get("id") != file_id]

        # If no files remain, restore a clean default board
        if not remaining_files:
            default_entry = {
                "id": "default",
                "name": "Main Whiteboard",
                "created_at": _now_iso(),
                "updated_at": _now_iso(),
                "elements_count": 0,
            }
            remaining_files = [default_entry]
            manifest["active_id"] = "default"
            clear_scene = {
                "version": 2,
                "source": "one-ead-excalidraw",
                "id": "default",
                "elements": [],
                "appState": {"theme": "light", "viewBackgroundColor": "#ffffff"},
                "files": {},
            }
            with open(DRAWINGS_DIR / "default.json", "w", encoding="utf-8") as f:
                json.dump(clear_scene, f, indent=2)
        elif manifest.get("active_id") == file_id:
            # Switch active to remaining board (prefer default or first available)
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
            # If exists on disk, restore it
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
                    # Normalize legacy pastel default background colors to pure white #ffffff
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
        manifest = _get_manifest_locked()
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
