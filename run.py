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
    args = parser.parse_args()

    url = f"http://{args.host}:{args.port}/"

    # A server is already running on this port: don't fail with a bind error —
    # just open the browser to the existing instance.
    if _port_in_use(args.host, args.port):
        print(f"One EAD is already running -> {url} (opening browser in Google Chrome)")
        if not args.no_browser:
            _launch_browser(url)
        return

    print(f"One EAD -> {url}")
    if not args.no_browser:
        _open_browser(url)

    if args.reload:
        # Reload needs an import string so the worker subprocess can re-import.
        uvicorn.run("server.app:app", host=args.host, port=args.port, reload=True)
    else:
        # Import the app object directly so a fresh module scan runs every start.
        from server.app import create_app

        uvicorn.run(create_app(), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
