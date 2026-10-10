"""DeepTutor manager for One EAD.

DeepTutor (Apache-2.0, https://github.com/HKUDS/DeepTutor) is an agent-native
tutoring workspace: a FastAPI backend plus a Next.js frontend, published by the
upstream project as the ``deeptutor`` PyPI package on every release. This module
keeps a private virtualenv (``data/venv``) on the newest published release,
runs upstream's own launcher from it (loopback only, see ``_serve.py``) and the
plugin page embeds the resulting web app. Nothing from upstream is copied into
this repository.

All user state (API keys, chats, knowledge bases, ...) lives in ``data/home``
and is untouched by updates.
"""

from __future__ import annotations

import atexit
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import threading
import time
import urllib.request
import uuid
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

TOOL_ID = "deep-tutor"
UPSTREAM_REPO = "HKUDS/DeepTutor"
PYPI_PACKAGE = "deeptutor"
PYTHON_SPEC = ">=3.11,<3.15"  # upstream's requires-python
_HERE = Path(__file__).resolve().parent
DATA_DIR = _HERE / "data"
VENV_DIR = DATA_DIR / "venv"
HOME_DIR = DATA_DIR / "home"
LOG_FILE = DATA_DIR / "service.log"
RUN_FILE = DATA_DIR / "run.json"
CONFIG_FILE = DATA_DIR / "config.json"
INSTALLED_FILE = DATA_DIR / "installed.json"
SERVE_SCRIPT = _HERE / "_serve.py"

LATEST_TTL_S = 30 * 60
DEFAULT_CONFIG = {"auto_update": True}
PREFERRED_PORTS = {"backend_port": 8001, "frontend_port": 3782}
LOOPBACK = "127.0.0.1"

_VERSION_RE = re.compile(r"^[0-9A-Za-z.!+_-]{1,40}$")
_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

_JOB_LOCK = threading.Lock()
_SVC_LOCK = threading.RLock()
_latest_lock = threading.Lock()
_latest: dict = {"info": None, "checked_at": 0.0, "error": None}
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
_svc_log: deque = deque(maxlen=120)
_proc: Optional[subprocess.Popen] = None
_adopted_pid: Optional[int] = None


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
    if isinstance(stored, dict) and isinstance(stored.get("auto_update"), bool):
        cfg["auto_update"] = stored["auto_update"]
    return cfg


def set_config(payload: dict) -> dict:
    cfg = get_config()
    if isinstance(payload.get("auto_update"), bool):
        cfg["auto_update"] = payload["auto_update"]
    _write_json(CONFIG_FILE, cfg)
    return cfg


def venv_python() -> Path:
    return VENV_DIR / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def _site_packages() -> Optional[Path]:
    if os.name == "nt":
        path = VENV_DIR / "Lib" / "site-packages"
        return path if path.is_dir() else None
    found = sorted((VENV_DIR / "lib").glob("python3.*/site-packages"))
    return found[0] if found else None


def installed_version() -> Optional[str]:
    """Version of the ``deeptutor`` distribution inside the private venv."""
    site = _site_packages()
    if site is None or not venv_python().exists():
        return None
    for dist in site.glob(f"{PYPI_PACKAGE}-*.dist-info"):
        return dist.name[len(PYPI_PACKAGE) + 1: -len(".dist-info")]
    return None


def get_installed() -> Optional[dict]:
    version = installed_version()
    if version is None:
        return None
    info = _read_json(INSTALLED_FILE, {})
    info = info if isinstance(info, dict) else {}
    return {"version": version, "label": f"v{version}", "installed_at": info.get("installed_at")}


# ---------------------------------------------------------------- upstream lookup

def _http_json(url: str, timeout: float = 10.0):
    req = urllib.request.Request(url, headers={"User-Agent": "one-ead-deep-tutor", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _resolve_latest() -> dict:
    data = _http_json(f"https://pypi.org/pypi/{PYPI_PACKAGE}/json")
    info = data["info"]
    version = info["version"]
    if not _VERSION_RE.match(version):
        raise ValueError("Unexpected version string from PyPI")
    return {"version": version, "label": f"v{version}", "requires_python": info.get("requires_python")}


def check_latest(force: bool = False) -> dict:
    """Look up the newest upstream release (cached)."""
    with _latest_lock:
        fresh = _latest["info"] is not None and time.time() - _latest["checked_at"] < LATEST_TTL_S
        if fresh and not force:
            return dict(_latest)
        try:
            _latest.update(info=_resolve_latest(), checked_at=time.time(), error=None)
        except Exception as exc:
            # Keep any previous result; only record the failure.
            _latest.update(checked_at=time.time(), error=f"{type(exc).__name__}: {exc}")
        return dict(_latest)


def _version_key(version: str) -> tuple:
    return tuple(int(p) if p.isdigit() else 0 for p in re.split(r"[.\-+]", version))


# ---------------------------------------------------------------- install job

def _log(line: str) -> None:
    line = _ANSI_RE.sub("", line).rstrip()
    if line:
        _job_log.append(line[:300])


def _set_phase(phase: str, message: str) -> None:
    _job["phase"] = phase
    _job["message"] = message
    _log(f"== {message}")


def _run(cmd: list, cwd: Optional[Path] = None, env: Optional[dict] = None) -> int:
    proc = subprocess.Popen(
        [str(c) for c in cmd],
        cwd=str(cwd) if cwd else None,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=_NO_WINDOW,
    )
    assert proc.stdout is not None
    for line in proc.stdout:
        _log(line)
    return proc.wait()


def _find_system_python() -> Optional[list]:
    """Command (argv prefix) of a system Python inside upstream's supported range."""
    candidates = []
    if shutil.which("py"):
        candidates += [["py", f"-3.{minor}"] for minor in (13, 12, 14, 11)]
    candidates += [["python"], ["python3"]]
    probe = "import sys;print(int((3,11)<=sys.version_info[:2]<(3,15)))"
    for cmd in candidates:
        if not shutil.which(cmd[0]):
            continue
        try:
            out = subprocess.run(cmd + ["-c", probe], capture_output=True, text=True, timeout=15,
                                 creationflags=_NO_WINDOW).stdout.strip()
        except Exception:
            continue
        if out == "1":
            return cmd
    return None


def _ensure_venv() -> None:
    if venv_python().exists():
        return
    uv = shutil.which("uv")
    shutil.rmtree(VENV_DIR, ignore_errors=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if uv:
        code = _run([uv, "venv", "--python", PYTHON_SPEC, "--seed", VENV_DIR])
    else:
        py = _find_system_python()
        if py is None:
            raise RuntimeError(
                "DeepTutor needs Python 3.11-3.14. Install uv (https://docs.astral.sh/uv/) or Python 3.12 and retry."
            )
        code = _run(py + ["-m", "venv", str(VENV_DIR)])
    if code != 0 or not venv_python().exists():
        raise RuntimeError(f"Could not create the Python environment (exit {code}); see log")


def _pip_install(version: str) -> int:
    spec = f"{PYPI_PACKAGE}=={version}"
    uv = shutil.which("uv")
    if uv:
        return _run([uv, "pip", "install", "--python", venv_python(), spec])
    return _run([venv_python(), "-m", "pip", "install", "--disable-pip-version-check", spec])


def _build(target: dict) -> None:
    version = target["version"]
    if not _VERSION_RE.match(version):
        raise RuntimeError("Invalid version from PyPI")
    previous = installed_version()

    _set_phase("env", "Preparing Python environment")
    _ensure_venv()

    _set_phase("install", f"Installing DeepTutor {target['label']} (downloads a few hundred MB on first run)")
    code = _pip_install(version)
    if code != 0:
        if previous:
            _log(f"Install failed, restoring {previous}")
            _pip_install(previous)
        raise RuntimeError(f"Installing deeptutor {version} failed (exit {code}); see log")

    if installed_version() != version:
        raise RuntimeError(f"Installed version mismatch (expected {version}, found {installed_version()})")
    _write_json(INSTALLED_FILE, {"version": version, "installed_at": _now_iso()})


def _job_main(target: dict) -> None:
    try:
        stop_service()  # Windows keeps loaded files locked while the app runs.
        _build(target)
        _job.update(state="done", phase="done", message="Up to date", error=None)
        _log("== Done")
    except Exception as exc:
        _job.update(state="error", phase="error", message="Install failed", error=f"{type(exc).__name__}: {exc}")
        _log(f"!! {exc}")
    finally:
        _job["finished_at"] = _now_iso()
        if is_installed():
            try:
                start_service()
            except Exception as exc:
                _log(f"!! could not start DeepTutor: {exc}")


def start_install(force: bool = False) -> dict:
    """Install/upgrade to the newest upstream release in the background (no-op if running)."""
    with _JOB_LOCK:
        if _job["state"] == "running":
            return status()
        latest = check_latest(force=True)
        if not latest["info"]:
            _job.update(state="error", phase="error", message="Cannot reach PyPI",
                        error=latest["error"] or "Unknown error", finished_at=_now_iso())
            return status()
        target = latest["info"]
        installed = installed_version()
        if installed and not force and installed == target["version"]:
            return status()
        _job_log.clear()
        _job.update(state="running", phase="check", message="Starting", error=None,
                    started_at=_now_iso(), finished_at=None, target=target["label"])
        threading.Thread(target=_job_main, args=(target,), name="deep-tutor-install", daemon=True).start()
    return status()


def is_installed() -> bool:
    return installed_version() is not None


# ---------------------------------------------------------------- service lifecycle

def _pid_alive(pid: Optional[int]) -> bool:
    if not pid:
        return False
    if os.name == "nt":
        try:
            out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"], capture_output=True,
                                 text=True, timeout=10, creationflags=_NO_WINDOW).stdout.lower()
        except Exception:
            return False
        return f'"{pid}"' in out and "python" in out
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _kill_tree(pid: int) -> None:
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, timeout=30,
                       creationflags=_NO_WINDOW)
    else:
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass


def _port_busy(port: int) -> bool:
    try:
        with socket.create_connection((LOOPBACK, port), timeout=0.3):
            return True
    except OSError:
        return False


def _free_port(preferred: int, taken: set) -> int:
    port = preferred
    for _ in range(50):
        if port not in taken and not _port_busy(port):
            return port
        port += 1
    with socket.socket() as s:
        s.bind((LOOPBACK, 0))
        return s.getsockname()[1]


def _settings_file() -> Path:
    return HOME_DIR / "data" / "user" / "settings" / "system.json"


def _ports() -> dict:
    cfg = _read_json(_settings_file(), {})
    cfg = cfg if isinstance(cfg, dict) else {}
    return {k: int(cfg.get(k) or v) for k, v in PREFERRED_PORTS.items()}


def _ensure_ports() -> dict:
    """Make sure the configured ports are free; move them (in upstream's own settings file) if not."""
    if not _settings_file().exists():
        exe = VENV_DIR / ("Scripts/deeptutor.exe" if os.name == "nt" else "bin/deeptutor")
        HOME_DIR.mkdir(parents=True, exist_ok=True)
        subprocess.run([str(exe), "init", "--non-interactive", "--home", str(HOME_DIR)], capture_output=True,
                       timeout=180, creationflags=_NO_WINDOW)
    ports = _ports()
    chosen: dict = {}
    taken: set = set()
    for key in ("backend_port", "frontend_port"):
        chosen[key] = _free_port(ports[key], taken)
        taken.add(chosen[key])
    if chosen != ports:
        cfg = _read_json(_settings_file(), {})
        cfg = cfg if isinstance(cfg, dict) else {}
        cfg.update(chosen)
        _write_json(_settings_file(), cfg)
    return chosen


def _pump(proc: subprocess.Popen) -> None:
    assert proc.stdout is not None
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if LOG_FILE.exists() and LOG_FILE.stat().st_size > 2 * 1024 * 1024:
        LOG_FILE.write_bytes(LOG_FILE.read_bytes()[-512 * 1024:])
    with open(LOG_FILE, "a", encoding="utf-8", errors="replace") as fh:
        fh.write(f"\n--- {_now_iso()} start ---\n")
        for line in proc.stdout:
            clean = _ANSI_RE.sub("", line).rstrip()
            if clean:
                _svc_log.append(clean[:300])
                fh.write(clean + "\n")
                fh.flush()


def service_alive() -> bool:
    global _adopted_pid
    if _proc is not None and _proc.poll() is None:
        return True
    if _adopted_pid is not None:
        if _pid_alive(_adopted_pid):
            return True
        _adopted_pid = None
    return False


def start_service() -> dict:
    global _proc, _adopted_pid
    with _SVC_LOCK:
        if service_alive():
            return status()
        if not is_installed():
            raise RuntimeError("DeepTutor is not installed yet")

        # A previous One EAD process may have died without stopping its child.
        # Adopt it only if its web app answers, so a recycled PID is never mistaken for it.
        saved = _read_json(RUN_FILE, {})
        if (isinstance(saved, dict) and _pid_alive(saved.get("pid"))
                and _frontend_ready(int(saved.get("frontend_port") or 0))):
            _adopted_pid = int(saved["pid"])
            return status()

        ports = _ensure_ports()
        env = dict(os.environ)
        env.update(
            PYTHONUNBUFFERED="1",
            PYTHONIOENCODING="utf-8:replace",
            DEEPTUTOR_BACKEND_READY_TIMEOUT="600",  # first start after an install is slow on Windows
        )
        flags = _NO_WINDOW | (getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) if os.name == "nt" else 0)
        _svc_log.clear()
        HOME_DIR.mkdir(parents=True, exist_ok=True)
        _proc = subprocess.Popen(
            [str(venv_python()), "-X", "utf8", str(SERVE_SCRIPT), str(HOME_DIR)],
            cwd=str(DATA_DIR),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=flags,
        )
        _write_json(RUN_FILE, {"pid": _proc.pid, **ports, "started_at": _now_iso()})
        threading.Thread(target=_pump, args=(_proc,), name="deep-tutor-log", daemon=True).start()
    return status()


def stop_service() -> dict:
    global _proc, _adopted_pid
    with _SVC_LOCK:
        proc, pid = _proc, _adopted_pid
        if proc is not None and proc.poll() is None:
            try:
                if os.name == "nt":
                    proc.send_signal(signal.CTRL_BREAK_EVENT)  # lets upstream stop backend + frontend cleanly
                else:
                    proc.send_signal(signal.SIGTERM)
                proc.wait(timeout=20)
            except Exception:
                pass
            if proc.poll() is None:
                _kill_tree(proc.pid)
        elif pid is not None and _pid_alive(pid):
            _kill_tree(pid)
        _proc = None
        _adopted_pid = None
        RUN_FILE.unlink(missing_ok=True)
    return status()


def restart_service() -> dict:
    stop_service()
    return start_service()


atexit.register(stop_service)


# ---------------------------------------------------------------- status

def _frontend_ready(port: int) -> bool:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(f"http://{LOOPBACK}:{port}/", timeout=0.8):
            return True
    except Exception:
        return False


def status() -> dict:
    cfg = get_config()
    installed = get_installed()
    with _latest_lock:
        info = _latest["info"]
        latest_checked_at, latest_error = _latest["checked_at"], _latest["error"]
    alive = service_alive()
    ports = _ports()
    ready = alive and _frontend_ready(ports["frontend_port"])
    update_available = bool(
        info and installed and _version_key(info["version"]) > _version_key(installed["version"])
    )
    return {
        "installed": installed is not None,
        "version": installed,
        "latest": info,
        "latest_checked_at": latest_checked_at,
        "latest_error": latest_error,
        "update_available": update_available,
        "config": cfg,
        "job": {**_job, "log": list(_job_log)[-60:]},
        "service": {"running": alive, "ready": ready, "log": list(_svc_log)[-40:], **ports},
        "uv_available": bool(shutil.which("uv")),
        "node_available": bool(shutil.which("node")),
        "home": str(HOME_DIR),
        "url": f"http://{LOOPBACK}:{ports['frontend_port']}/",
        "ready": ready,
        "running": _job["state"] == "running",
    }
