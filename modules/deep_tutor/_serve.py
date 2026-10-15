"""Runs DeepTutor's own launcher bound to loopback only.

Executed by the plugin's private venv interpreter (``python _serve.py <home>``).
Upstream hard-codes ``0.0.0.0`` for both servers, which would expose a tool that
spends the user's LLM API keys to the whole network. This shim rewrites that one
detail and otherwise leaves the upstream launcher untouched, so it keeps working
as upstream changes; if the launcher internals ever move, it falls back to the
stock behaviour (see the ``bind`` field reported by the plugin status).
"""

import os
import sys
from pathlib import Path

LOOPBACK = "127.0.0.1"
PRELOAD = Path(__file__).resolve().parent / "inject" / "preload.js"
PYHOOKS = Path(__file__).resolve().parent / "inject" / "py"


def _patch_relay(launcher) -> None:
    """Keep draining child output even if printing it fails.

    Upstream's relay thread dies on the first print error; the child's pipe then fills up and the
    child (e.g. the API server, on its next log line) blocks forever.
    """
    def _stream_output(prefix, process):
        printing = True
        for line in process.stdout:
            if printing:
                try:
                    print(f"  {prefix:<8} {line.rstrip()}", flush=True)
                except Exception:
                    printing = False

    if hasattr(launcher, "_stream_output"):
        launcher._stream_output = _stream_output


def _patch_copy_web(launcher) -> None:
    original = getattr(launcher, "_copy_packaged_web_if_needed", None)
    if original is None:
        return

    def _copy_packaged_web_if_needed(packaged, *, home, api_base, auth_enabled):
        import shutil
        import json
        cache = home / getattr(launcher, "WEB_CACHE_DIR", Path("data") / "user" / "runtime" / "web")
        marker = cache / ".deeptutor-web-runtime.json"
        source_server = packaged / "server.js"
        marker_payload = {
            "source": str(packaged),
            "source_mtime_ns": source_server.stat().st_mtime_ns,
            "api_base": api_base,
            "auth_enabled": bool(auth_enabled),
        }
        if (cache / "server.js").exists():
            try:
                if json.loads(marker.read_text(encoding="utf-8")) == marker_payload:
                    return cache
            except Exception:
                pass

        if cache.exists():
            try:
                shutil.rmtree(cache)
            except Exception:
                pass
        try:
            shutil.copytree(packaged, cache, dirs_exist_ok=True)
            patch_fn = getattr(launcher, "_patch_packaged_web_placeholders", None)
            if callable(patch_fn):
                patch_fn(
                    cache,
                    api_base=api_base,
                    auth_enabled="true" if auth_enabled else "false",
                )
            marker.write_text(json.dumps(marker_payload, indent=2), encoding="utf-8")
        except Exception:
            if (cache / "server.js").exists():
                return cache
            raise
        return cache

    launcher._copy_packaged_web_if_needed = _copy_packaged_web_if_needed


def _patch(launcher) -> bool:
    original = getattr(launcher, "_spawn", None)
    if original is None:
        return False
    _patch_relay(launcher)
    _patch_copy_web(launcher)

    def _spawn(command, *, cwd, env, name):
        command = [LOOPBACK if part == "0.0.0.0" else part for part in command]
        env = dict(env)
        env["HOSTNAME"] = LOOPBACK
        if name == "backend" and PYHOOKS.is_dir():
            # sitecustomize there adds table-aware PDF text extraction (see inject/py).
            env["PYTHONPATH"] = os.pathsep.join(p for p in (str(PYHOOKS), env.get("PYTHONPATH", "")) if p)
        if name == "frontend" and PRELOAD.is_file():
            # Adds the knowledge-base rename UI to the web app (see inject/).
            node_opts = env.get("NODE_OPTIONS", "")
            env["NODE_OPTIONS"] = f'{node_opts} --require "{PRELOAD.as_posix()}"'.strip()
        return original(command, cwd=cwd, env=env, name=name)

    launcher._spawn = _spawn
    return True


def main() -> None:
    home = sys.argv[1]
    from deeptutor.runtime import launcher

    patched = _patch(launcher)
    print(f"[one-ead] loopback-only binding: {'on' if patched else 'UNAVAILABLE (upstream launcher changed)'}", flush=True)
    launcher.start(home=home, dev=False, detach=False, open_browser=False)


if __name__ == "__main__":
    main()
