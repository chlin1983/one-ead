"""Chili3D manager for One EAD.

Chili3D (AGPL-3.0, https://github.com/xiangechen/chili3d) is a browser-based
3D CAD built on OpenCascade/WebAssembly. Upstream publishes source only, so this
module downloads the newest source from GitHub, builds it locally with Node.js
and serves the result from ``web/app``. The previous build keeps working until a
new one has been built successfully.

Works are persisted twice: Chili3D's own IndexedDB (browser) and a disk mirror
under ``data/store`` (see ``web/persist.js``) so they survive origin/port
changes and cleared browser data.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.request
import uuid
import zipfile
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import quote, unquote

TOOL_ID = "chili3d"
UPSTREAM = "xiangechen/chili3d"
_HERE = Path(__file__).resolve().parent
DATA_DIR = _HERE / "data"
STORE_DIR = DATA_DIR / "store"
TRASH_DIR = STORE_DIR / "_trash"
WORK_DIR = DATA_DIR / "work"
CONFIG_FILE = DATA_DIR / "config.json"
INSTALLED_FILE = DATA_DIR / "installed.json"
APP_DIR = _HERE / "web" / "app"
ENTRY_URL = "/modules/chili3d/"

LATEST_TTL_S = 30 * 60
MAX_STORE_BYTES = 256 * 1024 * 1024
DEFAULT_CONFIG = {"channel": "release", "auto_update": True}
CHANNELS = ("release", "main")

_TABLE_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_REF_RE = re.compile(r"^[A-Za-z0-9._+\-/]{1,100}$")
_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
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
        if stored.get("channel") in CHANNELS:
            cfg["channel"] = stored["channel"]
        if isinstance(stored.get("auto_update"), bool):
            cfg["auto_update"] = stored["auto_update"]
    return cfg


def set_config(payload: dict) -> dict:
    cfg = get_config()
    if payload.get("channel") in CHANNELS:
        cfg["channel"] = payload["channel"]
    if isinstance(payload.get("auto_update"), bool):
        cfg["auto_update"] = payload["auto_update"]
    _write_json(CONFIG_FILE, cfg)
    return cfg


def get_installed() -> Optional[dict]:
    if not (APP_DIR / "index.html").exists():
        return None
    info = _read_json(INSTALLED_FILE, None)
    return info if isinstance(info, dict) else {"version": "unknown", "ref": None, "label": "unknown"}


def is_installed() -> bool:
    return (APP_DIR / "index.html").exists()


# ---------------------------------------------------------------- upstream lookup

def _http_json(url: str, timeout: float = 10.0):
    req = urllib.request.Request(
        url, headers={"User-Agent": "one-ead-chili3d", "Accept": "application/vnd.github+json"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _resolve_latest(channel: str) -> dict:
    if channel == "main":
        data = _http_json(f"https://api.github.com/repos/{UPSTREAM}/commits/main")
        sha = data["sha"]
        return {"channel": "main", "ref": sha, "label": f"main@{sha[:7]}", "kind": "sha"}
    data = _http_json(f"https://api.github.com/repos/{UPSTREAM}/releases/latest")
    tag = data["tag_name"]
    return {"channel": "release", "ref": tag, "label": tag, "kind": "tag"}


def check_latest(force: bool = False) -> dict:
    """Look up the newest upstream version for the configured channel (cached)."""
    channel = get_config()["channel"]
    with _latest_lock:
        fresh = (
            _latest["channel"] == channel
            and _latest["info"] is not None
            and time.time() - _latest["checked_at"] < LATEST_TTL_S
        )
        if fresh and not force:
            return dict(_latest)
        try:
            info = _resolve_latest(channel)
            _latest.update(channel=channel, info=info, checked_at=time.time(), error=None)
        except Exception as exc:
            # Keep any previous result for this channel; only record the failure.
            if _latest["channel"] != channel:
                _latest.update(channel=channel, info=None)
            _latest.update(checked_at=time.time(), error=f"{type(exc).__name__}: {exc}")
        return dict(_latest)


# ---------------------------------------------------------------- build job

def _log(line: str) -> None:
    line = _ANSI_RE.sub("", line).rstrip()
    if line:
        _job_log.append(line[:300])


def _set_phase(phase: str, message: str) -> None:
    _job["phase"] = phase
    _job["message"] = message
    _log(f"== {message}")


def _run(cmd: list, cwd: Path, env: dict) -> int:
    proc = subprocess.Popen(
        cmd,
        cwd=str(cwd),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    assert proc.stdout is not None
    for line in proc.stdout:
        _log(line)
    return proc.wait()


def _download(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "one-ead-chili3d"})
    with urllib.request.urlopen(req, timeout=30) as resp, open(dest, "wb") as out:
        total = int(resp.headers.get("Content-Length") or 0)
        done = 0
        last = 0.0
        while True:
            chunk = resp.read(256 * 1024)
            if not chunk:
                break
            out.write(chunk)
            done += len(chunk)
            if done > 400 * 1024 * 1024:
                raise RuntimeError("Source archive unexpectedly large")
            if time.time() - last > 0.5:
                last = time.time()
                size = f"{done / 1e6:.1f}" + (f" / {total / 1e6:.1f}" if total else "")
                _job["message"] = f"Downloading source ({size} MB)"


def _extract(zip_path: Path, dest: Path) -> Path:
    dest.mkdir(parents=True, exist_ok=True)
    root = dest.resolve()
    with zipfile.ZipFile(zip_path) as zf:
        for member in zf.infolist():
            target = (dest / member.filename).resolve()
            if root != target and root not in target.parents:
                raise RuntimeError(f"Unsafe path in archive: {member.filename}")
        zf.extractall(dest)
    roots = [p for p in dest.iterdir() if p.is_dir()]
    if len(roots) != 1:
        raise RuntimeError("Unexpected archive layout")
    return roots[0]


def _patch_untitled(dist: Path) -> int:
    """Upstream names new documents `undefined N` (literal); use `Untitled N` via persist.js numbering."""
    pattern = re.compile(r"`undefined \$\{(\w+)\+\+\}`")
    patched = 0
    for js in dist.glob("*.js"):
        text = js.read_text(encoding="utf-8")
        new, count = pattern.subn(
            lambda m: "`Untitled ${window.__oeNextUntitled?window.__oeNextUntitled():" + m.group(1) + "++}`", text)
        if count:
            js.write_text(new, encoding="utf-8")
            patched += count
    return patched


def _finalize_dist(dist: Path) -> None:
    """Strip telemetry/community content and hook in disk persistence."""
    index = dist / "index.html"
    if not index.exists():
        raise RuntimeError("Build produced no index.html")
    html = index.read_text(encoding="utf-8")

    # Remove Microsoft Clarity analytics (also an offline-hang risk).
    html = re.sub(r"<script(?![^>]*\bsrc=)[^>]*>(?:(?!</script>).)*clarity\.ms(?:(?!</script>).)*</script>",
                  "", html, flags=re.S | re.I)

    # Pull out app scripts so persist.js can restore the disk backup before they run.
    scripts = []

    def _grab(m: re.Match) -> str:
        attrs = m.group(0)
        src = re.search(r"\bsrc=[\"']([^\"']+)[\"']", attrs)
        if src and not re.match(r"^(https?:)?//", src.group(1)):
            scripts.append({"src": src.group(1), "module": bool(re.search(r"type=[\"']module[\"']", attrs))})
            return ""
        return attrs

    html = re.sub(r"<script\b[^>]*>\s*</script>", _grab, html, flags=re.I)
    if not scripts:
        raise RuntimeError("No application script found in built index.html")
    if "</head>" not in html:
        raise RuntimeError("Built index.html has no </head>")

    payload = json.dumps(scripts).replace("<", "\\u003c")
    hook = (
        f'<script id="oneead-app-scripts" type="application/json">{payload}</script>'
        f'<script src="/modules/chili3d/persist.js"></script>'
    )
    html = html.replace("</head>", hook + "</head>", 1)
    index.write_text(html, encoding="utf-8")

    # Empty community-video feed -> the home page hides the whole column.
    (dist / "videos.json").write_text(
        json.dumps({"recent": {"items": []}, "cases": {"items": []}}), encoding="utf-8"
    )
    _log(f"Patched {_patch_untitled(dist)} untitled-name site(s)")


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


def _build(target: dict) -> None:
    node, npm = shutil.which("node"), shutil.which("npm")
    if not node or not npm:
        raise RuntimeError("Node.js and npm are required to build Chili3D (install Node.js 20+).")

    shutil.rmtree(WORK_DIR, ignore_errors=True)
    WORK_DIR.mkdir(parents=True, exist_ok=True)

    ref = target["ref"]
    if target["kind"] == "tag":
        if not _REF_RE.match(ref):
            raise RuntimeError("Invalid release tag from GitHub")
        url = f"https://codeload.github.com/{UPSTREAM}/zip/refs/tags/{ref}"
    else:
        if not _SHA_RE.match(ref):
            raise RuntimeError("Invalid commit id from GitHub")
        url = f"https://codeload.github.com/{UPSTREAM}/zip/{ref}"

    _set_phase("download", "Downloading source")
    zip_path = WORK_DIR / "source.zip"
    _download(url, zip_path)

    _set_phase("extract", "Extracting source")
    src = _extract(zip_path, WORK_DIR / "src")
    zip_path.unlink(missing_ok=True)

    env = dict(os.environ)
    env.update(npm_config_fund="false", npm_config_audit="false", npm_config_update_notifier="false")
    env.pop("NODE_ENV", None)  # devDependencies are required for the build

    _set_phase("install", "Installing dependencies (npm)")
    has_lock = (src / "package-lock.json").exists()
    code = _run([npm, "ci" if has_lock else "install"], src, env)
    if code != 0 and has_lock:
        _log("npm ci failed, retrying with npm install")
        code = _run([npm, "install"], src, env)
    if code != 0:
        raise RuntimeError(f"npm install failed (exit {code}); see log")

    _set_phase("build", "Building Chili3D")
    env["NODE_ENV"] = "production"
    code = _run([npm, "run", "build"], src, env)
    if code != 0:
        raise RuntimeError(f"npm run build failed (exit {code}); see log")

    dist = src / "dist"
    _set_phase("finalize", "Finalizing")
    _finalize_dist(dist)

    pkg = _read_json(src / "package.json", {})
    version = pkg.get("version", "unknown") if isinstance(pkg, dict) else "unknown"
    _swap_into_place(dist)
    _write_json(
        INSTALLED_FILE,
        {
            "version": version,
            "ref": target["ref"],
            "label": target["label"],
            "channel": target["channel"],
            "built_at": _now_iso(),
        },
    )


def _job_main(target: dict) -> None:
    try:
        _build(target)
        _job.update(state="done", phase="done", message="Up to date", error=None)
        _log("== Done")
    except Exception as exc:
        _job.update(state="error", phase="error", message="Build failed", error=f"{type(exc).__name__}: {exc}")
        _log(f"!! {exc}")
    finally:
        _job["finished_at"] = _now_iso()
        shutil.rmtree(WORK_DIR, ignore_errors=True)


def start_install(force: bool = False) -> dict:
    """Build the newest upstream version in the background (no-op if running)."""
    with _JOB_LOCK:
        if _job["state"] == "running":
            return status()
        latest = check_latest(force=True)
        if not latest["info"]:
            _job.update(state="error", phase="error", message="Cannot reach GitHub",
                        error=latest["error"] or "Unknown error", finished_at=_now_iso())
            return status()
        target = latest["info"]
        installed = get_installed()
        if installed and not force and installed.get("ref") == target["ref"] and installed.get("channel") == target["channel"]:
            return status()
        _job_log.clear()
        _job.update(state="running", phase="check", message="Starting", error=None,
                    started_at=_now_iso(), finished_at=None, target=target["label"])
        threading.Thread(target=_job_main, args=(target,), name="chili3d-build", daemon=True).start()
    return status()


def status() -> dict:
    cfg = get_config()
    installed = get_installed()
    with _latest_lock:
        latest = dict(_latest) if _latest["channel"] == cfg["channel"] else {"info": None, "checked_at": 0.0, "error": None}
    info = latest.get("info")
    update_available = bool(
        info
        and installed
        and (installed.get("ref") != info["ref"] or installed.get("channel") != info["channel"])
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
        "node_available": bool(shutil.which("node") and shutil.which("npm")),
        "store": store_summary(),
        "entry_url": ENTRY_URL,
        "url": ENTRY_URL,
        "ready": installed is not None,
        "running": _job["state"] == "running",
    }


def launch() -> dict:
    STORE_DIR.mkdir(parents=True, exist_ok=True)
    return status()


# ---------------------------------------------------------------- disk store (works)

def _table_dir(table: str) -> Path:
    if not _TABLE_RE.match(table) or table.startswith("_"):
        raise ValueError("Invalid table name")
    return STORE_DIR / table


def _item_path(table: str, item_id: str) -> Path:
    if not item_id or len(item_id) > 400:
        raise ValueError("Invalid id")
    return _table_dir(table) / (quote(item_id, safe="") + ".json")


def store_put(table: str, item_id: str, body: bytes) -> dict:
    if len(body) > MAX_STORE_BYTES:
        raise ValueError("Item too large")
    json.loads(body)  # reject garbage so the backup is always restorable
    path = _item_path(table, item_id)
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
    return {"status": "ok"}


def store_get(table: str, item_id: str) -> Optional[bytes]:
    path = _item_path(table, item_id)
    with _IO_LOCK:
        return path.read_bytes() if path.exists() else None


def store_delete(table: str, item_id: str) -> dict:
    """Move to trash instead of erasing so an accidental delete is recoverable."""
    path = _item_path(table, item_id)
    with _IO_LOCK:
        if not path.exists():
            return {"status": "missing"}
        dest_dir = TRASH_DIR / table
        dest_dir.mkdir(parents=True, exist_ok=True)
        shutil.move(str(path), str(dest_dir / f"{path.stem}.{int(time.time())}.json"))
    return {"status": "trashed"}


def store_index() -> dict:
    """Per-table listing; ``recents`` entries carry their ``date`` for conflict checks."""
    tables: dict = {}
    with _IO_LOCK:
        if not STORE_DIR.exists():
            return {"tables": tables}
        for tdir in STORE_DIR.iterdir():
            if not tdir.is_dir() or tdir.name.startswith("_") or not _TABLE_RE.match(tdir.name):
                continue
            items = []
            for p in tdir.glob("*.json"):
                entry = {"id": unquote(p.stem), "mtime": p.stat().st_mtime}
                if tdir.name == "recents":
                    try:
                        entry["date"] = json.loads(p.read_text(encoding="utf-8")).get("date", 0)
                    except Exception:
                        entry["date"] = 0
                items.append(entry)
            tables[tdir.name] = items
    return {"tables": tables}


def store_summary() -> dict:
    with _IO_LOCK:
        d = STORE_DIR / "documents"
        count = len(list(d.glob("*.json"))) if d.exists() else 0
    return {"documents": count, "path": str(STORE_DIR)}
