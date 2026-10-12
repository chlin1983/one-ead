"""GPT Researcher manager for One EAD.

Runs gpt-researcher (Apache-2.0, https://github.com/assafelovic/gpt-researcher) as an *offline-first*
research assistant. Everything stays on this PC:

* The engine lives in a private virtualenv (``data/venv``); it is never installed into One EAD's own
  Python. It starts at ``ENGINE_VERSION`` and only moves to a newer upstream release after the new
  version was installed in a separate staging venv and passed compatibility and test-job checks; the
  previous venv is kept for rollback (see the "engine updates" section).
* The language model is a local Ollama model on loopback; no cloud LLM key is ever passed on.
* Each research job is a separate process started with a whitelisted environment (no inherited API
  keys) and a network guard (see ``_run_research.py``): in *local documents* mode nothing but loopback
  is reachable.
* No server port is opened for the engine, so there is no extra attack surface.

User data (documents, reports) lives in ``data/`` and is git-ignored.
"""

from __future__ import annotations

import atexit
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import uuid
from collections import deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from . import mathtext

TOOL_ID = "gpt-researcher"
ENGINE_PACKAGE = "gpt-researcher"
ENGINE_VERSION = "0.16.1"  # known-good baseline; verified updates are recorded in data/engine.json
EXTRA_PACKAGES = ["ddgs==9.16.0"]  # DuckDuckGo search backend, imported by gpt-researcher on demand
PYTHON_SPEC = ">=3.12,<3.15"  # upstream's requires-python
_HERE = Path(__file__).resolve().parent
DATA_DIR = _HERE / "data"
VENV_DIR = DATA_DIR / "venv"
VENV_NEXT = DATA_DIR / "venv-next"  # staging copy while an update is being verified
VENV_PREV = DATA_DIR / "venv-prev"  # last working engine, kept for rollback
VENV_SWAP = DATA_DIR / "venv-swap"
STATE_FILE = DATA_DIR / "engine.json"
FOLDERS_FILE = DATA_DIR / "folders.json"
TEST_DIR = DATA_DIR / "update-test"
DOCS_DIR = DATA_DIR / "docs"
REPORTS_DIR = DATA_DIR / "reports"
HOME_DIR = DATA_DIR / "home"  # fake user profile so engine caches never touch the real one
CACHE_DIR = DATA_DIR / "cache"
RUNNER = _HERE / "_run_research.py"
COMPAT = _HERE / "_compat.py"
PYPI_URL = "https://pypi.org/pypi/gpt-researcher/json"
CHECK_EVERY_S = 6 * 3600
AUTO_MIN_AGE_H = 48  # automatic updates skip releases younger than this (yanked/broken releases)
TEST_TIMEOUT_S = 15 * 60

OLLAMA_URL = "http://127.0.0.1:11434"
EMBED_MODEL = "nomic-embed-text"
RECOMMENDED = ["gemma4:e4b", "qwen3:8b", "qwen3:4b"]
DOC_EXTS = {".pdf", ".txt", ".md", ".docx", ".csv", ".xlsx", ".pptx"}
MAX_DOC_BYTES = 200 * 1024 * 1024
MAX_RUN_S = 2 * 60 * 60
SCRAPER_DELAY_S = 2.0  # min seconds between page downloads (on top of per-host API and robots.txt delays)
USER_AGENT = "OneEAD-GPT-Researcher/1.0 (personal research tool; honours robots.txt)"
DEFAULT_WORDS = 2500
EXPORT_SCRIPT = _HERE / "_export_pdf.py"

# label, gpt-researcher report_type
REPORT_TYPES = {
    "detailed_report": "Detailed technical report (sections)",
    "research_report": "Quick research report (single pass)",
    "outline_report": "Outline",
    "resource_report": "Resource list",
    "deep": "Deep research (slow)",
}
SOURCES = {"local": "My documents only (offline)", "web": "Web only", "hybrid": "My documents + web"}
RETRIEVERS = {
    "arxiv": "arXiv",
    "semantic_scholar": "Semantic Scholar",
    "openalex": "OpenAlex",
    "pubmed_central": "PubMed Central",
    "duckduckgo": "DuckDuckGo (general web)",
}
TONES = ["objective", "formal", "analytical", "informative", "explanatory", "comparative", "critical"]
ROLE = (
    "You are a senior electroacoustic and hearing-aid engineering research assistant (transducers, "
    "MEMS microphones, balanced-armature receivers, acoustics, DSP, feedback and occlusion, acoustic "
    "sealing, relevant standards such as IEC 60118 and ANSI S3.22). Be technically precise, use SI units, "
    "name your sources, and clearly separate what the sources state from your own inference. Never invent "
    "numeric values, part numbers, standards clauses or citations; say when the sources do not cover a point. "
    "Write formulas and units as plain text with Unicode symbols (× µ ± ≈ ≤ ≥ Ω ² ⁻³); never use LaTeX or $ delimiters."
)

_ID_RE = re.compile(r"^\d{8}-\d{6}-[0-9a-f]{4}$")
_VER_RE = re.compile(r"^\d+(\.\d+){1,3}$")
_FOLDER_ID_RE = re.compile(r"^[0-9a-f]{8}$")
_MODEL_RE = re.compile(r"^[A-Za-z0-9._:/-]{1,80}$")
_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")
_REF_LINE = re.compile(r"^\s*\[\d{1,3}\]\s+\S")
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
_LOCAL = urllib.request.build_opener(urllib.request.ProxyHandler({}))

_LOCK = threading.RLock()
_INSTALL: dict = {"state": "idle", "message": "", "error": None}
_install_log: deque = deque(maxlen=200)
_UPDATE: dict = {"state": "idle", "step": "", "message": "", "error": None, "from": None, "to": None,
                 "auto": False, "checks": None}
_update_log: deque = deque(maxlen=200)
_PULL: dict = {"state": "idle", "model": None, "message": "", "percent": None, "error": None}
_RUN: dict = {"id": None, "state": "idle", "phase": "", "error": None, "started_at": None}
_run_log: deque = deque(maxlen=400)
_proc: Optional[subprocess.Popen] = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{uuid.uuid4().hex[:8]}.tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    for attempt in range(6):  # Windows scanners/indexers can briefly lock a file that was just written
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 5:
                tmp.unlink(missing_ok=True)
                raise
            time.sleep(0.2)


def _read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


# ---------------------------------------------------------------- engine (private venv)

def venv_python(venv: Path = VENV_DIR) -> Path:
    return venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def engine_version(venv: Path = VENV_DIR) -> Optional[str]:
    if not venv_python(venv).exists():
        return None
    site = venv / "Lib" / "site-packages" if os.name == "nt" else next(
        iter(sorted((venv / "lib").glob("python3.*/site-packages"))), None)
    if site is None or not site.is_dir():
        return None
    for dist in site.glob("gpt_researcher-*.dist-info"):
        return dist.name[len("gpt_researcher-"): -len(".dist-info")]
    return None


def _log_install(line: str) -> None:
    line = _ANSI_RE.sub("", line).rstrip()
    if line:
        _install_log.append(line[:300])


def _run_cmd(cmd: list, env: Optional[dict] = None, log=None) -> int:
    log = log or _log_install
    proc = subprocess.Popen([str(c) for c in cmd], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, encoding="utf-8", errors="replace", creationflags=_NO_WINDOW)
    assert proc.stdout is not None
    for line in proc.stdout:
        log(line)
    return proc.wait()


def _find_system_python() -> Optional[list]:
    candidates = []
    if shutil.which("py"):
        candidates += [["py", f"-3.{minor}"] for minor in (13, 12, 14)]
    candidates += [["python"], ["python3"]]
    probe = "import sys;print(int((3,12)<=sys.version_info[:2]<(3,15)))"
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


def _make_venv(path: Path, log=None) -> None:
    shutil.rmtree(path, ignore_errors=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    uv = shutil.which("uv")
    if uv:
        code = _run_cmd([uv, "venv", "--python", PYTHON_SPEC, "--seed", path], log=log)
    else:
        py = _find_system_python()
        if py is None:
            raise RuntimeError("Needs Python 3.12-3.14. Install uv (https://docs.astral.sh/uv/) or Python 3.12.")
        code = _run_cmd(py + ["-m", "venv", str(path)], log=log)
    if code != 0 or not venv_python(path).exists():
        raise RuntimeError(f"Could not create the Python environment (exit {code})")


def _pip_install(venv: Path, version: str, log=None) -> None:
    specs = [f"{ENGINE_PACKAGE}=={version}", *EXTRA_PACKAGES]
    uv = shutil.which("uv")
    code = (_run_cmd([uv, "pip", "install", "--python", venv_python(venv), *specs], log=log) if uv else
            _run_cmd([venv_python(venv), "-m", "pip", "install", "--disable-pip-version-check", *specs], log=log))
    if code != 0:
        raise RuntimeError(f"Installing {' '.join(specs)} failed (exit {code})")
    if engine_version(venv) != version:
        raise RuntimeError(f"Version mismatch after install (found {engine_version(venv)})")


def _warm_tiktoken(venv: Path, log=None) -> None:
    """Token-count tables are downloaded once so research runs never need the network."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, TIKTOKEN_CACHE_DIR=str(CACHE_DIR / "tiktoken"))
    warm = "import tiktoken;[tiktoken.get_encoding(n) for n in ('o200k_base','cl100k_base')]"
    if _run_cmd([venv_python(venv), "-c", warm], env=env, log=log) != 0:
        raise RuntimeError("Could not fetch tokenizer tables")


def _install_main() -> None:
    try:
        if not venv_python().exists():
            _log_install("== Creating private Python environment")
            _make_venv(VENV_DIR)
        version = target_version()
        _log_install(f"== Installing {ENGINE_PACKAGE} {version} (a few hundred MB)")
        _pip_install(VENV_DIR, version)
        _log_install("== Fetching tokenizer tables (one-time)")
        _warm_tiktoken(VENV_DIR)
        _INSTALL.update(state="done", message="Research engine ready", error=None)
        _log_install("== Done")
    except Exception as exc:
        _INSTALL.update(state="error", message="Install failed", error=f"{type(exc).__name__}: {exc}")
        _log_install(f"!! {exc}")


def start_install() -> dict:
    with _LOCK:
        if _INSTALL["state"] == "running" or _RUN["state"] == "running" or _UPDATE["state"] == "running":
            return status()
        _install_log.clear()
        _INSTALL.update(state="running", message="Installing the research engine", error=None)
        threading.Thread(target=_install_main, name="gpt-researcher-install", daemon=True).start()
    return status()


# ---------------------------------------------------------------- Ollama (loopback only)

def _ollama_get(path: str, timeout: float = 2.0):
    with _LOCAL.open(f"{OLLAMA_URL}{path}", timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def ollama_models() -> Optional[list]:
    """Installed models, or None when Ollama is not running."""
    try:
        return _ollama_get("/api/tags")["models"]
    except Exception:
        return None


def _is_chat_model(name: str) -> bool:
    lowered = name.lower()
    return not any(tag in lowered for tag in ("embed", "ocr", "llava", "vision"))


def chat_models(models: Optional[list]) -> list:
    out = []
    for m in models or []:
        name = m.get("name", "")
        if _is_chat_model(name):
            out.append({"name": name, "size_gb": round(m.get("size", 0) / 2**30, 1),
                        "recommended": name in RECOMMENDED})
    out.sort(key=lambda m: (not m["recommended"], m["name"]))
    return out


def _pull_main(model: str) -> None:
    try:
        req = urllib.request.Request(f"{OLLAMA_URL}/api/pull", data=json.dumps({"model": model}).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
        with _LOCAL.open(req, timeout=3600) as resp:
            for raw in resp:
                try:
                    evt = json.loads(raw.decode("utf-8"))
                except ValueError:
                    continue
                if evt.get("error"):
                    raise RuntimeError(evt["error"])
                total, done = evt.get("total"), evt.get("completed")
                _PULL.update(message=str(evt.get("status", ""))[:80],
                             percent=round(done / total * 100) if total and done is not None else None)
        _PULL.update(state="done", message="Model ready", percent=100, error=None)
    except Exception as exc:
        _PULL.update(state="error", message="Download failed", error=f"{type(exc).__name__}: {exc}")


def start_pull(model: str) -> dict:
    if not _MODEL_RE.match(model or ""):
        raise ValueError("Invalid model name")
    if ollama_models() is None:
        raise RuntimeError("Ollama is not running")
    with _LOCK:
        if _PULL["state"] != "running":
            _PULL.update(state="running", model=model, message="Starting", percent=None, error=None)
            threading.Thread(target=_pull_main, args=(model,), name="gpt-researcher-pull", daemon=True).start()
    return status()


# ---------------------------------------------------------------- document library

def _safe_doc_name(name: str) -> str:
    base = re.sub(r"[^\w .()+-]", "_", Path(name or "").name).strip(" .")
    stem, ext = os.path.splitext(base)
    if ext.lower() not in DOC_EXTS or not stem:
        raise ValueError(f"Unsupported file type (allowed: {', '.join(sorted(DOC_EXTS))})")
    return stem[:120] + ext.lower()


def list_docs() -> list:
    if not DOCS_DIR.is_dir():
        return []
    return [{"name": p.name, "size_kb": max(1, p.stat().st_size // 1024),
             "added": datetime.fromtimestamp(p.stat().st_mtime, timezone.utc).isoformat()}
            for p in sorted(DOCS_DIR.iterdir(), key=lambda p: p.name.lower()) if p.is_file()]


def save_doc(filename: str, stream) -> dict:
    """Store an uploaded file (``stream`` has ``.read``); never overwrites an existing document."""
    name = _safe_doc_name(filename)
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    stem, ext = os.path.splitext(name)
    target, n = DOCS_DIR / name, 1
    while target.exists():
        n += 1
        target = DOCS_DIR / f"{stem} ({n}){ext}"
    size = 0
    try:
        with open(target, "wb") as fh:
            while chunk := stream.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_DOC_BYTES:
                    raise ValueError("File is larger than 200 MB")
                fh.write(chunk)
    except Exception:
        target.unlink(missing_ok=True)
        raise
    return {"name": target.name}


def delete_doc(name: str) -> bool:
    path = DOCS_DIR / Path(name).name
    if path.parent != DOCS_DIR or not path.is_file():
        return False
    path.unlink()
    return True


# ---------------------------------------------------------------- research jobs

def _minimal_env(tmp: Path) -> dict:
    """Whitelisted environment: no inherited API keys, tokens or tracing switches."""
    env = {}
    for key in ("SYSTEMROOT", "SystemDrive", "WINDIR", "COMSPEC", "PATHEXT", "NUMBER_OF_PROCESSORS",
                "PROCESSOR_ARCHITECTURE", "OS"):
        if os.environ.get(key):
            env[key] = os.environ[key]
    root = os.environ.get("SYSTEMROOT", r"C:\Windows")
    env["PATH"] = os.pathsep.join([str(VENV_DIR / "Scripts"), rf"{root}\System32"]) if os.name == "nt" else "/usr/bin:/bin"
    tmp.mkdir(parents=True, exist_ok=True)
    HOME_DIR.mkdir(parents=True, exist_ok=True)
    env.update(TEMP=str(tmp), TMP=str(tmp), TMPDIR=str(tmp), USERPROFILE=str(HOME_DIR), HOME=str(HOME_DIR),
               APPDATA=str(HOME_DIR / "AppData" / "Roaming"), LOCALAPPDATA=str(HOME_DIR / "AppData" / "Local"),
               PYTHONUTF8="1", PYTHONUNBUFFERED="1", PYTHONNOUSERSITE="1")
    return env


def _runner_env(job: dict, job_dir: Path) -> dict:
    env = _minimal_env(job_dir / "tmp")
    env.update(TIKTOKEN_CACHE_DIR=str(CACHE_DIR / "tiktoken"),
               OLLAMA_BASE_URL=OLLAMA_URL, OLLAMA_HOST=OLLAMA_URL,
               CONFIG_PATH=str(job_dir / "config.json"),
               LANGCHAIN_TRACING_V2="false", LANGSMITH_TRACING="false", MONOCLE_TRACING="false",
               ANONYMIZED_TELEMETRY="False", DO_NOT_TRACK="1", HF_HUB_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1",
               CONTEXT_FILTER="keyword", IMAGE_GENERATION_ENABLED="false")
    if job["source"] == "local":
        env["NO_PROXY"] = "*"
    else:
        # Corporate proxies / CA bundles are needed for web mode; Ollama itself stays direct.
        for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy",
                    "SSL_CERT_FILE", "REQUESTS_CA_BUNDLE"):
            if os.environ.get(key):
                env[key] = os.environ[key]
        env["NO_PROXY"] = "127.0.0.1,localhost,::1"
    return env


def _config(job: dict, docs_dir: Path) -> dict:
    llm = f"ollama:{job['model']}"
    broad = job["report_type"] in ("deep", "detailed_report")
    return {
        "FAST_LLM": llm, "SMART_LLM": llm, "STRATEGIC_LLM": llm,
        "EMBEDDING": f"ollama:{EMBED_MODEL}",
        "CONTEXT_FILTER": "keyword",
        "RETRIEVER": ",".join(job["retrievers"]) if job["source"] != "local" else "arxiv",
        "REPORT_SOURCE": job["source"],
        "DOC_PATH": str(docs_dir),
        "LLM_KWARGS": {"num_ctx": job["num_ctx"], "reasoning": False},
        "TEMPERATURE": 0.3,
        "TOTAL_WORDS": job["total_words"],
        "FAST_TOKEN_LIMIT": 2000, "SMART_TOKEN_LIMIT": 6000, "STRATEGIC_TOKEN_LIMIT": 3000,
        "MAX_SEARCH_RESULTS_PER_QUERY": 5,
        "MAX_ITERATIONS": 4 if broad else 2,
        "MAX_SUBTOPICS": 3,
        "DEEP_RESEARCH_BREADTH": 2, "DEEP_RESEARCH_DEPTH": 1, "DEEP_RESEARCH_CONCURRENCY": 1,
        "CURATE_SOURCES": False,
        "SCRAPER_RATE_LIMIT_DELAY": SCRAPER_DELAY_S,
        "USER_AGENT": USER_AGENT,
        "MAX_SCRAPER_WORKERS": 4,
        "MCP_STRATEGY": "disabled",
    }


def _report_dir(report_id: str) -> Optional[Path]:
    if not _ID_RE.match(report_id or ""):
        return None
    path = REPORTS_DIR / report_id
    return path if path.is_dir() else None


def _watch(proc: subprocess.Popen, job_dir: Path, meta: dict) -> None:
    global _proc
    assert proc.stdout is not None
    started = time.time()
    killer = threading.Timer(MAX_RUN_S, lambda: _kill_tree(proc.pid))
    killer.daemon = True
    killer.start()
    with open(job_dir / "log.txt", "a", encoding="utf-8", errors="replace") as fh:
        for raw in proc.stdout:
            line = _ANSI_RE.sub("", raw).rstrip()
            if not line:
                continue
            fh.write(line + "\n")
            fh.flush()
            if line.startswith("@@phase "):
                _RUN["phase"] = line[8:].strip()
            elif line.startswith("@@log "):
                _run_log.append(line[6:][:400])
            elif not line.startswith("INFO:"):  # the engine prints each message twice; keep the plain one
                _run_log.append(line[:400])
    code = proc.wait()
    killer.cancel()
    with _LOCK:
        cancelled = _RUN["state"] == "cancelling"
        result = _read_json(job_dir / "result.json", {})
        error = _read_json(job_dir / "error.json", {})
        if cancelled:
            state, message = "cancelled", None
        elif code == 0 and (job_dir / "report.md").exists():
            state, message = "done", None
        else:
            message = error.get("error") or (f"Stopped after {MAX_RUN_S // 60} minutes" if time.time() - started >= MAX_RUN_S
                                              else f"The research process exited with code {code}")
            state = "error"
        saved = _read_json(job_dir / "meta.json", {})  # keep a rename / folder move made while the job ran
        meta.update({k: saved[k] for k in ("title", "folder") if k in saved})
        meta.update(state=state, error=message, finished_at=_now_iso(), **{k: result[k] for k in ("seconds", "words", "sources") if k in result})
        _write_json(job_dir / "meta.json", meta)
        shutil.rmtree(job_dir / "tmp", ignore_errors=True)
        shutil.rmtree(job_dir / "docs", ignore_errors=True)
        _RUN.update(state=state, error=message, phase="")
        _proc = None


def start_research(payload: dict) -> dict:
    global _proc
    query = str(payload.get("query") or "").strip()
    if not query or len(query) > 2000:
        raise ValueError("Enter a research question (up to 2000 characters)")
    report_type = payload.get("report_type", "detailed_report")
    source = payload.get("source", "local")
    if report_type not in REPORT_TYPES or source not in SOURCES:
        raise ValueError("Unknown report type or source")
    retrievers = [r for r in (payload.get("retrievers") or []) if r in RETRIEVERS]
    if source != "local" and not retrievers:
        raise ValueError("Choose at least one web source")
    tone = payload.get("tone", "objective")
    if tone not in TONES:
        tone = "objective"
    try:
        total_words = max(300, min(3000, int(payload.get("total_words") or DEFAULT_WORDS)))
        num_ctx = max(4096, min(32768, int(payload.get("num_ctx") or 8192)))
    except (TypeError, ValueError):
        raise ValueError("Invalid number")

    if engine_version() != target_version():
        raise RuntimeError("The research engine is not installed yet")
    models = ollama_models()
    if models is None:
        raise RuntimeError("Ollama is not running. Start Ollama and try again")
    model = str(payload.get("model") or "")
    if model not in [m["name"] for m in models] or not _is_chat_model(model):
        raise ValueError("Choose one of the installed chat models")

    selected = payload.get("docs")
    docs = [d["name"] for d in list_docs() if selected is None or d["name"] in selected]
    if source != "web" and not docs:
        raise ValueError("Add at least one document to the library first, or switch to web search")

    with _LOCK:
        if _RUN["state"] in ("running", "cancelling") or _INSTALL["state"] == "running":
            raise RuntimeError("Another job is already running")
        if _UPDATE["state"] == "running":
            raise RuntimeError("The engine is being updated; try again when it has finished")
        report_id = f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:4]}"
        job_dir = REPORTS_DIR / report_id
        docs_dir = job_dir / "docs"
        docs_dir.mkdir(parents=True)
        for name in docs:
            shutil.copy2(DOCS_DIR / name, docs_dir / name)
        job = {"query": query, "report_type": report_type, "source": source, "model": model, "tone": tone,
               "retrievers": retrievers, "total_words": total_words, "num_ctx": num_ctx,
               "agent": "Electroacoustic Engineering Research Agent", "role": ROLE, "max_subtopics": 3,
               "user_agent": USER_AGENT}
        _write_json(job_dir / "job.json", job)
        _write_json(job_dir / "config.json", _config(job, docs_dir))
        meta = {"id": report_id, "query": query, "report_type": report_type, "source": source, "model": model,
                "retrievers": retrievers, "docs": docs if source != "web" else [], "created_at": _now_iso(),
                "state": "running", "error": None}
        _write_json(job_dir / "meta.json", meta)
        flags = _NO_WINDOW | (getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) if os.name == "nt" else 0)
        _run_log.clear()
        _proc = subprocess.Popen([str(venv_python()), "-X", "utf8", str(RUNNER), str(job_dir)],
                                 cwd=str(job_dir), env=_runner_env(job, job_dir), stdin=subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                                 errors="replace", creationflags=flags)
        _RUN.update(id=report_id, state="running", phase="starting", error=None, started_at=_now_iso())
        threading.Thread(target=_watch, args=(_proc, job_dir, meta), name="gpt-researcher-run", daemon=True).start()
    return status()


def _kill_tree(pid: int) -> None:
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, timeout=30,
                       creationflags=_NO_WINDOW)
    else:
        try:
            os.kill(pid, 15)
        except OSError:
            pass


def cancel_research() -> dict:
    with _LOCK:
        if _proc is not None and _proc.poll() is None:
            _RUN["state"] = "cancelling"
            _kill_tree(_proc.pid)
    return status()


atexit.register(lambda: _proc is not None and _proc.poll() is None and _kill_tree(_proc.pid))


# ---------------------------------------------------------------- reports

_CITE_RE = re.compile(r"\[(\d{1,3}(?:\s*[,;]\s*\d{1,3})*)\](?!\()")


def _renumber_references(text: str) -> str:
    """Number references 1, 2, 3... in order of first citation (the engine keeps its internal source numbers)."""
    lines = text.split("\n")
    start = next((i for i, ln in enumerate(lines) if re.match(r"^#{1,6}\s*references\s*$", ln, re.I)), None)
    if start is None:
        return text
    end = next((i for i in range(start + 1, len(lines)) if re.match(r"^#{1,6}\s", lines[i])), len(lines))
    entries: dict = {}
    for ln in lines[start + 1:end]:
        if not ln.strip():
            continue
        found = re.match(r"^\s*\[(\d{1,3})\]\s+(\S.*)$", ln)
        if not found or found.group(1) in entries:
            return text  # unexpected layout: leave the report as written
        entries[found.group(1)] = found.group(2)
    if not entries:
        return text
    body_lines = lines[:start] + lines[end:]
    order: dict = {}
    for match in _CITE_RE.finditer("\n".join(body_lines)):
        for old in re.split(r"\s*[,;]\s*", match.group(1)):
            if old in entries and old not in order:
                order[old] = str(len(order) + 1)
    for old in entries:  # references nobody cites keep their place after the cited ones
        order.setdefault(old, str(len(order) + 1))

    def renumber(match):
        return "[" + ", ".join(order.get(n, n) for n in re.split(r"\s*[,;]\s*", match.group(1))) + "]"

    head = _CITE_RE.sub(renumber, "\n".join(lines[:start])).split("\n") + [lines[start], ""]
    tail = _CITE_RE.sub(renumber, "\n".join(lines[end:])).split("\n") if end < len(lines) else []
    refs: list = []
    for old, entry in sorted(entries.items(), key=lambda kv: int(order[kv[0]])):
        refs += [f"[{order[old]}] {entry}", ""]
    return "\n".join(head + refs + tail)


def _separate_references(text: str) -> str:
    """Put each "[n] ..." reference on its own paragraph; Markdown otherwise runs them into one block."""
    lines, out, in_refs = text.split("\n"), [], False
    for i, line in enumerate(lines):
        if re.match(r"^#{1,6}\s", line):
            in_refs = bool(re.match(r"^#{1,6}\s*(references|sources|bibliography)\s*$", line, re.I))
        out.append(line)
        if in_refs and _REF_LINE.match(line) and i + 1 < len(lines) and _REF_LINE.match(lines[i + 1]):
            out.append("")
    return "\n".join(out)


def _clean_report_file(report: Path) -> None:
    """Replace LaTeX math by plain text in place (the original is kept once as report.orig.md)."""
    try:
        text = report.read_text(encoding="utf-8", errors="replace")
        cleaned = _separate_references(_renumber_references(mathtext.clean_math(text)))
        if cleaned != text:
            backup = report.with_name("report.orig.md")
            if not backup.exists():
                backup.write_text(text, encoding="utf-8")
            report.write_text(cleaned, encoding="utf-8")
    except OSError:
        pass

def list_reports() -> list:
    out = []
    if REPORTS_DIR.is_dir():
        for path in sorted(REPORTS_DIR.iterdir(), reverse=True):
            meta = _read_json(path / "meta.json", None)
            if not isinstance(meta, dict) or not _ID_RE.match(path.name):
                continue
            if meta.get("state") == "running" and _RUN["id"] != path.name:
                meta["state"] = "interrupted"
            out.append({k: meta.get(k) for k in ("id", "query", "title", "folder", "report_type", "source", "model", "created_at",
                                                 "state", "error", "words", "seconds")})
    return out


def get_report(report_id: str) -> Optional[dict]:
    path = _report_dir(report_id)
    if path is None:
        return None
    meta = _read_json(path / "meta.json", {})
    report = path / "report.md"
    _clean_report_file(report)
    return {"meta": meta, "markdown": report.read_text(encoding="utf-8", errors="replace") if report.exists() else ""}


def report_file(report_id: str) -> Optional[Path]:
    path = _report_dir(report_id)
    if path and (path / "report.md").exists():
        _clean_report_file(path / "report.md")
        return path / "report.md"
    return None


def report_pdf(report_id: str) -> Optional[Path]:
    """PDF of a finished report, rendered on demand in the private venv and cached next to the Markdown."""
    markdown = report_file(report_id)
    if markdown is None:
        return None
    pdf = markdown.with_name("report.pdf")
    if pdf.exists() and pdf.stat().st_mtime >= max(markdown.stat().st_mtime, EXPORT_SCRIPT.stat().st_mtime):
        return pdf
    if engine_version() is None:
        raise RuntimeError("The research engine is not installed, so PDF export is unavailable")
    tmp = markdown.parent / "tmp"
    try:
        done = subprocess.run([str(venv_python()), "-X", "utf8", str(EXPORT_SCRIPT), str(markdown.parent)],
                              cwd=str(markdown.parent), env=_minimal_env(tmp), capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=180, creationflags=_NO_WINDOW)
    except subprocess.TimeoutExpired:
        raise RuntimeError("PDF export timed out")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if done.returncode != 0 or not pdf.exists():
        raise RuntimeError(f"PDF export failed: {(done.stderr or done.stdout).strip()[-300:]}")
    return pdf


def _label(value, limit: int) -> str:
    return re.sub(r"[\x00-\x1f\x7f]+", " ", str(value or "")).strip()[:limit]


def list_folders() -> list:
    data = _read_json(FOLDERS_FILE, {})
    out = []
    for item in data.get("folders", []) if isinstance(data, dict) else []:
        if isinstance(item, dict) and _FOLDER_ID_RE.match(str(item.get("id", ""))) and item.get("name"):
            out.append({"id": item["id"], "name": str(item["name"])})
    return out


def _folder_name_taken(folders: list, name: str, ignore: Optional[str] = None) -> bool:
    return any(f["name"].lower() == name.lower() for f in folders if f["id"] != ignore)


def create_folder(name: str) -> dict:
    with _LOCK:
        folders = list_folders()
        base = _label(name, 60) or "New folder"
        name, n = base, 1
        while _folder_name_taken(folders, name):
            n += 1
            name = f"{base} ({n})"
        folder = {"id": uuid.uuid4().hex[:8], "name": name}
        _write_json(FOLDERS_FILE, {"folders": folders + [folder]})
    return folder


def rename_folder(folder_id: str, name: str) -> Optional[dict]:
    name = _label(name, 60)
    if not name:
        raise ValueError("Enter a folder name")
    with _LOCK:
        folders = list_folders()
        target = next((f for f in folders if f["id"] == folder_id), None)
        if target is None:
            return None
        if _folder_name_taken(folders, name, ignore=folder_id):
            raise ValueError("A folder with this name already exists")
        target["name"] = name
        _write_json(FOLDERS_FILE, {"folders": folders})
    return target


def delete_folder(folder_id: str) -> bool:
    """Remove the folder only; its reports are kept and become unfiled."""
    with _LOCK:
        folders = list_folders()
        if not any(f["id"] == folder_id for f in folders):
            return False
        _write_json(FOLDERS_FILE, {"folders": [f for f in folders if f["id"] != folder_id]})
        if REPORTS_DIR.is_dir():
            for path in REPORTS_DIR.iterdir():
                meta = _read_json(path / "meta.json", None)
                if isinstance(meta, dict) and meta.get("folder") == folder_id:
                    meta.pop("folder")
                    _write_json(path / "meta.json", meta)
    return True


def update_report(report_id: str, patch: dict) -> Optional[dict]:
    """Rename a report (``title``; empty resets to the question) and/or move it (``folder``; empty = unfiled)."""
    path = _report_dir(report_id)
    if path is None:
        return None
    with _LOCK:
        meta = _read_json(path / "meta.json", None)
        if not isinstance(meta, dict):
            return None
        if "title" in patch:
            title = _label(patch["title"], 200)
            if title:
                meta["title"] = title
            else:
                meta.pop("title", None)
        if "folder" in patch:
            folder = patch["folder"]
            if not folder:
                meta.pop("folder", None)
            elif any(f["id"] == folder for f in list_folders()):
                meta["folder"] = folder
            else:
                raise ValueError("Unknown folder")
        _write_json(path / "meta.json", meta)
    return {k: meta.get(k) for k in ("id", "query", "title", "folder")}


def delete_report(report_id: str) -> bool:
    path = _report_dir(report_id)
    if path is None or (_RUN["id"] == report_id and _RUN["state"] in ("running", "cancelling")):
        return False
    shutil.rmtree(path, ignore_errors=True)
    return True


# ---------------------------------------------------------------- engine updates
# A new upstream release is installed into a separate venv (venv-next), vetted by _compat.py and a tiny
# offline test job, and only then swapped in. The old venv becomes venv-prev for one-click rollback, so
# a bad release can never replace a working engine.

RELEASES_URL = "https://github.com/assafelovic/gpt-researcher/releases"
TEST_QUERY = "What are the sensitivity, signal-to-noise ratio and acoustic overload point of the EX-100 microphone?"
TEST_DOC = (
    "Datasheet summary of the EX-100 MEMS microphone (fictional, used only to test the research engine).\n"
    "Sensitivity: -38 dBV at 94 dB SPL, 1 kHz. Signal-to-noise ratio: 64 dB(A). "
    "Acoustic overload point: 130 dB SPL at 10 % THD. Package: 3.5 x 2.65 x 0.98 mm, bottom port.\n"
)


class _Rejected(Exception):
    def __init__(self, message: str, remember: bool = True):
        super().__init__(message)
        self.remember = remember


def _state() -> dict:
    data = _read_json(STATE_FILE, {})
    return data if isinstance(data, dict) else {}


def _save_state(**patch) -> None:
    with _LOCK:
        data = _state()
        data.update(patch)
        _write_json(STATE_FILE, data)


def target_version() -> str:
    """The engine version this plugin expects: the last verified one, else the built-in baseline."""
    verified = _state().get("verified")
    return verified if isinstance(verified, str) and _VER_RE.match(verified) else ENGINE_VERSION


def _vkey(version: str) -> tuple:
    return tuple(int(part) for part in version.split("."))


def _log_update(line: str) -> None:
    line = _ANSI_RE.sub("", line).rstrip()
    if line:
        _update_log.append(line[:300])


def _step(step: str, message: str) -> None:
    _UPDATE.update(step=step, message=message)
    _log_update(f"== {message}")


def _busy() -> Optional[str]:
    if _RUN["state"] in ("running", "cancelling"):
        return "A research job is running"
    if _INSTALL["state"] == "running":
        return "The engine is being installed"
    if _UPDATE["state"] == "running":
        return "An engine update is already running"
    return None


def check_update() -> None:
    """Ask PyPI for the newest release (a single GET; nothing about the user or documents is sent)."""
    try:
        request = urllib.request.Request(PYPI_URL, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        with urllib.request.urlopen(request, timeout=15) as resp:
            data = json.loads(resp.read(4_000_000).decode("utf-8"))
        info = data["info"]
        version = str(info["version"])
        if not _VER_RE.match(version) or info.get("yanked"):
            raise ValueError(f"unusable latest version {version!r}")
        stamps = [f["upload_time_iso_8601"] for f in data.get("urls", []) if f.get("upload_time_iso_8601")]
        _save_state(latest=version, latest_uploaded=min(stamps) if stamps else None,
                    requires_python=info.get("requires_python"), checked_at=_now_iso(), check_error=None)
    except Exception as exc:
        _save_state(checked_at=_now_iso(), check_error=f"{type(exc).__name__}: {exc}")


def _functional_plan() -> tuple:
    """(model, "") when a real test job can run, else (None, reason)."""
    models = ollama_models()
    if models is None:
        return None, "Ollama is not running"
    if not any(str(m.get("name", "")).split(":")[0] == EMBED_MODEL for m in models):
        return None, f"the embedding model {EMBED_MODEL} is not installed"
    chat = chat_models(models)
    if not chat:
        return None, "no chat model is installed"
    pool = [m for m in chat if m["recommended"]] or chat
    return min(pool, key=lambda m: m["size_gb"])["name"], ""


def _test_job(model: str, hybrid: bool) -> dict:
    return {"query": TEST_QUERY, "report_type": "detailed_report" if hybrid else "research_report",
            "source": "hybrid" if hybrid else "local", "model": model, "tone": "objective",
            "retrievers": list(RETRIEVERS) if hybrid else [], "total_words": 300, "num_ctx": 8192,
            "agent": "Electroacoustic Engineering Research Agent", "role": ROLE, "max_subtopics": 1,
            "user_agent": USER_AGENT}


def _prepare_job(job_dir: Path, job: dict) -> None:
    docs = job_dir / "docs"
    docs.mkdir(parents=True, exist_ok=True)
    (docs / "ex100.txt").write_text(TEST_DOC, encoding="utf-8")
    _write_json(job_dir / "job.json", job)
    _write_json(job_dir / "config.json", _config(job, docs))


def _static_check(venv: Path, test_dir: Path) -> tuple:
    job, job_dir = _test_job("probe", hybrid=True), test_dir / "static"
    _prepare_job(job_dir, job)
    try:
        done = subprocess.run([str(venv_python(venv)), "-X", "utf8", str(COMPAT), str(job_dir / "config.json"), "--deep"],
                              cwd=str(job_dir), env=_runner_env(job, job_dir), capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=300, creationflags=_NO_WINDOW)
    except subprocess.TimeoutExpired:
        return ["The compatibility check timed out"], []
    for line in reversed((done.stdout or "").splitlines()):
        if line.startswith("@@compat "):
            result = json.loads(line[len("@@compat "):])
            return list(result.get("errors", [])), list(result.get("warnings", []))
    tail = _ANSI_RE.sub("", (done.stderr or done.stdout or "").strip())[-300:]
    return [f"The compatibility check crashed: {tail}"], []


def _functional_test(venv: Path, test_dir: Path, model: str) -> tuple:
    job, job_dir = _test_job(model, hybrid=False), test_dir / "functional"
    _prepare_job(job_dir, job)
    flags = _NO_WINDOW | (getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) if os.name == "nt" else 0)
    proc = subprocess.Popen([str(venv_python(venv)), "-X", "utf8", str(RUNNER), str(job_dir)], cwd=str(job_dir),
                            env=_runner_env(job, job_dir), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", creationflags=flags)
    try:
        out, _ = proc.communicate(timeout=TEST_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        _kill_tree(proc.pid)
        return "failed", f"timed out after {TEST_TIMEOUT_S // 60} minutes"
    for line in out.splitlines()[-15:]:
        if not line.startswith("INFO:"):
            _log_update(line[6:] if line.startswith("@@log ") else line)
    report = job_dir / "report.md"
    words = len(report.read_text(encoding="utf-8", errors="replace").split()) if report.exists() else 0
    if proc.returncode == 0 and words >= 40:
        return "passed", f"{words}-word report written with {model}"
    error = _read_json(job_dir / "error.json", {}).get("error")
    return "failed", error or f"exit code {proc.returncode}, {words} words"


def _rename(src: Path, dst: Path) -> None:
    for attempt in range(5):  # antivirus / indexers can briefly hold files on Windows
        try:
            os.rename(src, dst)
            return
        except OSError:
            if attempt == 4:
                raise
            time.sleep(1.5)


def _sanity(venv: Path, version: str) -> bool:
    probe = "import gpt_researcher, importlib.metadata as m; print(m.version('gpt-researcher'))"
    try:
        done = subprocess.run([str(venv_python(venv)), "-X", "utf8", "-c", probe], capture_output=True, text=True,
                              timeout=180, env=_minimal_env(TEST_DIR / "sanity"), creationflags=_NO_WINDOW)
    except Exception:
        return False
    finally:
        shutil.rmtree(TEST_DIR / "sanity", ignore_errors=True)
    return done.returncode == 0 and done.stdout.strip().endswith(version)


def _swap_in(new: str) -> None:
    with _LOCK:
        if _RUN["state"] in ("running", "cancelling"):
            raise RuntimeError("A research job started; the engine was not switched")
        shutil.rmtree(VENV_PREV, ignore_errors=True)
        if VENV_PREV.exists():
            raise RuntimeError("Cannot remove the old engine backup (files in use)")
        _rename(VENV_DIR, VENV_PREV)
        try:
            _rename(VENV_NEXT, VENV_DIR)
        except Exception:
            _rename(VENV_PREV, VENV_DIR)
            raise
        if not _sanity(VENV_DIR, new):  # a moved venv must still start; otherwise put the old one back
            _rename(VENV_DIR, VENV_NEXT)
            _rename(VENV_PREV, VENV_DIR)
            raise RuntimeError("The new engine did not start after the switch; the previous engine was restored")


def _update_main(old: str, new: str, auto: bool) -> None:
    test_dir = TEST_DIR / uuid.uuid4().hex[:8]
    checks = {"static": None, "functional": {"state": "pending", "detail": ""}}
    _UPDATE["checks"] = checks
    try:
        _step("prepare", f"Creating a separate copy of the engine for {new}")
        _make_venv(VENV_NEXT, _log_update)
        _step("install", f"Installing gpt-researcher {new} (a few hundred MB)")
        _pip_install(VENV_NEXT, new, _log_update)
        _warm_tiktoken(VENV_NEXT, _log_update)
        _step("compat", "Checking that the new engine still fits this plugin")
        errors, warnings = _static_check(VENV_NEXT, test_dir)
        checks["static"] = {"errors": errors, "warnings": warnings}
        for warning in warnings:
            _log_update(f"warning: {warning}")
        if errors:
            raise _Rejected("Not compatible with this plugin: " + "; ".join(errors))
        model, reason = _functional_plan()
        if model is None:
            checks["functional"] = {"state": "skipped", "detail": reason}
            if auto:
                raise _Rejected(f"An automatic update needs the test job, but {reason}", remember=False)
        else:
            _step("test", f"Running a small offline test job with {model} (a few minutes)")
            outcome, detail = _functional_test(VENV_NEXT, test_dir, model)
            checks["functional"] = {"state": outcome, "detail": detail}
            if outcome != "passed":
                raise _Rejected(f"The test research job failed: {detail}")
        _step("swap", "Switching to the new engine")
        _swap_in(new)
        failed = [v for v in _state().get("failed_versions", []) if v != new]
        _save_state(verified=new, failed_versions=failed, last_update={
            "at": _now_iso(), "from": old, "to": new, "result": "updated", "auto": auto,
            "detail": checks["functional"]["detail"] or checks["functional"]["state"], "warnings": warnings})
        _UPDATE.update(state="done", step="done", message=f"Updated to {new}. The previous engine is kept for rollback.", error=None)
    except Exception as exc:
        message = f"{exc}" if isinstance(exc, _Rejected) else f"{type(exc).__name__}: {exc}"
        patch = {"last_update": {"at": _now_iso(), "from": old, "to": new, "result": "rejected" if isinstance(exc, _Rejected) else "error",
                                 "auto": auto, "detail": message}}
        if isinstance(exc, _Rejected) and exc.remember:
            patch["failed_versions"] = sorted({*_state().get("failed_versions", []), new})
        _save_state(**patch)
        _UPDATE.update(state="error", step="failed", message="The update was not applied; the current engine is unchanged", error=message)
        _log_update(f"!! {message}")
    finally:
        shutil.rmtree(VENV_NEXT, ignore_errors=True)
        shutil.rmtree(test_dir, ignore_errors=True)


def start_update(auto: bool = False) -> dict:
    with _LOCK:
        busy = _busy()
        if busy:
            raise RuntimeError(busy)
        old, state = engine_version(), _state()
        if old is None or old != target_version():
            raise RuntimeError("Install the research engine first")
        latest = state.get("latest")
        if not latest or _vkey(latest) <= _vkey(old):
            raise RuntimeError("No newer engine version is known; check for updates first")
        _update_log.clear()
        _UPDATE.update(state="running", step="starting", message="Starting the update", error=None,
                       **{"from": old, "to": latest, "auto": auto, "checks": None})
        threading.Thread(target=_update_main, args=(old, latest, auto), name="gpt-researcher-update", daemon=True).start()
    return status()


def rollback_engine() -> dict:
    with _LOCK:
        busy = _busy()
        if busy:
            raise RuntimeError(busy)
        current, previous = engine_version(), engine_version(VENV_PREV)
        if previous is None:
            raise RuntimeError("There is no previous engine to restore")
        shutil.rmtree(VENV_SWAP, ignore_errors=True)
        _rename(VENV_DIR, VENV_SWAP)
        try:
            _rename(VENV_PREV, VENV_DIR)
        except Exception:
            _rename(VENV_SWAP, VENV_DIR)
            raise
        _rename(VENV_SWAP, VENV_PREV)  # the engine rolled back from stays available as the backup
        _save_state(verified=previous, failed_versions=sorted({*_state().get("failed_versions", []), *([current] if current else [])}),
                    last_update={"at": _now_iso(), "from": current, "to": previous, "result": "rolled_back", "auto": False,
                                 "detail": "Restored the previous engine"})
        _update_log.clear()
        _UPDATE.update(state="idle", step="", message="", error=None, checks=None)
    return status()


def set_auto_update(enabled: bool) -> dict:
    _save_state(auto_update=bool(enabled))
    return status()


def _auto_candidate() -> Optional[str]:
    """Newest version that may be installed unattended (same major, not failed before, not brand new)."""
    state = _state()
    installed, latest = engine_version(), state.get("latest")
    if not state.get("auto_update") or not installed or not latest or installed != target_version():
        return None
    if _vkey(latest) <= _vkey(installed) or _vkey(latest)[0] != _vkey(installed)[0]:
        return None
    if latest in state.get("failed_versions", []):
        return None
    try:
        uploaded = datetime.fromisoformat(str(state.get("latest_uploaded")).replace("Z", "+00:00"))
    except ValueError:
        return None
    if datetime.now(timezone.utc) - uploaded < timedelta(hours=AUTO_MIN_AGE_H):
        return None
    return latest if _functional_plan()[0] else None


def _scheduler() -> None:
    time.sleep(120)
    while True:
        delay = CHECK_EVERY_S
        try:
            if engine_version() is not None:
                check_update()
                if _auto_candidate():
                    try:
                        start_update(auto=True)
                    except RuntimeError:
                        delay = 900
        except Exception:
            pass
        time.sleep(delay)


threading.Thread(target=_scheduler, name="gpt-researcher-update-check", daemon=True).start()


# ---------------------------------------------------------------- status

def status() -> dict:
    models = ollama_models()
    version = engine_version()
    state = _state()
    latest = state.get("latest")
    return {
        "engine": {"installed": version is not None, "version": version, "pinned": target_version(),
                   "current": version == target_version(), "uv_available": bool(shutil.which("uv")),
                   "latest": latest, "update_available": bool(version and latest and _vkey(latest) > _vkey(version)),
                   "checked_at": state.get("checked_at"), "check_error": state.get("check_error"),
                   "auto_update": bool(state.get("auto_update")), "previous": engine_version(VENV_PREV),
                   "last_update": state.get("last_update"), "release_notes": RELEASES_URL},
        "update": {**_UPDATE, "log": list(_update_log)[-60:]},
        "install": {**_INSTALL, "log": list(_install_log)[-60:]},
        "ollama": {"running": models is not None, "models": chat_models(models), "recommended": RECOMMENDED},
        "pull": dict(_PULL),
        "run": {**_RUN, "log": list(_run_log)[-120:]},
        "docs": list_docs(),
        "options": {"report_types": REPORT_TYPES, "sources": SOURCES, "retrievers": RETRIEVERS, "tones": TONES},
    }
