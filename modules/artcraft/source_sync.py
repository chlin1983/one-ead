"""Source Code Synchronization & Upstream Manager for ArtCraft & PdfCraft.

Handles:
1. Automatic background clone on fresh installations.
2. Checking official upstream (storytold) for latest bug fixes.
3. Performing fast-forward git pulls to stay up to date.
4. Syncing changes to the user's GitHub fork (chlin1983).
5. Exposing status and commit metadata to the One EAD plugins.
"""

from __future__ import annotations

import json
import os
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

_ROOT = Path(__file__).resolve().parents[2]
ARTCRAFT_UPSTREAM_DIR = _ROOT / "modules" / "artcraft" / "upstream"
PDFCRAFT_UPSTREAM_DIR = _ROOT / "modules" / "pdfcraft" / "upstream" / "pdfcraft"
DATA_DIR = _ROOT / "modules" / "artcraft" / "data"
SYNC_STATE_FILE = DATA_DIR / "upstream_sync.json"

_SYNC_LOCK = threading.RLock()
_bg_sync_thread: Optional[threading.Thread] = None

# Catalog of managed upstream repositories
MANAGED_REPOS = [
    {
        "id": "pdfcraft",
        "name": "PdfCraft",
        "plugin": "pdfcraft",
        "dir": PDFCRAFT_UPSTREAM_DIR,
        "fork": "https://github.com/chlin1983/pdfcraft-1.git",
        "official": "https://github.com/storytold/pdfcraft.git",
    },
    {
        "id": "photocraft",
        "name": "PhotoCraft",
        "plugin": "artcraft",
        "dir": ARTCRAFT_UPSTREAM_DIR / "photocraft",
        "fork": "https://github.com/chlin1983/photocraft.git",
        "official": "https://github.com/storytold/photocraft.git",
    },
    {
        "id": "vectorcraft",
        "name": "VectorCraft",
        "plugin": "artcraft",
        "dir": ARTCRAFT_UPSTREAM_DIR / "vectorcraft",
        "fork": "https://github.com/chlin1983/vectorcraft.git",
        "official": "https://github.com/storytold/vectorcraft.git",
    },
    {
        "id": "filmcraft",
        "name": "FilmCraft",
        "plugin": "artcraft",
        "dir": ARTCRAFT_UPSTREAM_DIR / "filmcraft",
        "fork": "https://github.com/chlin1983/filmcraft.git",
        "official": "https://github.com/storytold/filmcraft.git",
    },
    {
        "id": "lightcraft",
        "name": "LightCraft",
        "plugin": "artcraft",
        "dir": ARTCRAFT_UPSTREAM_DIR / "lightcraft",
        "fork": "https://github.com/chlin1983/lightcraft.git",
        "official": "https://github.com/storytold/lightcraft.git",
    },
    {
        "id": "effectcraft",
        "name": "EffectCraft",
        "plugin": "artcraft",
        "dir": ARTCRAFT_UPSTREAM_DIR / "effectcraft",
        "fork": "https://github.com/chlin1983/effectcraft.git",
        "official": "https://github.com/storytold/effectcraft.git",
    },
    {
        "id": "designcraft",
        "name": "DesignCraft",
        "plugin": "artcraft",
        "dir": ARTCRAFT_UPSTREAM_DIR / "designcraft",
        "fork": "https://github.com/chlin1983/designcraft.git",
        "official": "https://github.com/storytold/designcraft.git",
    },
    {
        "id": "figcraft",
        "name": "FigCraft",
        "plugin": "artcraft",
        "dir": ARTCRAFT_UPSTREAM_DIR / "figcraft",
        "fork": "https://github.com/chlin1983/figcraft.git",
        "official": "https://github.com/storytold/figcraft.git",
    },
    {
        "id": "wordcraft",
        "name": "WordCraft",
        "plugin": "artcraft",
        "dir": ARTCRAFT_UPSTREAM_DIR / "wordcraft",
        "fork": "https://github.com/chlin1983/wordcraft.git",
        "official": "https://github.com/storytold/wordcraft.git",
    },
    {
        "id": "soundcraft",
        "name": "SoundCraft",
        "plugin": "artcraft",
        "dir": ARTCRAFT_UPSTREAM_DIR / "soundcraft",
        "fork": "https://github.com/chlin1983/soundcraft.git",
        "official": "https://github.com/storytold/soundcraft.git",
    },
    {
        "id": "deckcraft",
        "name": "DeckCraft",
        "plugin": "artcraft",
        "dir": ARTCRAFT_UPSTREAM_DIR / "deckcraft",
        "fork": "https://github.com/chlin1983/deckcraft.git",
        "official": "https://github.com/storytold/deckcraft.git",
    },
    {
        "id": "cadcraft",
        "name": "CADCraft",
        "plugin": "artcraft",
        "dir": ARTCRAFT_UPSTREAM_DIR / "cadcraft",
        "fork": "https://github.com/chlin1983/cadcraft.git",
        "official": "https://github.com/storytold/cadcraft.git",
    },
    {
        "id": "gridcraft",
        "name": "GridCraft",
        "plugin": "artcraft",
        "dir": ARTCRAFT_UPSTREAM_DIR / "gridcraft",
        "fork": "https://github.com/chlin1983/gridcraft.git",
        "official": "https://github.com/storytold/gridcraft.git",
    },
    {
        "id": "craft-libs",
        "name": "Craft-Libs (Core Crates)",
        "plugin": "artcraft",
        "dir": ARTCRAFT_UPSTREAM_DIR / "craft-libs",
        "fork": "https://github.com/chlin1983/craft-libs.git",
        "official": "https://github.com/storytold/craft-libs.git",
    },
    {
        "id": "craft-fonts",
        "name": "Craft-Fonts",
        "plugin": "artcraft",
        "dir": ARTCRAFT_UPSTREAM_DIR / "craft-fonts",
        "fork": "https://github.com/chlin1983/craft-fonts.git",
        "official": "https://github.com/storytold/craft-fonts.git",
    },
]


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


def _ensure_single_repo(item: dict) -> dict:
    """Ensure a repo is cloned and configured with dual remotes (origin and upstream)."""
    target: Path = item["dir"]
    official_url = item["official"]
    fork_url = item["fork"]
    name = item["name"]

    target.parent.mkdir(parents=True, exist_ok=True)

    if not (target / ".git").exists():
        # Clone shallowly from official first
        rc, out, err = _run_git(["clone", "--depth", "1", official_url, str(target)], timeout=90)
        if rc != 0:
            return {"id": item["id"], "name": name, "status": "error", "message": f"Clone failed: {err}"}

    # Ensure origin = fork_url and upstream = official_url
    _run_git(["remote", "set-url", "origin", fork_url], cwd=target)
    _, remotes, _ = _run_git(["remote"], cwd=target)
    if "upstream" not in remotes.split():
        _run_git(["remote", "add", "upstream", official_url], cwd=target)
    else:
        _run_git(["remote", "set-url", "upstream", official_url], cwd=target)

    return {"id": item["id"], "name": name, "status": "ready"}


def get_repo_info(item: dict) -> dict:
    """Get current git commit information for a repository."""
    target: Path = item["dir"]
    if not target.exists() or not (target / ".git").exists():
        return {
            "id": item["id"],
            "name": item["name"],
            "installed": False,
            "commit": None,
            "commit_date": None,
            "commit_message": None,
            "path": str(target),
            "fork_url": item["fork"],
            "official_url": item["official"],
        }

    # Get HEAD commit details
    rc, out, _ = _run_git(["log", "-n", "1", "--format=%h|%cI|%s"], cwd=target)
    commit, date, msg = (out.split("|", 2) + ["", "", ""])[:3] if rc == 0 and out else (None, None, None)

    return {
        "id": item["id"],
        "name": item["name"],
        "installed": True,
        "commit": commit,
        "commit_date": date,
        "commit_message": msg,
        "path": str(target),
        "fork_url": item["fork"],
        "official_url": item["official"],
    }


def sync_single_repo(item: dict) -> dict:
    """Pull newest bug fixes from official upstream, then push to user fork."""
    target: Path = item["dir"]
    _ensure_single_repo(item)

    if not target.exists() or not (target / ".git").exists():
        return {"id": item["id"], "status": "error", "message": "Repo not found"}

    # 1. Fetch official upstream
    rc, _, err = _run_git(["fetch", "--depth", "1", "upstream", "main"], cwd=target, timeout=30)
    if rc != 0:
        # Fallback fetch
        rc, _, err = _run_git(["fetch", "upstream", "main"], cwd=target, timeout=30)

    # 2. Check if we need to merge upstream changes
    before_rc, before_sha, _ = _run_git(["rev-parse", "--short", "HEAD"], cwd=target)
    _run_git(["merge", "--ff-only", "upstream/main"], cwd=target, timeout=15)
    after_rc, after_sha, _ = _run_git(["rev-parse", "--short", "HEAD"], cwd=target)

    updated = (before_sha != after_sha) if (before_rc == 0 and after_rc == 0) else False

    # 3. Push to user's fork (origin main) to keep fork up to date
    push_rc, _, push_err = _run_git(["push", "origin", "main"], cwd=target, timeout=20)

    info = get_repo_info(item)
    return {
        **info,
        "status": "updated" if updated else "up_to_date",
        "new_commits": updated,
        "synced_to_fork": push_rc == 0,
        "last_sync": _now_iso(),
    }


def sync_all_sources(background: bool = True) -> dict:
    """Sync all Craft upstream repositories with official bug fixes and user forks."""
    def _worker():
        with _SYNC_LOCK:
            results = {}
            for item in MANAGED_REPOS:
                try:
                    res = sync_single_repo(item)
                    results[item["id"]] = res
                except Exception as e:
                    results[item["id"]] = {"id": item["id"], "status": "error", "message": str(e)}

            DATA_DIR.mkdir(parents=True, exist_ok=True)
            cache = {
                "last_sync": _now_iso(),
                "repos": results,
            }
            try:
                with open(SYNC_STATE_FILE, "w", encoding="utf-8") as f:
                    json.dump(cache, f, indent=2)
            except Exception:
                pass

    if background:
        t = threading.Thread(target=_worker, daemon=True)
        t.start()
        return get_sync_status()
    else:
        _worker()
        return get_sync_status()


def get_sync_status() -> dict:
    """Return the cached or quick status of all upstream repositories."""
    if SYNC_STATE_FILE.exists():
        try:
            with open(SYNC_STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass

    # Build initial status quickly without network
    repos = {item["id"]: get_repo_info(item) for item in MANAGED_REPOS}
    return {
        "last_sync": None,
        "repos": repos,
    }


def ensure_all_repos_in_background() -> None:
    """Non-blocking background runner: clones any missing upstream repos."""
    global _bg_sync_thread
    with _SYNC_LOCK:
        missing = [item for item in MANAGED_REPOS if not (item["dir"] / ".git").exists()]
        if not missing:
            return
        if _bg_sync_thread and _bg_sync_thread.is_alive():
            return

        def _setup_runner():
            for item in missing:
                try:
                    _ensure_single_repo(item)
                except Exception as exc:
                    print(f"[ArtCraft Sync] Error ensuring {item['name']}: {exc}")

        _bg_sync_thread = threading.Thread(target=_setup_runner, daemon=True)
        _bg_sync_thread.start()
