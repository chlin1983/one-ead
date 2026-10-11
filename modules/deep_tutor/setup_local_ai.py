#!/usr/bin/env python3
"""One-command local AI setup for the DeepTutor plugin (Ollama + models + DeepTutor settings).

Run from the One EAD folder:

    python modules/deep_tutor/setup_local_ai.py             # asks before every install and download
    python modules/deep_tutor/setup_local_ai.py --check     # only reports your PC and what is missing
    python modules/deep_tutor/setup_local_ai.py --yes --preset light --install-ollama

Everything runs locally; chats never leave this PC. Software installs (Ollama, Node.js, uv) happen
only after you answer yes, or when the matching --install-* flag is given together with --yes.
The same script is behind the "Run setup now" button in the DeepTutor plugin.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deep_tutor as dt  # noqa: E402  (stdlib-only manager that also owns the plugin's paths)

ARGS: argparse.Namespace
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
WINGET_IDS = {"node": "OpenJS.NodeJS.LTS", "uv": "astral-sh.uv", "ollama": "Ollama.Ollama"}
DOWNLOAD_URLS = {"node": "https://nodejs.org/", "uv": "https://docs.astral.sh/uv/", "ollama": "https://ollama.com/download"}
CATALOG = dt.HOME_DIR / "data" / "user" / "settings" / "model_catalog.json"


def say(msg: str = "") -> None:
    print(msg, flush=True)


def confirm(question: str, flag: bool = False, default: bool = True) -> bool:
    """Ask the user; in --yes mode only an explicit flag counts as consent."""
    if ARGS.yes:
        return flag
    try:
        answer = input(f"{question} [{'Y/n' if default else 'y/N'}] ").strip().lower()
    except EOFError:
        return False
    return default if not answer else answer.startswith("y")


def refresh_path() -> None:
    """Pick up PATH entries added by a just-finished installer."""
    if os.name != "nt":
        return
    import winreg

    parts = []
    for hive, sub in ((winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
                      (winreg.HKEY_CURRENT_USER, "Environment")):
        try:
            with winreg.OpenKey(hive, sub) as key:
                parts.append(os.path.expandvars(winreg.QueryValueEx(key, "Path")[0]))
        except OSError:
            pass
    os.environ["PATH"] = ";".join(parts + [os.environ.get("PATH", "")])


def winget_install(kind: str) -> bool:
    if not shutil.which("winget"):
        say(f"  winget is not available. Install it manually from {DOWNLOAD_URLS[kind]} and run this again.")
        return False
    say(f"  Installing {kind} with winget (this can take a few minutes; Windows may ask for permission)...")
    code = subprocess.run(
        ["winget", "install", "-e", "--id", WINGET_IDS[kind], "--silent",
         "--accept-package-agreements", "--accept-source-agreements"],
        creationflags=NO_WINDOW,
    ).returncode
    refresh_path()
    return code == 0


def report(info: dict) -> None:
    hw, deps = info["hardware"], info["deps"]
    gpu = hw["gpu"]
    say("Your PC")
    say(f"  RAM:        {hw['ram_gb']} GB")
    say(f"  Free disk:  {hw['free_disk_gb']} GB (on the drive that stores Ollama models: {hw['disk_path']})")
    say(f"  GPU:        {gpu['name'] + ', ' + str(gpu['vram_gb']) + ' GB' if gpu else 'none detected (models will run on the CPU, slower)'}")
    say()
    say("Requirements")
    say("  Minimum (Light):      8 GB RAM, about 6 GB free disk")
    say("  Recommended (Standard): 16 GB RAM, GPU with 6 GB+ memory, about 20 GB free disk")
    say()
    say("Status")
    say(f"  Node.js (needed by DeepTutor):  {'installed' if deps['node'] else 'MISSING'}")
    say(f"  uv or Python 3.11-3.14:         {'installed' if deps['python'] else 'MISSING'}")
    say(f"  Ollama:                         {'installed' if deps['ollama'] else 'MISSING'}"
        f"{' (running)' if deps['ollama_running'] else ''}")
    say(f"  DeepTutor chat model set up:    {'yes' if info['configured'] else 'no'}")
    say()


def choose_preset(info: dict) -> str:
    if ARGS.preset:
        return ARGS.preset
    keys = list(info["presets"])
    rec = info["recommended_preset"]
    if ARGS.yes:
        return rec
    say("Model sets")
    for i, key in enumerate(keys, 1):
        p = info["presets"][key]
        say(f"  {i}) {p['label']}: {' + '.join(p['chat'])} + {dt.EMBED_MODEL}")
        say(f"     {p['detail']}; download about {p['download_gb']} GB"
            f"{'  <- recommended for this PC' if key == rec else ''}")
    try:
        pick = input(f"Choose 1-{len(keys)} [{keys.index(rec) + 1}]: ").strip()
    except EOFError:
        pick = ""
    return keys[int(pick) - 1] if pick.isdigit() and 1 <= int(pick) <= len(keys) else rec


def install_dependencies(info: dict) -> bool:
    """Offer to install what is missing. Returns False when Ollama is still unavailable."""
    deps = info["deps"]
    if not deps["node"]:
        say("Node.js is required by DeepTutor's web app (about 30 MB).")
        if confirm("  Install Node.js LTS?", ARGS.install_node):
            winget_install("node")
        else:
            say(f"  Skipped. DeepTutor will not start until Node.js is installed: {DOWNLOAD_URLS['node']}")
    if not deps["python"]:
        say("uv (a small Python tool, about 20 MB) is needed to create DeepTutor's private Python environment.")
        if confirm("  Install uv?", ARGS.install_uv):
            winget_install("uv")
        else:
            say(f"  Skipped. Install uv ({DOWNLOAD_URLS['uv']}) or Python 3.12 and run this again.")
    if dt.find_ollama():
        return True
    say(f"Ollama runs the AI models on this PC (about {dt.OLLAMA_INSTALL_GB} GB installed).")
    if confirm("  Install Ollama?", ARGS.install_ollama):
        winget_install("ollama")
    if dt.find_ollama():
        return True
    say(f"  Ollama is not installed, so no local model can be set up. Get it from {DOWNLOAD_URLS['ollama']} and run this again.")
    return False


def check_resources(info: dict, preset: str, installing_ollama: bool) -> bool:
    hw, p = info["hardware"], info["presets"][preset]
    need = p["download_gb"] + (dt.OLLAMA_INSTALL_GB if installing_ollama else 0)
    problems = []
    if hw["free_disk_gb"] is not None and hw["free_disk_gb"] < need + 2:
        problems.append(f"free disk is {hw['free_disk_gb']} GB but about {need + 2:.1f} GB is needed")
    if hw["ram_gb"] and hw["ram_gb"] < p["min_ram_gb"]:
        problems.append(f"RAM is {hw['ram_gb']} GB; the {p['label']} set suggests at least {p['min_ram_gb']} GB")
    if not problems:
        return True
    for text in problems:
        say(f"  Warning: {text}.")
    if ARGS.yes:
        return ARGS.force
    return confirm("  Continue anyway?", default=False)


def set_ollama_env(missing: dict) -> bool:
    if os.name != "nt":
        say("  Add these to your shell profile, then restart Ollama:")
        for k, v in missing.items():
            say(f"    export {k}={v}")
        return False
    for k, v in missing.items():
        subprocess.run(["setx", k, v], capture_output=True, creationflags=NO_WINDOW)
        os.environ[k] = v
    return True


def start_ollama() -> bool:
    """(Re)start Ollama so it sees the user environment, then wait until it answers."""
    exe = dt.find_ollama()
    if not exe:
        return False
    if os.name == "nt":
        for name in ("ollama app.exe", "ollama.exe"):
            subprocess.run(["taskkill", "/IM", name, "/F"], capture_output=True, creationflags=NO_WINDOW)
        time.sleep(2)
        app = Path(exe).parent / "ollama app.exe"
        target = [str(app)] if app.exists() else [exe, "serve"]
        flags = NO_WINDOW | getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        subprocess.Popen(target, creationflags=flags, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        subprocess.Popen([exe, "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    return wait_for_ollama()


def wait_for_ollama(seconds: int = 45) -> bool:
    end = time.time() + seconds
    while time.time() < end:
        if dt.ollama_models() is not None:
            return True
        time.sleep(1)
    return False


def pull(model: str) -> None:
    say(f"Downloading {model} ...")
    req = urllib.request.Request(
        f"{dt.OLLAMA_URL}/api/pull", data=json.dumps({"model": model, "stream": True}).encode("utf-8"),
        headers={"Content-Type": "application/json"})
    last = -1
    with dt.local_opener().open(req, timeout=300) as resp:
        for raw in resp:
            obj = json.loads(raw)
            if obj.get("error"):
                raise RuntimeError(obj["error"])
            if obj.get("total") and str(obj.get("status", "")).startswith("pulling"):
                pct = int(obj.get("completed", 0) * 100 / obj["total"]) // 10 * 10
                if pct != last:
                    last = pct
                    say(f"  {model}: {pct}%")
    say(f"  {model}: done")


def ensure_deeptutor() -> bool:
    saved = dt._read_json(dt.RUN_FILE, {})
    if isinstance(saved, dict) and dt._pid_alive(saved.get("pid")):
        say("DeepTutor is running (started by One EAD). Stop it first (DeepTutor plugin menu > Stop service), then run this again.")
        return False
    if dt.is_installed():
        return True
    say("Installing DeepTutor (downloads a few hundred MB)...")
    dt._log = lambda line: say("  " + dt._ANSI_RE.sub("", line).rstrip()) if line.strip() else None
    latest = dt.check_latest(force=True)
    if not latest["info"]:
        say(f"  Cannot reach PyPI: {latest['error']}")
        return False
    dt._build(latest["info"])
    return True


def configure_deeptutor(chat_models: list, embed: str) -> None:
    exe = dt.VENV_DIR / ("Scripts/deeptutor.exe" if os.name == "nt" else "bin/deeptutor")
    home = str(dt.HOME_DIR)
    if not dt._settings_file().exists():
        dt.HOME_DIR.mkdir(parents=True, exist_ok=True)
        subprocess.run([str(exe), "init", "--non-interactive", "--home", home], capture_output=True,
                       stdin=subprocess.DEVNULL, timeout=180, creationflags=NO_WINDOW)

    previous = None
    try:
        cat = json.loads(CATALOG.read_text(encoding="utf-8"))
        llm = cat["services"]["llm"]
        previous = next((m["name"] for p in llm["profiles"] for m in p["models"] if m["id"] == llm["active_model_id"]), None)
    except Exception:
        pass

    setup = {
        "llm": {"provider": "ollama", "model": chat_models[0], "base_url": f"{dt.OLLAMA_URL}/v1"},
        "embedding": {"provider": "ollama", "model": embed, "base_url": f"{dt.OLLAMA_URL}/api/embed", "dimension": 768},
        "search": {"provider": "none"},
    }
    setup_file = dt.DATA_DIR / "setup-ollama.json"
    setup_file.write_text(json.dumps(setup, indent=2), encoding="utf-8")
    try:
        done = subprocess.run([str(exe), "config", "apply", str(setup_file), "--home", home], capture_output=True,
                              text=True, stdin=subprocess.DEVNULL, timeout=240, creationflags=NO_WINDOW)
    except subprocess.TimeoutExpired:
        raise RuntimeError("deeptutor config apply did not finish within 4 minutes; run this again") from None
    if done.returncode != 0:
        raise RuntimeError(f"deeptutor config apply failed: {(done.stdout + done.stderr).strip()[-600:]}")

    # Friendlier names, the extra chat models, and keep the model the user had selected.
    cat = json.loads(CATALOG.read_text(encoding="utf-8"))
    for svc, wanted in (("llm", "Ollama \u2013 Chat"), ("embedding", "Ollama \u2013 Embeddings"), ("search", "Search (disabled)")):
        for prof in cat["services"][svc]["profiles"]:
            if prof.get("name") == "Agent Setup":
                prof["name"] = wanted
    llm = cat["services"]["llm"]
    prof = next((p for p in llm["profiles"] if p.get("id") == llm.get("active_profile_id")), None)
    if prof is not None:
        have = {m["model"] for m in prof["models"]}
        for model in chat_models:
            if model not in have:
                prof["models"].append({"id": "llm-model-" + model.replace(":", "-").replace(".", "-"),
                                       "name": model, "model": model})
        keep = next((m["id"] for m in prof["models"] if m["model"] == previous), None)
        if keep:
            llm["active_model_id"] = keep
    CATALOG.write_text(json.dumps(cat, indent=2, ensure_ascii=False), encoding="utf-8")


def main() -> int:
    global ARGS
    ap = argparse.ArgumentParser(description="Set up private, local AI (Ollama) for the DeepTutor plugin.")
    ap.add_argument("--check", action="store_true", help="only report hardware and what is missing")
    ap.add_argument("--yes", action="store_true", help="no questions; software installs still need the --install-* flags")
    ap.add_argument("--preset", choices=list(dt.PRESETS), help="model set (default: recommended for this PC)")
    ap.add_argument("--chat-model", action="append", help="override the preset's chat models (repeatable; first is active)")
    ap.add_argument("--embedding-model", default=dt.EMBED_MODEL)
    ap.add_argument("--install-ollama", action="store_true", help="with --yes: install Ollama if missing")
    ap.add_argument("--install-node", action="store_true", help="with --yes: install Node.js LTS if missing")
    ap.add_argument("--install-uv", action="store_true", help="with --yes: install uv if missing")
    ap.add_argument("--ollama-env", action="store_true", help="with --yes: apply the recommended Ollama settings")
    ap.add_argument("--force", action="store_true", help="with --yes: continue despite low disk or RAM")
    ARGS = ap.parse_args()

    info = dt.local_ai_info()
    report(info)
    if ARGS.check:
        return 0
    if not ARGS.yes and not sys.stdin.isatty():
        say("Not an interactive terminal. Re-run with --yes (see --help).")
        return 1

    preset = choose_preset(info)
    chat_models = ARGS.chat_model or dt.PRESETS[preset]["chat"]
    p = info["presets"][preset]
    say(f"Plan ({p['label']}): {' + '.join(chat_models)} + {ARGS.embedding_model}; about {p['download_gb']} GB to download.")
    say()

    if not check_resources(info, preset, not dt.find_ollama() and (ARGS.install_ollama or not ARGS.yes)):
        say("Stopped. Nothing was changed.")
        return 2
    if not install_dependencies(info):
        return 2

    missing = dt.ollama_env_missing()
    restart = False
    if missing:
        say("Recommended Ollama settings (without them DeepTutor chats fail on Ollama's small default context):")
        for k, v in missing.items():
            say(f"  {k}={v}")
        if confirm("  Apply them? Ollama will be restarted.", ARGS.ollama_env):
            restart = set_ollama_env(missing)
    if restart or dt.ollama_models() is None:
        say("Starting Ollama ...")
        if not start_ollama():
            say("  Ollama did not respond. Start it manually and run this again.")
            return 1

    installed = dt.ollama_models() or []
    for model in dict.fromkeys(list(chat_models) + [ARGS.embedding_model]):
        if dt.has_model(installed, model):
            say(f"{model}: already downloaded")
        else:
            pull(model)

    if not ensure_deeptutor():
        return 1
    say("Configuring DeepTutor ...")
    configure_deeptutor(list(chat_models), ARGS.embedding_model)
    say()
    say("Done. Open the DeepTutor plugin (or use its menu > Restart service if it is already open).")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        say("\nCancelled.")
        sys.exit(130)
    except Exception as exc:  # noqa: BLE001 - report any failure as one readable line
        say(f"Setup failed: {type(exc).__name__}: {exc}")
        sys.exit(1)
