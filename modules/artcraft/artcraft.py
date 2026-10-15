"""ArtCraft Suite manager for One EAD.

ArtCraft (https://getartcraft.com/apps, https://github.com/storytold)
is an open-source creative suite built from scratch in pure Rust and compiled
to WebAssembly with hardware acceleration.

This module manages all 12 ArtCraft desktop-grade web applications:
- PhotoCraft: Image & photo editor (Photoshop-style)
- VectorCraft: Vector graphics & illustration (Illustrator-style)
- FilmCraft: Nonlinear video editor (Premiere-style)
- LightCraft: Digital photo darkroom & RAW developer (Lightroom-style)
- EffectCraft: Motion graphics & visual effects compositor (After Effects-style)
- DesignCraft: Page layout & editorial publishing (InDesign-style)
- FigCraft: Interface design & UI prototyping (Figma-style)
- WordCraft: Distraction-free word processor (Word-style)
- SoundCraft: Multi-track digital audio workstation (Pro Tools-style)
- DeckCraft: Slide presentation designer (PowerPoint-style)
- CADCraft: 2D/3D precision drafting (AutoCAD-style)
- GridCraft: Computational spreadsheet (Excel-style)
"""

from __future__ import annotations

import io
import json
import os
import shutil
import threading
import time
import urllib.request
import uuid
import zipfile
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

TOOL_ID = "artcraft"
_HERE = Path(__file__).resolve().parent
DATA_DIR = _HERE / "data"
APPS_DIR = _HERE / "web" / "apps"
INSTALLED_FILE = DATA_DIR / "installed.json"
ENTRY_URL = "/modules/artcraft/"

_IO_LOCK = threading.RLock()
_JOB_LOCK = threading.RLock()

# Metadata catalog for all 12 ArtCraft applications (excluding pdfcraft)
CRAFT_APPS = [
    {
        "id": "photocraft",
        "name": "PhotoCraft",
        "tagline": "Photo & Raster Image Editor",
        "category": "Graphics & Photo",
        "description": "Clean-room Photoshop-style photo and pixel editor written in pure Rust. Non-destructive layers, masking, blend modes, adjustments, and hardware-accelerated filters.",
        "version": "0.9.0",
        "tag": "v0.9.0",
        "color": "#31a8ff",
        "size_mb": 10.9,
        "upstream": "storytold/photocraft",
        "download_url": "https://github.com/storytold/photocraft/releases/download/v0.9.0/photocraft-web-0.9.0.zip",
        "asset_name": "photocraft-web-0.9.0.zip",
    },
    {
        "id": "vectorcraft",
        "name": "VectorCraft",
        "tagline": "Vector Art & Illustration",
        "category": "Graphics & Photo",
        "description": "Professional vector illustration and design tool (Illustrator alternative). Bezier paths, boolean pathfinder operations, typography, gradient meshes, and SVG export.",
        "version": "0.11.0",
        "tag": "v0.11.0",
        "color": "#ff9a00",
        "size_mb": 23.5,
        "upstream": "storytold/vectorcraft",
        "download_url": "https://github.com/storytold/vectorcraft/releases/download/v0.11.0/vectorcraft-web-0.11.0.zip",
        "asset_name": "vectorcraft-web-0.11.0.zip",
    },
    {
        "id": "filmcraft",
        "name": "FilmCraft",
        "tagline": "Nonlinear Video Editor",
        "category": "Video & Animation",
        "description": "High-performance multi-track timeline video editor (Premiere Pro alternative). Video cut & splice, transitions, audio mixing, speed ramping, and keyframe animation.",
        "version": "0.8.0",
        "tag": "v0.8.0",
        "color": "#9966ff",
        "size_mb": 12.7,
        "upstream": "storytold/filmcraft",
        "download_url": "https://github.com/storytold/filmcraft/releases/download/v0.8.0/filmcraft-web-0.8.0.zip",
        "asset_name": "filmcraft-web-0.8.0.zip",
    },
    {
        "id": "lightcraft",
        "name": "LightCraft",
        "tagline": "RAW Photo Developing & Darkroom",
        "category": "Graphics & Photo",
        "description": "Non-destructive digital darkroom and RAW photography studio (Lightroom alternative). Tone curves, color grading, exposure recovery, and batch processing.",
        "version": "0.8.0",
        "tag": "v0.8.0",
        "color": "#00b4d8",
        "size_mb": 63.6,
        "upstream": "storytold/lightcraft",
        "download_url": "https://github.com/storytold/lightcraft/releases/download/v0.8.0/lightcraft-web-0.8.0.zip",
        "asset_name": "lightcraft-web-0.8.0.zip",
    },
    {
        "id": "effectcraft",
        "name": "EffectCraft",
        "tagline": "Motion Graphics & VFX Compositor",
        "category": "Video & Animation",
        "description": "Motion design, 2D particle simulation, and visual effects compositing (After Effects alternative). Layer effects, expressions, 3D camera tracker, and motion presets.",
        "version": "0.10.0",
        "tag": "v0.10.0",
        "color": "#845ec2",
        "size_mb": 18.2,
        "upstream": "storytold/effectcraft",
        "download_url": "https://github.com/storytold/effectcraft/releases/download/v0.10.0/effectcraft-web-0.10.0.zip",
        "asset_name": "effectcraft-web-0.10.0.zip",
    },
    {
        "id": "designcraft",
        "name": "DesignCraft",
        "tagline": "Page Layout & Desktop Publishing",
        "category": "Publishing & Layout",
        "description": "Multi-page document layout and editorial publishing suite (InDesign alternative). Master pages, grid snapping, paragraph styles, column flow, and print-ready export.",
        "version": "0.8.0",
        "tag": "v0.8.0",
        "color": "#ff3366",
        "size_mb": 14.6,
        "upstream": "storytold/designcraft",
        "download_url": "https://github.com/storytold/designcraft/releases/download/v0.8.0/designcraft-web-0.8.0.zip",
        "asset_name": "designcraft-web-0.8.0.zip",
    },
    {
        "id": "figcraft",
        "name": "FigCraft",
        "tagline": "UI/UX & Interactive Prototyping",
        "category": "Interface Design",
        "description": "Vector UI design, design systems, wireframing, and interactive prototyping tool (Figma alternative). Auto-layout, components, variants, and responsive frames.",
        "version": "0.6.0",
        "tag": "v0.6.0",
        "color": "#0acf83",
        "size_mb": 8.5,
        "upstream": "storytold/figcraft",
        "download_url": "https://github.com/storytold/figcraft/releases/download/v0.6.0/figcraft-web-0.6.0.zip",
        "asset_name": "figcraft-web-0.6.0.zip",
    },
    {
        "id": "wordcraft",
        "name": "WordCraft",
        "tagline": "Clean-room Word Processor",
        "category": "Office & Documents",
        "description": "Fast, distraction-free document authoring and rich word processing (Microsoft Word alternative). Typography controls, tables, footnotes, table of contents, and DOCX/PDF export.",
        "version": "0.7.0",
        "tag": "v0.7.0",
        "color": "#2b579a",
        "size_mb": 14.3,
        "upstream": "storytold/wordcraft",
        "download_url": "https://github.com/storytold/wordcraft/releases/download/v0.7.0/wordcraft-web-0.7.0.zip",
        "asset_name": "wordcraft-web-0.7.0.zip",
    },
    {
        "id": "soundcraft",
        "name": "SoundCraft",
        "tagline": "Digital Audio Workstation (DAW)",
        "category": "Video & Audio",
        "description": "Multi-track audio recording, editing, spectral analysis, and mixing console (Pro Tools / Audition alternative). Waveform editing, DSP effects, VST plugin host, and stem export.",
        "version": "0.7.0",
        "tag": "v0.7.0",
        "color": "#10b981",
        "size_mb": 5.7,
        "upstream": "storytold/soundcraft",
        "download_url": "https://github.com/storytold/soundcraft/releases/download/v0.7.0/soundcraft-web-0.7.0.zip",
        "asset_name": "soundcraft-web-0.7.0.zip",
    },
    {
        "id": "deckcraft",
        "name": "DeckCraft",
        "tagline": "Slide Decks & Presentation Studio",
        "category": "Office & Documents",
        "description": "Modern slide deck designer and interactive presentation studio (PowerPoint alternative). Dynamic slide transitions, presenter notes, media embedding, and vector graphics.",
        "version": "0.7.0",
        "tag": "v0.7.0",
        "color": "#d24726",
        "size_mb": 9.0,
        "upstream": "storytold/deckcraft",
        "download_url": "https://github.com/storytold/deckcraft/releases/download/v0.7.0/deckcraft-web-0.7.0.zip",
        "asset_name": "deckcraft-web-0.7.0.zip",
    },
    {
        "id": "cadcraft",
        "name": "CADCraft",
        "tagline": "2D/3D CAD & Precision Drafting",
        "category": "Engineering & CAD",
        "description": "Parametric drafting, technical schematics, and geometric modeling tool (AutoCAD alternative). Snapping, dimensions, layers, DWG/DXF/STEP compatibility, and precise constraints.",
        "version": "0.7.0",
        "tag": "v0.7.0",
        "color": "#e51c23",
        "size_mb": 8.1,
        "upstream": "storytold/cadcraft",
        "download_url": "https://github.com/storytold/cadcraft/releases/download/v0.7.0/cadcraft-web-0.7.0.zip",
        "asset_name": "cadcraft-web-0.7.0.zip",
    },
    {
        "id": "gridcraft",
        "name": "GridCraft",
        "tagline": "Computational Spreadsheets & Tables",
        "category": "Office & Documents",
        "description": "High-performance computational spreadsheet with real-time recalculation (Excel alternative). Math formulas, charts, statistical functions, pivot tables, and CSV/XLSX export.",
        "version": "0.7.0",
        "tag": "v0.7.0",
        "color": "#217346",
        "size_mb": 6.8,
        "upstream": "storytold/gridcraft",
        "download_url": "https://github.com/storytold/gridcraft/releases/download/v0.7.0/gridcraft-web-0.7.0.zip",
        "asset_name": "gridcraft-web-0.7.0.zip",
    },
]

APP_MAP = {app["id"]: app for app in CRAFT_APPS}

_job_state: Dict[str, dict] = {
    "active_app": None,
    "state": "idle",  # idle | running | done | error
    "message": "",
    "queue": [],
    "progress": {},
    "error": None,
}
_job_logs: deque = deque(maxlen=200)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _log_line(msg: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    _job_logs.append(f"[{ts}] {msg}")


UPDATES_FILE = DATA_DIR / "updates.json"
_updates_checking = False
_updates_lock = threading.RLock()


def _read_installed() -> dict:
    if not INSTALLED_FILE.exists():
        return {}
    try:
        with open(INSTALLED_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _write_installed(data: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = INSTALLED_FILE.with_name(f"{INSTALLED_FILE.name}.{uuid.uuid4().hex[:8]}.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, INSTALLED_FILE)


def _read_updates() -> dict:
    if not UPDATES_FILE.exists():
        return {}
    try:
        with open(UPDATES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _write_updates(data: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = UPDATES_FILE.with_name(f"{UPDATES_FILE.name}.{uuid.uuid4().hex[:8]}.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, UPDATES_FILE)


def _check_updates_worker() -> None:
    global _updates_checking
    _log_line("Checking for latest ArtCraft releases on GitHub...")
    cache = _read_updates()
    updated_entries = dict(cache.get("apps", {}))

    for app in CRAFT_APPS:
        aid = app["id"]
        upstream = app["upstream"]
        url = f"https://api.github.com/repos/{upstream}/releases/latest"
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "OneEAD-ArtCraft/1.0",
                "Accept": "application/vnd.github.v3+json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            tag = data.get("tag_name", "")
            ver = tag.lstrip("v")
            assets = data.get("assets", [])
            web_asset = next((a for a in assets if "web" in a.get("name", "") and a.get("name", "").endswith(".zip")), None)
            if ver and web_asset:
                updated_entries[aid] = {
                    "tag": tag,
                    "version": ver,
                    "download_url": web_asset.get("browser_download_url"),
                    "asset_name": web_asset.get("name"),
                    "published_at": data.get("published_at"),
                    "html_url": data.get("html_url"),
                }
        except Exception as exc:
            # If rate-limited or offline, keep existing cached entry
            pass

    with _updates_lock:
        cache["apps"] = updated_entries
        cache["checked_at"] = _now_iso()
        _write_updates(cache)
        _updates_checking = False
    _log_line("Completed ArtCraft update check.")


def check_updates(background: bool = True) -> dict:
    global _updates_checking
    with _updates_lock:
        if not _updates_checking:
            _updates_checking = True
            t = threading.Thread(target=_check_updates_worker, daemon=True)
            t.start()
            if not background:
                t.join(timeout=30)
    return _read_updates()


def is_app_installed(app_id: str) -> bool:
    app_dir = APPS_DIR / app_id
    if not app_dir.exists():
        return False
    if not (app_dir / "index.html").is_file():
        return False
    # Verify at least one wasm binary exists
    return bool(list(app_dir.glob("*.wasm")))


def get_app_info(app_id: str) -> Optional[dict]:
    meta = APP_MAP.get(app_id)
    if not meta:
        return None
    installed = is_app_installed(app_id)
    rec = _read_installed().get(app_id, {})
    installed_ver = rec.get("version", meta["version"]) if installed else None

    # Check update status
    updates_cache = _read_updates()
    latest_info = updates_cache.get("apps", {}).get(app_id, {})
    latest_ver = latest_info.get("version") or meta["version"]
    latest_url = latest_info.get("download_url") or meta["download_url"]

    has_update = False
    if installed and installed_ver and latest_ver:
        # Simple semantic version check
        has_update = latest_ver != installed_ver

    return {
        **meta,
        "download_url": latest_url,
        "installed": installed,
        "installed_version": installed_ver,
        "latest_version": latest_ver,
        "has_update": has_update,
        "installed_at": rec.get("installed_at") if installed else None,
        "app_url": f"/modules/artcraft/apps/{app_id}/index.html",
        "icon_url": f"/modules/artcraft/icons/{app_id}.webp",
    }


def list_apps() -> List[dict]:
    return [get_app_info(app["id"]) for app in CRAFT_APPS]


def _extract_zip(zip_bytes: bytes, target_dir: Path) -> None:
    target_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        members = z.namelist()
        prefix = ""
        if members and "/" in members[0]:
            top_dir = members[0].split("/")[0] + "/"
            if all(m.startswith(top_dir) for m in members if not m.endswith("/")):
                prefix = top_dir

        for member in members:
            rel = member[len(prefix):] if prefix and member.startswith(prefix) else member
            if not rel or rel.endswith("/"):
                continue
            out_file = target_dir / rel
            out_file.parent.mkdir(parents=True, exist_ok=True)
            with open(out_file, "wb") as f:
                f.write(z.read(member))


def _download_and_install_one(app_id: str) -> None:
    meta = APP_MAP.get(app_id)
    if not meta:
        raise ValueError(f"Unknown app: {app_id}")

    url = meta["download_url"]
    name = meta["name"]
    _log_line(f"Downloading {name} ({meta['asset_name']})...")

    req = urllib.request.Request(url, headers={"User-Agent": "OneEAD-ArtCraft/1.0"})
    with urllib.request.urlopen(req, timeout=90) as resp:
        zip_bytes = resp.read()

    _log_line(f"Downloaded {len(zip_bytes)} bytes for {name}. Unpacking WebAssembly engine...")
    app_dir = APPS_DIR / app_id
    _extract_zip(zip_bytes, app_dir)

    # Record installed metadata
    installed_map = _read_installed()
    installed_map[app_id] = {
        "version": meta["version"],
        "tag": meta["tag"],
        "installed_at": _now_iso(),
        "download_url": url,
    }
    _write_installed(installed_map)
    _log_line(f"Successfully installed {name} v{meta['version']}!")


def _worker_loop() -> None:
    while True:
        with _JOB_LOCK:
            if not _job_state["queue"]:
                _job_state["state"] = "done"
                _job_state["active_app"] = None
                _job_state["message"] = "All requested apps installed."
                break
            app_id = _job_state["queue"].pop(0)
            _job_state["active_app"] = app_id
            _job_state["state"] = "running"
            meta = APP_MAP.get(app_id, {})
            app_name = meta.get("name", app_id)
            _job_state["message"] = f"Installing {app_name} ({meta.get('size_mb', 0):.1f} MB)..."

        try:
            _download_and_install_one(app_id)
            with _JOB_LOCK:
                _job_state["progress"][app_id] = "installed"
        except Exception as exc:
            _log_line(f"Error installing {app_id}: {exc}")
            with _JOB_LOCK:
                _job_state["progress"][app_id] = f"error: {exc}"
                _job_state["error"] = str(exc)


def install_app(app_id: str, force: bool = False) -> dict:
    if app_id not in APP_MAP:
        raise ValueError(f"Invalid app id: {app_id}")

    with _JOB_LOCK:
        if not force and is_app_installed(app_id):
            return {"status": "already_installed", "app_id": app_id}

        if app_id not in _job_state["queue"] and _job_state["active_app"] != app_id:
            _job_state["queue"].append(app_id)

        if _job_state["state"] != "running":
            _job_state["state"] = "running"
            t = threading.Thread(target=_worker_loop, daemon=True)
            t.start()

        return {
            "status": "queued",
            "app_id": app_id,
            "queue": list(_job_state["queue"]),
        }


def install_all(force: bool = False) -> dict:
    with _JOB_LOCK:
        for app in CRAFT_APPS:
            aid = app["id"]
            if force or not is_app_installed(aid):
                if aid not in _job_state["queue"] and _job_state["active_app"] != aid:
                    _job_state["queue"].append(aid)

        if _job_state["state"] != "running" and _job_state["queue"]:
            _job_state["state"] = "running"
            t = threading.Thread(target=_worker_loop, daemon=True)
            t.start()

        return {
            "status": "queued",
            "total_queued": len(_job_state["queue"]),
            "queue": list(_job_state["queue"]),
        }


def status() -> dict:
    apps = list_apps()
    installed_count = sum(1 for a in apps if a["installed"])
    updates_available_count = sum(1 for a in apps if a.get("has_update"))

    with _JOB_LOCK:
        job_copy = dict(_job_state)
        logs = list(_job_logs)

    updates_cache = _read_updates()

    return {
        "installed": True,
        "ready": True,
        "total_apps": len(apps),
        "installed_count": installed_count,
        "updates_available_count": updates_available_count,
        "checking_updates": _updates_checking,
        "updates_checked_at": updates_cache.get("checked_at"),
        "apps": apps,
        "job": job_copy,
        "job_log": logs[-50:],
        "entry_url": ENTRY_URL,
    }

