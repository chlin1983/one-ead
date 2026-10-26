"""SolidCraft manager for One EAD.

SolidCraft (Apache-2.0, https://github.com/tangency-labs/solidcraft) is an
open-source parametric 3D CAD modeling suite built entirely in pure Rust and
compiled to WebAssembly with hardware acceleration.

This module:
1. Automatically tracks official GitHub releases (tangency-labs/solidcraft).
2. Supports both Stable Release and Nightly channels with one-click and auto updates.
3. Completely neutralizes any corporate-blocked domains (e.g. solidcraft.io)
   by serving all assets, WASM binaries, fonts, and scripts 100% locally from One EAD.
4. Mirrors all browser-created CAD designs, recovery saves, and preferences
   directly to disk (under ``data/store/projects/``) so user projects survive
   browser restarts, origin/port changes, and browser cache clears.
5. Ensures all user designs and local binaries remain strictly local and are
   excluded from git.
"""

from __future__ import annotations

import io
import json
import os
import re
import shutil
import threading
import time
import urllib.request
import uuid
import zipfile
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import quote, unquote

TOOL_ID = "solidcraft"
UPSTREAM = "tangency-labs/solidcraft"
_HERE = Path(__file__).resolve().parent
DATA_DIR = _HERE / "data"
STORE_DIR = DATA_DIR / "store"
PROJECTS_DIR = STORE_DIR / "projects"
TRASH_DIR = STORE_DIR / "_trash"
WORK_DIR = DATA_DIR / "work"
CONFIG_FILE = DATA_DIR / "config.json"
INSTALLED_FILE = DATA_DIR / "installed.json"
PREFS_FILE = STORE_DIR / "prefs.json"
APP_DIR = _HERE / "web" / "app"
ENTRY_URL = "/modules/solidcraft/"

LATEST_TTL_S = 24 * 60 * 60  # 24 hours (daily check interval)
MAX_STORE_BYTES = 500 * 1024 * 1024  # 500 MB per file limit
DEFAULT_CONFIG = {"channel": "release", "auto_update": True, "check_interval_hours": 24}
CHANNELS = ("release", "nightly")

_FILENAME_RE = re.compile(r"^[A-Za-z0-9_.\- ]{1,250}$")
_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")

_IO_LOCK = threading.RLock()
_JOB_LOCK = threading.Lock()
_latest_lock = threading.Lock()
_latest: dict = {"channel": None, "info": None, "checked_at": 0.0, "error": None}
_job: dict = {
    "state": "idle",  # idle | running | done | error
    "phase": "",
    "message": "",
    "error": None,
    "started_at": None,
    "finished_at": None,
    "target": None,
}
_job_log: deque = deque(maxlen=200)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------- config / state

def _read_json(path: Path, default: Any) -> Any:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{uuid.uuid4().hex[:8]}.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)


def get_config() -> dict:
    cfg = dict(DEFAULT_CONFIG)
    stored = _read_json(CONFIG_FILE, {})
    if isinstance(stored, dict):
        if stored.get("channel") in CHANNELS:
            cfg["channel"] = stored["channel"]
        if isinstance(stored.get("auto_update"), bool):
            cfg["auto_update"] = stored["auto_update"]
        if isinstance(stored.get("check_interval_hours"), (int, float)) and stored.get("check_interval_hours") > 0:
            cfg["check_interval_hours"] = stored["check_interval_hours"]
    return cfg


def set_config(payload: dict) -> dict:
    cfg = get_config()
    if payload.get("channel") in CHANNELS:
        cfg["channel"] = payload["channel"]
    if isinstance(payload.get("auto_update"), bool):
        cfg["auto_update"] = payload["auto_update"]
    if isinstance(payload.get("check_interval_hours"), (int, float)) and payload.get("check_interval_hours") > 0:
        cfg["check_interval_hours"] = payload["check_interval_hours"]
    _write_json(CONFIG_FILE, cfg)
    return cfg


def _get_ttl_seconds() -> float:
    cfg = get_config()
    hours = cfg.get("check_interval_hours", 24)
    try:
        return max(1.0, float(hours)) * 3600.0
    except (TypeError, ValueError):
        return LATEST_TTL_S


def get_installed() -> Optional[dict]:
    if not (APP_DIR / "index.html").exists():
        return None
    info = _read_json(INSTALLED_FILE, None)
    return info if isinstance(info, dict) else {"version": "unknown", "tag": "unknown", "label": "installed"}


def is_installed() -> bool:
    return (APP_DIR / "index.html").exists()


# ---------------------------------------------------------------- upstream lookup

def _http_json(url: str, timeout: float = 12.0) -> Any:
    req = urllib.request.Request(
        url, headers={"User-Agent": "One-EAD-SolidCraft", "Accept": "application/vnd.github+json"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _resolve_latest(channel: str) -> dict:
    """Find the newest SolidCraft release with prebuilt web bundle for given channel."""
    if channel == "nightly":
        releases = _http_json(f"https://api.github.com/repos/{UPSTREAM}/releases")
        for rel in releases:
            tag = rel.get("tag_name", "")
            assets = rel.get("assets", [])
            web_asset = next((a for a in assets if "web" in a.get("name", "") and a.get("name", "").endswith(".zip")), None)
            if web_asset and "nightly" in tag:
                return {
                    "channel": "nightly",
                    "tag": tag,
                    "label": f"Nightly ({tag})",
                    "download_url": web_asset["browser_download_url"],
                    "asset_name": web_asset["name"],
                    "size": web_asset.get("size", 0),
                    "published_at": rel.get("published_at"),
                }

    # Default to official stable release
    rel = _http_json(f"https://api.github.com/repos/{UPSTREAM}/releases/latest")
    tag = rel.get("tag_name", "")
    assets = rel.get("assets", [])
    web_asset = next((a for a in assets if "web" in a.get("name", "") and a.get("name", "").endswith(".zip")), None)
    if not web_asset:
        # Fallback to searching all releases if latest doesn't have web asset
        releases = _http_json(f"https://api.github.com/repos/{UPSTREAM}/releases")
        for r in releases:
            a_web = next((a for a in r.get("assets", []) if "web" in a.get("name", "") and a.get("name", "").endswith(".zip")), None)
            if a_web:
                rel = r
                tag = r.get("tag_name", "")
                web_asset = a_web
                break

    if not web_asset:
        raise RuntimeError("No solidcraft-web zip asset found in upstream GitHub releases")

    return {
        "channel": "release",
        "tag": tag,
        "label": tag,
        "download_url": web_asset["browser_download_url"],
        "asset_name": web_asset["name"],
        "size": web_asset.get("size", 0),
        "published_at": rel.get("published_at"),
    }


def check_latest(force: bool = False) -> dict:
    """Look up newest upstream version for configured channel (cached)."""
    channel = get_config()["channel"]
    ttl = _get_ttl_seconds()
    with _latest_lock:
        fresh = (
            _latest["channel"] == channel
            and _latest["info"] is not None
            and time.time() - _latest["checked_at"] < ttl
        )
        if fresh and not force:
            return dict(_latest)
        try:
            info = _resolve_latest(channel)
            _latest.update(channel=channel, info=info, checked_at=time.time(), error=None)
        except Exception as exc:
            if _latest["channel"] != channel:
                _latest.update(channel=channel, info=None)
            _latest.update(checked_at=time.time(), error=f"{type(exc).__name__}: {exc}")
        return dict(_latest)


# ---------------------------------------------------------------- installation & patcher

def _log(line: str) -> None:
    line = _ANSI_RE.sub("", line).rstrip()
    if line:
        _job_log.append(line[:300])


def _set_phase(phase: str, message: str) -> None:
    _job["phase"] = phase
    _job["message"] = message
    _log(f"== {message}")


def _download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "One-EAD-SolidCraft"})
    with urllib.request.urlopen(req, timeout=45) as resp, open(dest, "wb") as out:
        total = int(resp.headers.get("Content-Length") or 0)
        done = 0
        last = 0.0
        while True:
            chunk = resp.read(256 * 1024)
            if not chunk:
                break
            out.write(chunk)
            done += len(chunk)
            if time.time() - last > 0.5:
                last = time.time()
                size = f"{done / 1e6:.1f}" + (f" / {total / 1e6:.1f}" if total else "")
                _job["message"] = f"Downloading SolidCraft Web ({size} MB)"


def _extract(zip_path: Path, dest: Path) -> Path:
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(dest)

    # If the zip extracted into a single wrapper folder (e.g., solidcraft-web-0.22.0/), find it
    if (dest / "index.html").exists():
        return dest
    for sub in dest.iterdir():
        if sub.is_dir() and (sub / "index.html").exists():
            return sub
    raise RuntimeError("Extracted archive has no index.html")


def _finalize_dist(dist: Path) -> None:
    """Neutralize corporate-blocked domains, hook in One EAD persistent disk memory."""
    index = dist / "index.html"
    if not index.exists():
        raise RuntimeError("Build produced no index.html")
    html = index.read_text(encoding="utf-8")

    # 1. Neutralize all references to solidcraft.io / docs.solidcraft.io (which may be blocked by corporate firewalls)
    html = re.sub(r'https?://(?:docs\.)?solidcraft\.io/[^\s"\'>]*', '#', html)
    html = re.sub(r'https?://solidcraft\.ai/[^\s"\'>]*', '#', html)

    # 2. Inject One EAD persistence script before </head>
    if '<script src="/modules/solidcraft/persist.js"></script>' not in html:
        hook = '<script src="/modules/solidcraft/persist.js"></script>\n</head>'
        html = html.replace("</head>", hook, 1)

    index.write_text(html, encoding="utf-8")
    _log("Patched index.html with One EAD persistent disk mirror and neutralized external domain calls")


def _swap_into_place(dist: Path) -> None:
    new_dir = APP_DIR.with_name("app.new")
    old_dir = APP_DIR.with_name("app.old")
    shutil.rmtree(new_dir, ignore_errors=True)
    shutil.rmtree(old_dir, ignore_errors=True)
    shutil.move(str(dist), str(new_dir))
    for attempt in range(8):
        try:
            if APP_DIR.exists():
                os.replace(APP_DIR, old_dir)
            os.replace(new_dir, APP_DIR)
            break
        except OSError:
            if attempt == 7:
                raise
            time.sleep(0.4)
    shutil.rmtree(old_dir, ignore_errors=True)


def _install(target: dict) -> None:
    shutil.rmtree(WORK_DIR, ignore_errors=True)
    WORK_DIR.mkdir(parents=True, exist_ok=True)

    url = target["download_url"]
    _set_phase("download", f"Downloading {target['asset_name']}")
    zip_path = WORK_DIR / "solidcraft-web.zip"
    _download(url, zip_path)

    _set_phase("extract", "Extracting WebAssembly bundle")
    extract_dir = WORK_DIR / "extracted"
    dist = _extract(zip_path, extract_dir)
    zip_path.unlink(missing_ok=True)

    _set_phase("finalize", "Configuring One EAD persistence & offline mode")
    _finalize_dist(dist)

    _swap_into_place(dist)
    _write_json(
        INSTALLED_FILE,
        {
            "tag": target["tag"],
            "label": target["label"],
            "channel": target["channel"],
            "asset_name": target["asset_name"],
            "installed_at": _now_iso(),
        },
    )


def _job_main(target: dict) -> None:
    try:
        _install(target)
        _job.update(state="done", phase="done", message="Up to date", error=None)
        _log("== Done")
    except Exception as exc:
        _job.update(state="error", phase="error", message="Installation failed", error=f"{type(exc).__name__}: {exc}")
        _log(f"!! {exc}")
    finally:
        _job["finished_at"] = _now_iso()
        shutil.rmtree(WORK_DIR, ignore_errors=True)


def start_install(force: bool = False) -> dict:
    """Download and set up the newest upstream SolidCraft release in the background."""
    with _JOB_LOCK:
        if _job["state"] == "running":
            return status()
        latest = check_latest(force=True)
        if not latest["info"]:
            _job.update(
                state="error",
                phase="error",
                message="Cannot reach GitHub",
                error=latest["error"] or "Unknown error",
                finished_at=_now_iso(),
            )
            return status()
        target = latest["info"]
        installed = get_installed()
        if (
            installed
            and not force
            and installed.get("tag") == target["tag"]
            and installed.get("channel") == target["channel"]
        ):
            return status()
        _job_log.clear()
        _job.update(
            state="running",
            phase="check",
            message="Starting download",
            error=None,
            started_at=_now_iso(),
            finished_at=None,
            target=target["label"],
        )
        threading.Thread(target=_job_main, args=(target,), name="solidcraft-install", daemon=True).start()
    return status()


def status() -> dict:
    cfg = get_config()
    installed = get_installed()
    with _latest_lock:
        latest = (
            dict(_latest)
            if _latest["channel"] == cfg["channel"]
            else {"info": None, "checked_at": 0.0, "error": None}
        )
    info = latest.get("info")
    update_available = bool(
        info
        and installed
        and (installed.get("tag") != info["tag"] or installed.get("channel") != info["channel"])
    )
    return {
        "installed": installed is not None,
        "version": installed,
        "latest": info,
        "latest_checked_at": latest.get("checked_at"),
        "latest_error": latest.get("error"),
        "update_available": update_available,
        "config": cfg,
        "job": {**_job, "log": list(_job_log)[-60:]},
        "store": store_summary(),
        "entry_url": ENTRY_URL,
        "url": ENTRY_URL,
        "ready": installed is not None,
        "running": _job["state"] == "running",
    }


def launch() -> dict:
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    return status()


# ---------------------------------------------------------------- disk store (user projects)

def _sanitize_filename(filename: str) -> str:
    cleaned = filename.strip().replace("\\", "/").lstrip("/")
    parts = [p for p in cleaned.split("/") if p and p != "."]
    if not parts or any(p == ".." or not _FILENAME_RE.match(p) for p in parts):
        raise ValueError("Invalid filename")
    return "/".join(parts)


def store_index() -> dict:
    """List all projects saved in disk store with metadata."""
    projects: list[dict] = []
    with _IO_LOCK:
        if PROJECTS_DIR.exists():
            for p in sorted(PROJECTS_DIR.rglob("*"), key=lambda x: x.stat().st_mtime, reverse=True):
                if p.is_file() and not p.name.startswith((".", "_")):
                    stat = p.stat()
                    rel_name = p.relative_to(PROJECTS_DIR).as_posix()
                    projects.append({
                        "filename": rel_name,
                        "name": p.stem,
                        "size": stat.st_size,
                        "mtime": stat.st_mtime,
                        "is_recovery": "recovery" in p.name.lower(),
                        "date_iso": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
                    })
    return {"projects": projects, "total": len(projects)}


def store_get_file(filename: str) -> Optional[bytes]:
    cleaned = _sanitize_filename(filename)
    path = PROJECTS_DIR / cleaned
    with _IO_LOCK:
        return path.read_bytes() if path.exists() else None


def store_put_file(filename: str, body: bytes) -> dict:
    if len(body) > MAX_STORE_BYTES:
        raise ValueError("File exceeds maximum allowed size (500 MB)")
    cleaned = _sanitize_filename(filename)
    path = PROJECTS_DIR / cleaned
    with _IO_LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f"{path.name}.{uuid.uuid4().hex[:8]}.tmp")
        tmp.write_bytes(body)
        for attempt in range(6):
            try:
                os.replace(tmp, path)
                break
            except OSError:
                if attempt == 5:
                    shutil.copyfile(tmp, path)
                    tmp.unlink(missing_ok=True)
                    break
                time.sleep(0.05)
    return {"status": "ok", "filename": cleaned, "size": len(body)}


def store_delete_file(filename: str) -> dict:
    """Move to trash instead of deleting permanently."""
    cleaned = _sanitize_filename(filename)
    path = PROJECTS_DIR / cleaned
    with _IO_LOCK:
        if not path.exists():
            return {"status": "missing"}
        TRASH_DIR.mkdir(parents=True, exist_ok=True)
        target = TRASH_DIR / f"{path.stem}.{int(time.time())}{path.suffix}"
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(path), str(target))
    return {"status": "trashed", "filename": cleaned}


def store_get_prefs() -> dict:
    with _IO_LOCK:
        return _read_json(PREFS_FILE, {})


def store_put_prefs(data: dict) -> dict:
    with _IO_LOCK:
        _write_json(PREFS_FILE, data)
    return {"status": "ok"}


def store_summary() -> dict:
    with _IO_LOCK:
        count = len(list(PROJECTS_DIR.glob("*"))) if PROJECTS_DIR.exists() else 0
        total_bytes = sum(p.stat().st_size for p in PROJECTS_DIR.glob("*") if p.is_file()) if PROJECTS_DIR.exists() else 0
    return {"count": count, "total_bytes": total_bytes, "path": str(PROJECTS_DIR)}
