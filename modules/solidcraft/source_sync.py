"""Source Code Synchronization & Upstream Git Manager for SolidCraft.

Handles:
1. Checking official upstream (tangency-labs/solidcraft) for latest commits & bug fixes.
2. Fast-forward git pulling to stay up to date.
3. Syncing changes to the user's GitHub fork (chlin1983/solidcraft).
4. Exposing commit metadata and source status to the One EAD SolidCraft plugin.
"""

from __future__ import annotations

import json
import os
import subprocess
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional

_ROOT = Path(__file__).resolve().parents[2]
SOLID_UPSTREAM_DIR = _ROOT / "modules" / "solidcraft" / "upstream" / "solidcraft"
DATA_DIR = _ROOT / "modules" / "solidcraft" / "data"
SYNC_STATE_FILE = DATA_DIR / "upstream_sync.json"

_SYNC_LOCK = threading.RLock()

REPO_CONFIG = {
    "id": "solidcraft",
    "name": "SolidCraft (Parametric 3D CAD)",
    "dir": SOLID_UPSTREAM_DIR,
    "fork": "https://github.com/chlin1983/solidcraft.git",
    "official": "https://github.com/tangency-labs/solidcraft.git",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _run_git(args: list[str], cwd: Optional[Path] = None, timeout: int = 45) -> tuple[int, str, str]:
    try:
        res = subprocess.run(
            ["git"] + args,
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
        return res.returncode, res.stdout.strip(), res.stderr.strip()
    except subprocess.TimeoutExpired:
        return -1, "", "Command timed out"
    except Exception as e:
        return -1, "", str(e)


def ensure_repo() -> dict:
    """Ensure repository is cloned and remotes (origin and upstream) are configured."""
    target = REPO_CONFIG["dir"]
    official_url = REPO_CONFIG["official"]
    fork_url = REPO_CONFIG["fork"]

    target.parent.mkdir(parents=True, exist_ok=True)
    if not (target / ".git").exists():
        rc, _, err = _run_git(["clone", "--depth", "1", official_url, str(target)], timeout=90)
        if rc != 0:
            return {"status": "error", "message": f"Clone failed: {err}"}

    _run_git(["remote", "set-url", "origin", fork_url], cwd=target)
    _, remotes, _ = _run_git(["remote"], cwd=target)
    if "upstream" not in remotes.split():
        _run_git(["remote", "add", "upstream", official_url], cwd=target)
    else:
        _run_git(["remote", "set-url", "upstream", official_url], cwd=target)

    return {"status": "ready"}


def get_repo_info() -> dict:
    target = REPO_CONFIG["dir"]
    if not target.exists() or not (target / ".git").exists():
        return {
            "id": "solidcraft",
            "name": REPO_CONFIG["name"],
            "installed": False,
            "commit": None,
            "commit_date": None,
            "commit_message": None,
            "path": str(target),
            "fork_url": REPO_CONFIG["fork"],
            "official_url": REPO_CONFIG["official"],
        }

    rc, out, _ = _run_git(["log", "-n", "1", "--format=%h|%cI|%s"], cwd=target)
    commit, date, msg = (out.split("|", 2) + ["", "", ""])[:3] if rc == 0 and out else (None, None, None)
    return {
        "id": "solidcraft",
        "name": REPO_CONFIG["name"],
        "installed": True,
        "commit": commit,
        "commit_date": date,
        "commit_message": msg,
        "path": str(target),
        "fork_url": REPO_CONFIG["fork"],
        "official_url": REPO_CONFIG["official"],
    }


def sync_repo() -> dict:
    """Fetch latest upstream commits, fast-forward merge, and push to user fork."""
    target = REPO_CONFIG["dir"]
    ensure_repo()
    if not target.exists() or not (target / ".git").exists():
        return {"status": "error", "message": "Repo not initialized"}

    # 1. Fetch official upstream
    rc, _, _ = _run_git(["fetch", "--depth", "1", "upstream", "main"], cwd=target, timeout=30)
    if rc != 0:
        rc, _, _ = _run_git(["fetch", "upstream", "main"], cwd=target, timeout=30)

    # 2. Check if we need to merge upstream changes
    before_rc, before_sha, _ = _run_git(["rev-parse", "--short", "HEAD"], cwd=target)
    _run_git(["merge", "--ff-only", "upstream/main"], cwd=target, timeout=15)
    after_rc, after_sha, _ = _run_git(["rev-parse", "--short", "HEAD"], cwd=target)
    updated = (before_sha != after_sha) if (before_rc == 0 and after_rc == 0) else False

    # 3. Push to user fork
    push_rc, _, _ = _run_git(["push", "origin", "main"], cwd=target, timeout=20)

    info = get_repo_info()
    return {
        **info,
        "status": "updated" if updated else "up_to_date",
        "new_commits": updated,
        "synced_to_fork": push_rc == 0,
        "last_sync": _now_iso(),
    }
