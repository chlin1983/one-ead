"""PDF Arranger manager: portable Windows GTK3 app streamed to browser via Broadway.

PDF Arranger (GPL-3.0) is a native GTK3 tool. It runs with GTK's Broadway backend:
a lightweight local daemon (vendor/broadwayd.exe) streams the interface over WebSockets
to the browser. Everything remains 100% offline on 127.0.0.1.
"""

from __future__ import annotations

import atexit
import configparser
import hashlib
import os
import shutil
import socket
import subprocess
import threading
import time
import urllib.request
import zipfile
from pathlib import Path
from typing import Optional

from modules.pdfarranger import winfocus

TOOL_ID = "pdfarranger"
VERSION = "1.14.0"
ZIP_URL = f"https://github.com/pdfarranger/pdfarranger/releases/download/{VERSION}/pdfarranger-{VERSION}-windows-portable.zip"
ZIP_SHA256 = "71bb8c7d3e9bd1713424ec546681f4cf4d50961020607e1c154ade67ea532615"

HTTP_PORT = 8185
# Broadway display ":tcp5" makes the app connect on 127.0.0.1:9095
DISPLAY = ":tcp5"

_HERE = Path(__file__).resolve().parent
APP_DIR = _HERE / "pdfarranger"
STAGING_DIR = _HERE / ".pdfarranger-setup"
BROADWAYD = _HERE / "vendor" / "broadwayd.exe"

_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

_lock = threading.Lock()
_broadway: Optional[subprocess.Popen] = None
_app: Optional[subprocess.Popen] = None
_install = {"active": False, "percent": 0, "message": "", "error": ""}


def find_exe() -> Optional[Path]:
    exe = APP_DIR / "pdfarranger.exe"
    return exe if exe.exists() else None


def _port_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return True
    except OSError:
        return False


def _alive(proc: Optional[subprocess.Popen]) -> bool:
    return proc is not None and proc.poll() is None


def status() -> dict:
    with _lock:
        inst = dict(_install)
    return {
        "id": TOOL_ID,
        "installed": find_exe() is not None,
        "install": inst,
        "running": _alive(_app),
        "ready": _port_open(HTTP_PORT),
        "url": f"http://127.0.0.1:{HTTP_PORT}/",
    }


def _set(**kw) -> None:
    with _lock:
        _install.update(kw)


def _install_worker() -> None:
    zip_path = STAGING_DIR / "pdfarranger.zip"
    try:
        STAGING_DIR.mkdir(parents=True, exist_ok=True)
        part = zip_path.with_suffix(".part")
        digest = hashlib.sha256()
        req = urllib.request.Request(ZIP_URL, headers={"User-Agent": "one-ead-pdfarranger"})
        with urllib.request.urlopen(req, timeout=60) as resp, open(part, "wb") as fh:
            total = int(resp.headers.get("Content-Length") or 0)
            done = 0
            while True:
                chunk = resp.read(1024 * 1024)
                if not chunk:
                    break
                fh.write(chunk)
                digest.update(chunk)
                done += len(chunk)
                _set(percent=int(done * 100 / total) if total else 0, message=f"Downloading: {done // (1024 * 1024)} MB")
        if digest.hexdigest() != ZIP_SHA256:
            part.unlink(missing_ok=True)
            raise RuntimeError("Downloaded file failed its integrity check")
        part.replace(zip_path)

        _set(percent=100, message="Extracting")
        extracted = STAGING_DIR / "extracted"
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(extracted)
        found = next(extracted.glob("**/pdfarranger.exe"), None)
        if found is None:
            raise RuntimeError("pdfarranger.exe not found in the downloaded package")
        saved_config = None
        if APP_DIR.exists():
            if (APP_DIR / "config.ini").exists():
                saved_config = (APP_DIR / "config.ini").read_bytes()
            shutil.rmtree(APP_DIR)
        shutil.move(str(found.parent), str(APP_DIR))
        if saved_config:
            (APP_DIR / "config.ini").write_bytes(saved_config)
        _apply_overrides()
        _set(active=False, message="Ready")
    except Exception as exc:
        _set(active=False, error=str(exc), message="")
    finally:
        shutil.rmtree(STAGING_DIR, ignore_errors=True)


def start_install() -> dict:
    with _lock:
        begin = not _install["active"]
        if begin:
            _install.update(active=True, percent=0, message="Starting", error="")
    if begin:
        threading.Thread(target=_install_worker, daemon=True).start()
    return status()


def _env(exe: Path) -> dict:
    env = os.environ.copy()
    env["PATH"] = os.pathsep.join([str(exe.parent), str(exe.parent / "lib"), env.get("PATH", "")])
    return env


def _prepare_config(exe: Path) -> None:
    """Start maximized and skip content loss warnings."""
    path = exe.parent / "config.ini"
    cfg = configparser.ConfigParser()
    cfg.read(path)
    for section in ("window", "preferences"):
        if not cfg.has_section(section):
            cfg.add_section(section)
    cfg.set("window", "maximized", "True")
    cfg.set("preferences", "content-loss-warning", "False")
    with open(path, "w") as fh:
        cfg.write(fh)


def _apply_overrides() -> None:
    overrides_dir = _HERE / "overrides"
    if overrides_dir.exists() and APP_DIR.exists():
        for root, _, files in os.walk(overrides_dir):
            rel_dir = Path(root).relative_to(overrides_dir)
            target_dir = APP_DIR / rel_dir
            target_dir.mkdir(parents=True, exist_ok=True)
            for f in files:
                shutil.copy2(Path(root) / f, target_dir / f)


def launch() -> dict:
    """Start Broadway server and PDF Arranger."""
    global _broadway, _app
    _apply_overrides()
    exe = find_exe()
    if exe is None or not BROADWAYD.exists():
        return status()
    env = _env(exe)

    if not _port_open(HTTP_PORT) and not _alive(_broadway):
        _broadway = subprocess.Popen(
            [str(BROADWAYD), "-a", "127.0.0.1", "-p", str(HTTP_PORT), DISPLAY],
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=_NO_WINDOW,
        )
        for _ in range(40):
            if _port_open(HTTP_PORT):
                break
            threading.Event().wait(0.1)

    if not _alive(_app):
        _prepare_config(exe)
        app_env = {**env, "GDK_BACKEND": "broadway", "BROADWAY_DISPLAY": DISPLAY}
        si = subprocess.STARTUPINFO()
        si.lpDesktop = r"WinSta0\Default"

        log_path = _HERE / "runtime.log"
        log_file = open(log_path, "a", encoding="utf-8")

        _app = subprocess.Popen(
            [str(exe)],
            cwd=str(exe.parent),
            env=app_env,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            startupinfo=si,
        )
        threading.Thread(target=winfocus.watch, args=(_app,), daemon=True).start()
    return status()


def stop() -> dict:
    global _app, _broadway
    for proc in (_app, _broadway):
        if _alive(proc):
            try:
                proc.terminate()
            except Exception:
                pass
    return status()


def restart() -> dict:
    stop()
    time.sleep(0.5)
    return launch()


atexit.register(stop)
