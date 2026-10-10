"""Runs DeepTutor's own launcher bound to loopback only.

Executed by the plugin's private venv interpreter (``python _serve.py <home>``).
Upstream hard-codes ``0.0.0.0`` for both servers, which would expose a tool that
spends the user's LLM API keys to the whole network. This shim rewrites that one
detail and otherwise leaves the upstream launcher untouched, so it keeps working
as upstream changes; if the launcher internals ever move, it falls back to the
stock behaviour (see the ``bind`` field reported by the plugin status).
"""

import sys

LOOPBACK = "127.0.0.1"


def _patch(launcher) -> bool:
    original = getattr(launcher, "_spawn", None)
    if original is None:
        return False

    def _spawn(command, *, cwd, env, name):
        command = [LOOPBACK if part == "0.0.0.0" else part for part in command]
        env = dict(env)
        env["HOSTNAME"] = LOOPBACK
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
