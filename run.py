"""Launch the One EAD portal.

Starts the local FastAPI server with Uvicorn and opens the portal in the default
browser. Everything is served from localhost; no internet is required at runtime.

    python run.py            # start on http://127.0.0.1:8100
    python run.py --port 9000
    python run.py --no-browser
"""

from __future__ import annotations

import argparse
import os
import shutil
import socket
import subprocess
import sys
import threading
import webbrowser
from typing import Optional

# Allow launching by file path (python run.py) or from another cwd: ensure this
# file's own directory (the workspace root, containing server/ and modules/) is
# importable.
_ROOT = os.path.dirname(os.path.abspath(__file__))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

try:
    from server.check_deps import ensure_dependencies

    if not ensure_dependencies():
        print("[One EAD] Missing required dependencies. Exiting.")
        sys.exit(1)
except ImportError:
    pass

import uvicorn



def _find_chrome_path() -> Optional[str]:
    """Locate Google Chrome installation path on Windows / system."""
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%PROGRAMFILES%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%PROGRAMFILES(X86)%\Google\Chrome\Application\chrome.exe"),
        shutil.which("chrome"),
        shutil.which("google-chrome"),
    ]
    for c in candidates:
        if c and os.path.isfile(c):
            return c
    return None


def _launch_browser(url: str) -> None:
    """Open url in Google Chrome if installed, otherwise fallback to system default."""
    chrome = _find_chrome_path()
    if chrome:
        try:
            subprocess.Popen([chrome, url])
            return
        except Exception:
            pass
    webbrowser.open(url)


def _open_browser(url: str, delay: float = 1.2) -> None:
    threading.Timer(delay, lambda: _launch_browser(url)).start()


import time


def _find_pid_on_port(port: int) -> Optional[int]:
    """Find the PID of the process listening on the given port (Windows / Unix)."""
    try:
        if sys.platform == "win32":
            out = subprocess.check_output(f"netstat -ano | findstr :{port}", shell=True, text=True)
            for line in out.strip().splitlines():
                parts = line.split()
                if len(parts) >= 5 and "LISTENING" in parts:
                    return int(parts[-1])
        else:
            out = subprocess.check_output(["lsof", "-t", f"-i:{port}"], text=True)
            pids = out.strip().split()
            if pids:
                return int(pids[0])
    except Exception:
        pass
    return None


def _kill_pid(pid: int) -> bool:
    """Terminate a process by PID."""
    try:
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/PID", str(pid), "/F"], capture_output=True, check=True)
        else:
            os.kill(pid, 9)
        return True
    except Exception:
        return False


def _port_in_use(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex((host, port)) == 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the One EAD portal.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8100)
    parser.add_argument("--no-browser", action="store_true", help="Do not open a browser window.")
    parser.add_argument("--reload", action="store_true", help="Auto-reload on code changes (development).")
    parser.add_argument("--restart", action="store_true", help="Restart server if an instance is already running.")
    args = parser.parse_args()

    url = f"http://{args.host}:{args.port}/"

    # If the port is already in use by an existing instance, terminate it so that
    # any new git pull changes, updated plugins, and dependencies are loaded fresh.
    was_busy = _port_in_use(args.host, args.port)
    if was_busy:
        pid = _find_pid_on_port(args.port)
        if pid:
            print(f"[One EAD] Releasing port {args.port} (terminating previous instance PID {pid})...")
            _kill_pid(pid)
            time.sleep(1.0)
        else:
            print(f"[One EAD] Port {args.port} is busy, attempting to start...")

    # Cleanly ensure WeKnora Lite service on port 8082 is active with latest configs.
    # When restarting One EAD, restart WeKnora as well so both services remain in sync.
    try:
        from modules.weknora import manager as weknora_manager
        if args.restart or was_busy:
            print("[One EAD] Ensuring WeKnora Lite service is freshly synchronized...")
            weknora_manager.restart_service()
        else:
            weknora_manager.start_service()
    except Exception as exc:
        print(f"[One EAD] Note: Could not auto-start WeKnora Lite: {exc}")

    # Fetch local persistent portal authentication token
    from server.security import get_portal_token
    token = get_portal_token()
    launch_url = f"http://{args.host}:{args.port}/?auth={token}"

    print(f"One EAD -> {url}")
    if not args.no_browser:
        _open_browser(launch_url)

    if args.reload:
        # Reload needs an import string so the worker subprocess can re-import.
        uvicorn.run("server.app:app", host=args.host, port=args.port, reload=True)
    else:
        # Import the app object directly so a fresh module scan runs every start.
        from server.app import create_app

        uvicorn.run(create_app(), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
