"""PdfCraft manager for One EAD.

PdfCraft (MIT / Apache-2.0, https://github.com/storytold/pdfcraft) is an
open-source PDF reader and editor written from scratch in pure Rust.
This module manages the pre-built WebAssembly bundle, checks for updates,
and provides a local document library for offline viewing and editing.
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
from typing import Optional

TOOL_ID = "pdfcraft"
UPSTREAM = "storytold/pdfcraft"
_HERE = Path(__file__).resolve().parent
DATA_DIR = _HERE / "data"
DOCS_DIR = DATA_DIR / "docs"
CONFIG_FILE = DATA_DIR / "config.json"
INSTALLED_FILE = DATA_DIR / "installed.json"
APP_DIR = _HERE / "web" / "app"
ENTRY_URL = "/modules/pdfcraft/"

LATEST_TTL_S = 30 * 60
DEFAULT_CONFIG = {"channel": "release", "auto_update": False}

_IO_LOCK = threading.RLock()
_JOB_LOCK = threading.RLock()
_latest_lock = threading.Lock()
_latest: dict = {"info": None, "checked_at": 0.0, "error": None}

DEFAULT_RELEASE_INFO = {
    "tag": "v0.8.0",
    "version": "0.8.0",
    "download_url": "https://github.com/storytold/pdfcraft/releases/download/v0.8.0/pdfcraft-web-0.8.0.zip",
    "asset_name": "pdfcraft-web-0.8.0.zip",
}
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

def _read_json(path: Path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{uuid.uuid4().hex[:8]}.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)


def get_config() -> dict:
    cfg = dict(DEFAULT_CONFIG)
    stored = _read_json(CONFIG_FILE, {})
    if isinstance(stored, dict):
        if isinstance(stored.get("auto_update"), bool):
            cfg["auto_update"] = stored["auto_update"]
    return cfg


def set_config(updates: dict) -> dict:
    with _IO_LOCK:
        cfg = get_config()
        if "auto_update" in updates:
            cfg["auto_update"] = bool(updates["auto_update"])
        _write_json(CONFIG_FILE, cfg)
        return cfg


def get_installed() -> Optional[dict]:
    # Bundle is only considered installed if index.html and a wasm binary exist on disk
    if not APP_DIR.exists() or not (APP_DIR / "index.html").is_file():
        return None
    wasm_files = list(APP_DIR.glob("*.wasm"))
    if not wasm_files:
        return None

    data = _read_json(INSTALLED_FILE, None)
    if isinstance(data, dict) and data.get("version"):
        return data

    return {
        "version": "0.8.0",
        "tag": "v0.8.0",
        "installed_at": _now_iso(),
        "wasm_file": wasm_files[0].name,
    }


def record_installed(info: dict) -> None:
    with _IO_LOCK:
        _write_json(INSTALLED_FILE, info)


# ---------------------------------------------------------------- sample doc generator

def ensure_sample_doc() -> None:
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    sample_file = DOCS_DIR / "Welcome_to_PdfCraft.pdf"
    if sample_file.exists():
        return

    try:
        import fitz  # PyMuPDF

        doc = fitz.open()

        # --- Page 1: Overview & Features ---
        p1 = doc.new_page(width=595, height=842)
        # Header accent bar
        p1.draw_rect(fitz.Rect(0, 0, 595, 8), fill=(0.07, 0.65, 0.54), color=None)

        # Title
        p1.insert_text(fitz.Point(48, 70), "PdfCraft: The Rust PDF Workbench", fontsize=22, fontname="helv", color=(0.07, 0.65, 0.54))
        p1.insert_text(fitz.Point(48, 94), "Fast, local, and privacy-first PDF editor integrated in One EAD", fontsize=11, fontname="helv", color=(0.35, 0.42, 0.5))
        p1.draw_line(fitz.Point(48, 108), fitz.Point(547, 108), color=(0.82, 0.86, 0.9), width=1)

        # Card 1: What is PdfCraft?
        p1.draw_rect(fitz.Rect(48, 125, 547, 230), color=(0.85, 0.89, 0.94), fill=(0.97, 0.98, 1.0), width=1)
        p1.insert_text(fitz.Point(62, 148), "Native WebAssembly Architecture", fontsize=13, fontname="helv", color=(0.1, 0.15, 0.2))
        p1.insert_text(fitz.Point(62, 170), "PdfCraft is a clean-room reimplementation of Adobe Acrobat, built from scratch in pure Rust.", fontsize=10, fontname="helv", color=(0.25, 0.3, 0.38))
        p1.insert_text(fitz.Point(62, 186), "Compiled directly to WebAssembly with high-performance WebGPU / WebGL2 hardware acceleration.", fontsize=10, fontname="helv", color=(0.25, 0.3, 0.38))
        p1.insert_text(fitz.Point(62, 202), "No telemetry, no external cloud dependencies — 100% private and offline on your machine.", fontsize=10, fontname="helv", color=(0.25, 0.3, 0.38))
        p1.insert_text(fitz.Point(62, 218), "Source & Community: https://github.com/storytold/pdfcraft", fontsize=9, fontname="helv", color=(0.07, 0.65, 0.54))

        # Core Tools Grid
        p1.insert_text(fitz.Point(48, 258), "Key Capabilities & Tools", fontsize=14, fontname="helv", color=(0.1, 0.15, 0.2))

        features = [
            ("Organize Pages", "Select, rotate, delete, insert blank pages, or reorder pages like cards on a table."),
            ("Combine & Split", "Merge multiple PDFs into one while preserving bookmarks, or split documents per page count."),
            ("Faithful Typography", "Real-world fonts, kerning, ligatures, emoji, vertical scripts, gradients, and soft masks."),
            ("Interactive Forms & Layers", "Fill form fields, toggle optional content layers, inspect properties and security handler."),
            ("Command Palette", "Press Ctrl+K (or Cmd+K) to instantly search every tool, action, and preference."),
            ("Fearless Saves & Undo", "Deep multi-level undo (Ctrl+Z) that works even after save. Atomic verified disk writes.")
        ]

        y_pos = 285
        for title, desc in features:
            p1.draw_circle(fitz.Point(58, y_pos - 4), 3, fill=(0.07, 0.65, 0.54), color=(0.07, 0.65, 0.54))
            p1.insert_text(fitz.Point(72, y_pos), f"{title}:", fontsize=10.5, fontname="helv", color=(0.08, 0.12, 0.18))
            p1.insert_text(fitz.Point(72, y_pos + 14), desc, fontsize=9.5, fontname="helv", color=(0.35, 0.4, 0.48))
            y_pos += 42

        # Bottom banner
        p1.draw_rect(fitz.Rect(48, 560, 547, 630), color=(0.07, 0.65, 0.54), fill=(0.93, 0.98, 0.96), width=1)
        p1.insert_text(fitz.Point(62, 584), "Quick Tip for One EAD Users", fontsize=11, fontname="helv", color=(0.05, 0.5, 0.4))
        p1.insert_text(fitz.Point(62, 604), "You can drop any engineering datasheet or test report into this window or upload it via", fontsize=9.5, fontname="helv", color=(0.2, 0.25, 0.3))
        p1.insert_text(fitz.Point(62, 618), "the One EAD top toolbar to keep it permanently saved in your local PDF library.", fontsize=9.5, fontname="helv", color=(0.2, 0.25, 0.3))

        # Footer
        p1.draw_line(fitz.Point(48, 780), fitz.Point(547, 780), color=(0.85, 0.88, 0.92), width=1)
        p1.insert_text(fitz.Point(48, 796), "One EAD Engineering Portal · PdfCraft Workbench Specimen", fontsize=8.5, fontname="helv", color=(0.5, 0.55, 0.6))
        p1.insert_text(fitz.Point(495, 796), "Page 1 of 2", fontsize=8.5, fontname="helv", color=(0.5, 0.55, 0.6))

        # --- Page 2: Electroacoustic Sample Specimen ---
        p2 = doc.new_page(width=595, height=842)
        p2.draw_rect(fitz.Rect(0, 0, 595, 8), fill=(0.07, 0.65, 0.54), color=None)

        p2.insert_text(fitz.Point(48, 70), "Electroacoustic Specimen Reference", fontsize=20, fontname="helv", color=(0.07, 0.65, 0.54))
        p2.insert_text(fitz.Point(48, 92), "Sample test verification sheet for page organization, cropping, and annotations", fontsize=10.5, fontname="helv", color=(0.35, 0.42, 0.5))
        p2.draw_line(fitz.Point(48, 108), fitz.Point(547, 108), color=(0.82, 0.86, 0.9), width=1)

        # Draw a simulated frequency response graph
        p2.insert_text(fitz.Point(48, 138), "Simulated Receiver Frequency Response (SPL vs Freq)", fontsize=12, fontname="helv", color=(0.1, 0.15, 0.2))
        graph_rect = fitz.Rect(48, 150, 547, 340)
        p2.draw_rect(graph_rect, color=(0.7, 0.75, 0.82), fill=(0.98, 0.99, 1.0), width=1)

        # Grid lines inside graph
        for x in range(98, 547, 50):
            p2.draw_line(fitz.Point(x, 150), fitz.Point(x, 340), color=(0.88, 0.91, 0.95), width=0.8)
        for y in range(180, 340, 35):
            p2.draw_line(fitz.Point(48, y), fitz.Point(547, y), color=(0.88, 0.91, 0.95), width=0.8)

        # Plot curve
        curve_pts = [
            fitz.Point(50, 310), fitz.Point(90, 305), fitz.Point(140, 290),
            fitz.Point(200, 260), fitz.Point(260, 220), fitz.Point(320, 195),
            fitz.Point(360, 210), fitz.Point(410, 185), fitz.Point(460, 230),
            fitz.Point(510, 280), fitz.Point(545, 315)
        ]
        for i in range(len(curve_pts) - 1):
            p2.draw_line(curve_pts[i], curve_pts[i+1], color=(0.07, 0.65, 0.54), width=2.5)

        p2.insert_text(fitz.Point(55, 332), "100 Hz", fontsize=8, fontname="helv", color=(0.4, 0.45, 0.5))
        p2.insert_text(fitz.Point(250, 332), "1 kHz", fontsize=8, fontname="helv", color=(0.4, 0.45, 0.5))
        p2.insert_text(fitz.Point(510, 332), "10 kHz", fontsize=8, fontname="helv", color=(0.4, 0.45, 0.5))

        # Specimen Metrics Table
        p2.insert_text(fitz.Point(48, 375), "Acoustic Target Specifications", fontsize=12, fontname="helv", color=(0.1, 0.15, 0.2))
        table_top = 390
        p2.draw_rect(fitz.Rect(48, table_top, 547, table_top + 26), fill=(0.12, 0.18, 0.25), color=None)
        p2.insert_text(fitz.Point(60, table_top + 17), "Parameter", fontsize=9.5, fontname="helv", color=(1, 1, 1))
        p2.insert_text(fitz.Point(220, table_top + 17), "Nominal Value", fontsize=9.5, fontname="helv", color=(1, 1, 1))
        p2.insert_text(fitz.Point(360, table_top + 17), "Tolerance", fontsize=9.5, fontname="helv", color=(1, 1, 1))
        p2.insert_text(fitz.Point(460, table_top + 17), "Units", fontsize=9.5, fontname="helv", color=(1, 1, 1))

        rows = [
            ("Peak Sensitivity @ 1 kHz", "108.5", "+/- 1.5", "dB SPL / mW"),
            ("First Acoustic Resonance", "2.85", "+/- 0.2", "kHz"),
            ("Total Harmonic Distortion", "< 0.8", "Max 1.2", "% @ 94 dB SPL"),
            ("DC Resistance (DCR)", "28.4", "+/- 10%", "Ohms"),
            ("Equivalent Noise Floor", "24.0", "Max 26.0", "dB(A) SPL"),
        ]

        row_y = table_top + 26
        for i, (param, nom, tol, unit) in enumerate(rows):
            bg = (0.98, 0.99, 1.0) if i % 2 == 0 else (1.0, 1.0, 1.0)
            p2.draw_rect(fitz.Rect(48, row_y, 547, row_y + 24), fill=bg, color=(0.88, 0.91, 0.95), width=0.6)
            p2.insert_text(fitz.Point(60, row_y + 16), param, fontsize=9, fontname="helv", color=(0.15, 0.2, 0.28))
            p2.insert_text(fitz.Point(220, row_y + 16), nom, fontsize=9, fontname="helv", color=(0.07, 0.65, 0.54))
            p2.insert_text(fitz.Point(360, row_y + 16), tol, fontsize=9, fontname="helv", color=(0.35, 0.4, 0.48))
            p2.insert_text(fitz.Point(460, row_y + 16), unit, fontsize=9, fontname="helv", color=(0.35, 0.4, 0.48))
            row_y += 24

        # Footer
        p2.draw_line(fitz.Point(48, 780), fitz.Point(547, 780), color=(0.85, 0.88, 0.92), width=1)
        p2.insert_text(fitz.Point(48, 796), "One EAD Engineering Portal · PdfCraft Workbench Specimen", fontsize=8.5, fontname="helv", color=(0.5, 0.55, 0.6))
        p2.insert_text(fitz.Point(495, 796), "Page 2 of 2", fontsize=8.5, fontname="helv", color=(0.5, 0.55, 0.6))

        doc.save(str(sample_file))
        doc.close()
    except Exception as exc:
        print(f"[pdfcraft] Could not generate sample PDF: {exc}")


# ---------------------------------------------------------------- document store

def list_documents() -> list[dict]:
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    ensure_sample_doc()
    docs = []
    for p in sorted(DOCS_DIR.glob("*.pdf"), key=lambda x: x.stat().st_mtime, reverse=True):
        st = p.stat()
        docs.append({
            "name": p.name,
            "size": st.st_size,
            "modified": datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat(),
            "url": f"/api/{TOOL_ID}/doc/{p.name}",
        })
    return docs


def get_document_path(filename: str) -> Optional[Path]:
    safe_name = os.path.basename(filename)
    p = DOCS_DIR / safe_name
    return p if p.is_file() else None


def save_uploaded_document(filename: str, content: bytes) -> dict:
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = re.sub(r"[^A-Za-z0-9._\- ]", "_", os.path.basename(filename))
    if not safe_name.lower().endswith(".pdf"):
        safe_name += ".pdf"
    dest = DOCS_DIR / safe_name
    with open(dest, "wb") as f:
        f.write(content)
    st = dest.stat()
    return {
        "name": dest.name,
        "size": st.st_size,
        "modified": datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat(),
        "url": f"/api/{TOOL_ID}/doc/{dest.name}",
    }


def delete_document(filename: str) -> bool:
    p = get_document_path(filename)
    if p and p.exists():
        p.unlink()
        return True
    return False


def reveal_docs_dir() -> dict:
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    full_path = str(DOCS_DIR.resolve())
    target_file = next(DOCS_DIR.glob("*.pdf"), None)
    try:
        import subprocess
        if os.name == "nt":
            if target_file and target_file.is_file():
                subprocess.Popen(["explorer.exe", f"/select,{str(target_file.resolve())}"])
            else:
                subprocess.Popen(["explorer.exe", f"/n,{full_path}"])
        else:
            subprocess.Popen(["xdg-open", full_path])
        return {"status": "ok", "path": full_path}
    except Exception as exc:
        print(f"[pdfcraft] Could not open docs dir in Explorer: {exc}")
        return {"status": "error", "path": full_path, "error": str(exc)}


# ---------------------------------------------------------------- releases & updates

def _log_line(msg: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    _job_log.append(f"[{ts}] {msg}")


def check_latest(force: bool = False) -> dict:
    now = time.time()
    with _latest_lock:
        if not force and _latest["info"] and (now - _latest["checked_at"] < LATEST_TTL_S):
            return dict(_latest)

    # Automatically pull latest upstream bug fixes from official Storytold and sync to user fork
    try:
        from modules.artcraft import source_sync
        pdfcraft_item = next((r for r in source_sync.MANAGED_REPOS if r["id"] == "pdfcraft"), None)
        if pdfcraft_item:
            source_sync.sync_single_repo(pdfcraft_item)
    except Exception as exc:
        _log_line(f"Git sync warning: {exc}")

    url = f"https://api.github.com/repos/{UPSTREAM}/releases"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "OneEAD-PdfCraft/1.0",
            "Accept": "application/vnd.github.v3+json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if not isinstance(data, list) or not data:
            raise ValueError("No releases found in GitHub response")

        rel = data[0]
        tag = rel.get("tag_name", "")
        version = tag.lstrip("v")
        assets = rel.get("assets", [])

        web_asset = next((a for a in assets if "web" in a.get("name", "") and a.get("name", "").endswith(".zip")), None)

        info = {
            "tag": tag,
            "version": version,
            "published_at": rel.get("published_at"),
            "html_url": rel.get("html_url"),
            "download_url": web_asset.get("browser_download_url") if web_asset else None,
            "asset_name": web_asset.get("name") if web_asset else None,
            "asset_size": web_asset.get("size") if web_asset else None,
        }
        with _latest_lock:
            _latest["info"] = info
            _latest["checked_at"] = time.time()
            _latest["error"] = None

        # If auto_update is enabled, seamlessly install new bug-fixed build in the background
        if get_config().get("auto_update") and info.get("download_url"):
            inst = get_installed()
            if inst and inst.get("version") != info.get("version"):
                _log_line(f"Auto-update: new version {info.get('version')} detected. Updating engine...")
                start_install(force=True, target_info=info)

        with _latest_lock:
            return dict(_latest)
    except Exception as exc:
        with _latest_lock:
            _latest["checked_at"] = time.time()
            _latest["error"] = str(exc)
            return dict(_latest)


def _install_worker(target_info: dict) -> None:
    try:
        download_url = target_info.get("download_url") or DEFAULT_RELEASE_INFO["download_url"]
        asset_name = target_info.get("asset_name") or DEFAULT_RELEASE_INFO["asset_name"]

        _log_line(f"Starting download of {asset_name}...")
        req = urllib.request.Request(download_url, headers={"User-Agent": "OneEAD-PdfCraft/1.0"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            zip_bytes = resp.read()

        _log_line(f"Downloaded {len(zip_bytes)} bytes. Unpacking to {APP_DIR}...")
        APP_DIR.mkdir(parents=True, exist_ok=True)

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
            members = z.namelist()
            # Detect common top-level directory prefix if archive wraps files
            prefix = ""
            if members and "/" in members[0]:
                top_dir = members[0].split("/")[0] + "/"
                if all(m.startswith(top_dir) for m in members if not m.endswith("/")):
                    prefix = top_dir

            for member in members:
                rel = member[len(prefix):] if prefix and member.startswith(prefix) else member
                if not rel or rel.endswith("/"):
                    continue
                out_file = APP_DIR / rel
                out_file.parent.mkdir(parents=True, exist_ok=True)
                with open(out_file, "wb") as f:
                    f.write(z.read(member))

        _log_line("Extraction finished successfully.")
        record_installed({
            "version": target_info.get("version", "0.8.0"),
            "tag": target_info.get("tag", "v0.8.0"),
            "installed_at": _now_iso(),
            "download_url": download_url,
        })

        with _JOB_LOCK:
            _job["state"] = "done"
            _job["phase"] = "completed"
            _job["message"] = f"PdfCraft v{target_info.get('version', '0.8.0')} installed successfully."
            _job["finished_at"] = _now_iso()
    except Exception as exc:
        _log_line(f"Error during installation: {exc}")
        with _JOB_LOCK:
            _job["state"] = "error"
            _job["phase"] = "failed"
            _job["error"] = str(exc)
            _job["finished_at"] = _now_iso()


def _start_install_locked(target_info: Optional[dict] = None) -> dict:
    if _job["state"] == "running":
        return dict(_job)

    info = target_info or _latest.get("info") or dict(DEFAULT_RELEASE_INFO)

    _job["state"] = "running"
    _job["phase"] = "downloading"
    _job["message"] = f"Downloading PdfCraft {info.get('tag', 'v0.8.0')}..."
    _job["error"] = None
    _job["started_at"] = _now_iso()
    _job["finished_at"] = None
    _job["target"] = info

    t = threading.Thread(target=_install_worker, args=(info,), daemon=True)
    t.start()
    return dict(_job)


def start_install(force: bool = False, target_info: Optional[dict] = None) -> dict:
    with _JOB_LOCK:
        if _job["state"] == "running":
            return dict(_job)
        return _start_install_locked(target_info)


def status() -> dict:
    ensure_sample_doc()
    inst = get_installed()
    with _JOB_LOCK:
        if not inst and _job["state"] != "running":
            _start_install_locked()
        job_copy = dict(_job)

    with _latest_lock:
        latest_info = _latest.get("info")
        latest_ver = latest_info.get("version") if latest_info else None
        last_checked = _latest.get("checked_at", 0.0)

    # Automatically check official GitHub for bug fixes on launch in the background (TTL 30 min)
    if (time.time() - last_checked > LATEST_TTL_S) and _job["state"] != "running":
        threading.Thread(target=check_latest, kwargs={"force": False}, daemon=True).start()

    installed_ver = inst.get("version") if inst else None
    has_update = bool(installed_ver and latest_ver and installed_ver != latest_ver)

    try:
        from modules.artcraft import source_sync
        pdfcraft_item = next((r for r in source_sync.MANAGED_REPOS if r["id"] == "pdfcraft"), None)
        source_info = source_sync.get_repo_info(pdfcraft_item) if pdfcraft_item else None
    except Exception:
        source_info = None

    return {
        "installed": inst is not None,
        "installed_version": installed_ver,
        "latest_version": latest_ver,
        "has_update": has_update,
        "latest_info": latest_info,
        "source": source_info,
        "job": job_copy,
        "job_log": list(_job_log),
        "docs_count": len(list(DOCS_DIR.glob("*.pdf"))),
        "entry_url": ENTRY_URL,
    }
