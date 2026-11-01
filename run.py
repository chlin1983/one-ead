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

    if not ensure_dependencies(install_missing=False):
        print("[One EAD] Missing or unverified dependencies. Please run 'python server/check_deps.py --install' first. Exiting.")
        sys.exit(1)
except ImportError as exc:
    print(f"[One EAD] CRITICAL: Failed to load dependency verification module: {exc}. Exiting.")
    sys.exit(1)

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
    """Find the PID of the process listening on the given port without shell execution."""
    try:
        if sys.platform == "win32":
            res = subprocess.run(["netstat", "-ano"], capture_output=True, text=True, check=False)
            if res.returncode == 0:
                target_suffix = f":{port}"
                for line in res.stdout.splitlines():
                    parts = line.strip().split()
                    if len(parts) >= 5 and parts[0].upper() == "TCP":
                        local_addr = parts[1]
                        state = parts[3].upper()
                        if state == "LISTENING":
                            addr_port = local_addr.rsplit(":", 1)[-1] if ":" in local_addr else ""
                            if addr_port == str(port) or local_addr.endswith(target_suffix):
                                try:
                                    return int(parts[4])
                                except ValueError:
                                    pass
        else:
            res = subprocess.run(["lsof", "-t", f"-i:{port}"], capture_output=True, text=True, check=False)
            if res.returncode == 0:
                pids = res.stdout.strip().split()
                if pids:
                    return int(pids[0])
    except Exception:
        pass
    return None


def _is_expected_one_ead_process(pid: int) -> bool:
    """Verifies that the target PID belongs to a Python / One EAD process before termination."""
    if not pid or pid <= 0:
        return False
    try:
        if sys.platform == "win32":
            ps_cmd = (
                f'Get-CimInstance Win32_Process -Filter "ProcessId = {pid}" '
                f'| Select-Object -Property ExecutablePath, CommandLine | ConvertTo-Json -Compress'
            )
            res = subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_cmd],
                capture_output=True,
                text=True,
                check=False,
                timeout=5,
            )
            if res.returncode == 0 and res.stdout.strip():
                import json
                info = json.loads(res.stdout.strip())
                exe = str(info.get("ExecutablePath") or "").lower()
                cmd = str(info.get("CommandLine") or "").lower()
                is_python = "python" in exe
                is_one_ead = any(term in cmd for term in ("run.py", "server.app", "uvicorn", "one-ead", "one_ead"))
                return is_python and (is_one_ead or "uvicorn" in exe)
            return False
        else:
            cmdline_path = Path(f"/proc/{pid}/cmdline")
            if cmdline_path.exists():
                cmdline = cmdline_path.read_text(errors="replace").lower()
                return "python" in cmdline and any(term in cmdline for term in ("run.py", "server.app", "uvicorn", "one-ead"))
            return False
    except Exception:
        return False


def _kill_pid(pid: int) -> bool:
    """Terminate a process by PID strictly after verifying its identity as One EAD."""
    if not _is_expected_one_ead_process(pid):
        print(f"[One EAD] Refusing to terminate unverified process (PID {pid}) on port.")
        return False
    try:
        if sys.platform == "win32":
            res = subprocess.run(["taskkill", "/PID", str(pid), "/F"], capture_output=True, check=False)
            return res.returncode == 0
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

    # Create single-use exchange ticket so persistent token is NEVER exposed in URL or history
    from server.security import create_login_ticket, install_credential_redacting_logger
    install_credential_redacting_logger()
    ticket = create_login_ticket()
    launch_url = f"http://{args.host}:{args.port}/auth/verify?ticket={ticket}"

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
