"""WeKnora Lite service supervisor & lifecycle manager for One EAD.

Manages WeKnora Lite (SQLite + in-memory queue, zero external dependencies)
optimized for local LLM inference under 6GB VRAM / 16GB RAM limits.
"""

from __future__ import annotations

import atexit
import collections
import ipaddress
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
import urllib.error
import urllib.parse
import urllib.request

MODULE_DIR = Path(__file__).resolve().parent
REPO_DIR = MODULE_DIR / "WeKnora"
def get_data_dir() -> Path:
    custom_vault = os.environ.get("ONEEAD_ARCHIVE_DIR")
    if custom_vault:
        p = Path(custom_vault) / "weknora_data"
        if p.exists():
            return p
    default_vault = Path.home() / "Documents" / "OneEAD_Archive" / "weknora_data"
    if default_vault.exists():
        return default_vault
    return MODULE_DIR / "data"

DATA_DIR = get_data_dir()
CONFIGS_DIR = MODULE_DIR / "configs"
ENV_FILE = MODULE_DIR / ".env.lite"
ENV_TEMPLATE = CONFIGS_DIR / ".env.lite.template"
LOG_FILE = DATA_DIR / "service.log"
BUILD_BAT = MODULE_DIR / "scripts" / "build_lite.bat"

BINARY_NAME = "WeKnora-lite.exe" if os.name == "nt" else "WeKnora-lite"
BINARY_PATH = MODULE_DIR / BINARY_NAME
FALLBACK_BINARY_PATH = REPO_DIR / BINARY_NAME

_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

_lock = threading.RLock()
_process: Optional[subprocess.Popen] = None
_logs: collections.deque = collections.deque(maxlen=1000)
_build_thread: Optional[threading.Thread] = None
_lite_setup_token: str = secrets.token_urlsafe(32)


def get_setup_token() -> str:
    """Returns the internal high-entropy token used for authenticating auto-setup."""
    global _lite_setup_token
    token_file = DATA_DIR / "setup_token.txt"
    if token_file.exists():
        try:
            with open(token_file, "r", encoding="utf-8") as f:
                content = f.read().strip()
                if content:
                    _lite_setup_token = content
                    return _lite_setup_token
        except Exception:
            pass

    if not _lite_setup_token:
        _lite_setup_token = secrets.token_urlsafe(32)
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            with open(token_file, "w", encoding="utf-8") as f:
                f.write(_lite_setup_token)
        except Exception:
            pass
    return _lite_setup_token


def verify_setup_token(provided_token: str) -> bool:
    """Safely verifies a provided desktop setup token in constant time."""
    expected = get_setup_token()
    if not provided_token or not expected:
        return False
    return secrets.compare_digest(provided_token, expected)
_build_status = {
    "building": False,
    "phase": "idle",
    "message": "",
    "error": None,
    "log": collections.deque(maxlen=300)
}

_watchdog_thread: Optional[threading.Thread] = None
_watchdog_stop_event = threading.Event()


def _run_math_watchdog() -> None:
    """Continuous background integrity watchdog for engineering formulas and Unicode."""
    try:
        from .tools.auto_heal_database import auto_heal_weknora_db
    except ImportError:
        try:
            from tools.auto_heal_database import auto_heal_weknora_db
        except ImportError:
            try:
                tools_path = str(MODULE_DIR / "tools")
                if tools_path not in sys.path:
                    sys.path.insert(0, tools_path)
                from auto_heal_database import auto_heal_weknora_db
            except Exception as exc:
                append_log(f"[Watchdog] Unable to load auto_heal_weknora_db: {exc}")
                return

    db_path = str(DATA_DIR / "weknora.db")
    while not _watchdog_stop_event.is_set():
        try:
            if Path(db_path).exists():
                repaired = auto_heal_weknora_db(db_path)
                if repaired > 0:
                    append_log(f"[Watchdog] Auto-healed {repaired} corrupted chunks in weknora.db.")
        except Exception as exc:
            append_log(f"[Watchdog] Error during database health check: {exc}")

        _watchdog_stop_event.wait(120.0)


def start_math_watchdog() -> None:
    """Starts the background math integrity watchdog thread if not running."""
    global _watchdog_thread, _watchdog_stop_event
    with _lock:
        if _watchdog_thread is None or not _watchdog_thread.is_alive():
            _watchdog_stop_event.clear()
            _watchdog_thread = threading.Thread(target=_run_math_watchdog, daemon=True, name="WeKnora-MathWatchdog")
            _watchdog_thread.start()
            append_log("[Watchdog] Math Integrity Watchdog started.")


def stop_math_watchdog() -> None:
    """Signals the math integrity watchdog thread to stop."""
    global _watchdog_stop_event
    _watchdog_stop_event.set()


def _ensure_paths() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "files").mkdir(parents=True, exist_ok=True)
    if not ENV_FILE.exists() and ENV_TEMPLATE.exists():
        shutil.copy2(ENV_TEMPLATE, ENV_FILE)

    dll_target = MODULE_DIR / "duckdb.dll"
    dll_source = REPO_DIR / "duckdb.dll"
    if not dll_target.exists() and dll_source.exists():
        try:
            shutil.copy2(dll_source, dll_target)
        except Exception:
            pass

    # Prepend portable toolchains to PATH if present
    tools_go = MODULE_DIR / "tools" / "go" / "bin"
    tools_gcc = MODULE_DIR / "tools" / "w64devkit" / "bin"
    path_entries = []
    if tools_go.exists() and str(tools_go) not in os.environ.get("PATH", ""):
        path_entries.append(str(tools_go))
    if tools_gcc.exists() and str(tools_gcc) not in os.environ.get("PATH", ""):
        path_entries.append(str(tools_gcc))
    if path_entries:
        os.environ["PATH"] = os.pathsep.join(path_entries) + os.pathsep + os.environ.get("PATH", "")


def append_log(line: str) -> None:
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    formatted = f"[{timestamp}] {line.rstrip()}"
    _logs.append(formatted)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(formatted + "\n")
    except Exception:
        pass


def get_active_binary() -> Optional[Path]:
    if BINARY_PATH.exists():
        return BINARY_PATH
    if FALLBACK_BINARY_PATH.exists():
        return FALLBACK_BINARY_PATH
    return None


def read_env() -> Dict[str, str]:
    _ensure_paths()
    env_vars: Dict[str, str] = {}
    if not ENV_FILE.exists():
        return env_vars
    try:
        with open(ENV_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, val = line.split("=", 1)
                    env_vars[key.strip()] = val.strip()
    except Exception as exc:
        append_log(f"Error reading .env.lite: {exc}")
    return env_vars


SAFE_PUBLIC_CONFIG_KEYS = {
    "SERVER_PORT",
    "PORT",
    "OLLAMA_BASE_URL",
    "LLM_MODEL_NAME",
    "EMBEDDING_MODEL_NAME",
    "CONCURRENCY_POOL_SIZE",
    "WEKNORA_CHAT_ATTACHMENT_OCR_CONCURRENCY",
    "WEKNORA_CHAT_ATTACHMENT_OCR_MAX_PAGES",
    "WEKNORA_CHAT_ATTACHMENT_WAIT_TIMEOUT_SEC",
    "WEKNORA_CHAT_ATTACHMENT_TTL_HOURS",
    "STREAM_MANAGER_TYPE",
    "DB_DRIVER",
    "RETRIEVE_DRIVER",
    "STORAGE_TYPE",
    "GIN_MODE",
    "LOG_LEVEL",
    "WEKNORA_LANGUAGE",
}

ALLOWED_CONFIG_KEYS = {
    "SERVER_PORT",
    "PORT",
    "OLLAMA_BASE_URL",
    "CONCURRENCY_POOL_SIZE",
    "WEKNORA_CHAT_ATTACHMENT_OCR_CONCURRENCY",
    "WEKNORA_CHAT_ATTACHMENT_OCR_MAX_PAGES",
    "WEKNORA_CHAT_ATTACHMENT_WAIT_TIMEOUT_SEC",
    "WEKNORA_CHAT_ATTACHMENT_TTL_HOURS",
    "STREAM_MANAGER_TYPE",
    "DB_DRIVER",
    "RETRIEVE_DRIVER",
    "STORAGE_TYPE",
    "LLM_MODEL_NAME",
    "EMBEDDING_MODEL_NAME",
    "GIN_MODE",
    "LOG_LEVEL",
    "WEKNORA_LANGUAGE",
}


def get_safe_config() -> Dict[str, str]:
    """Returns only non-sensitive configuration keys safe for frontend/API display."""
    raw = read_env()
    return {k: v for k, v in raw.items() if k in SAFE_PUBLIC_CONFIG_KEYS}


def validate_config_updates(updates: Dict[str, str]) -> Dict[str, str]:
    """Strictly validates configuration updates against an allowlist and value schemas."""
    validated: Dict[str, str] = {}
    for key, raw_val in updates.items():
        val = str(raw_val) if raw_val is not None else ""
        if "\r" in key or "\n" in key or "\r" in val or "\n" in val:
            raise ValueError(f"Newline characters not permitted in configuration: {key}")
        if key not in ALLOWED_CONFIG_KEYS:
            raise ValueError(f"Disallowed configuration key: '{key}'. Only safe operational settings can be updated.")

        if key in ("SERVER_PORT", "PORT"):
            try:
                port = int(val)
                if not (1024 <= port <= 65535):
                    raise ValueError
            except ValueError:
                raise ValueError(f"Invalid port: {val}. Must be an integer between 1024 and 65535.")
            validated["SERVER_PORT"] = str(port)
            validated["PORT"] = str(port)
        elif key in ("CONCURRENCY_POOL_SIZE", "WEKNORA_CHAT_ATTACHMENT_OCR_CONCURRENCY"):
            try:
                num = int(val)
                if not (1 <= num <= 32):
                    raise ValueError
            except ValueError:
                raise ValueError(f"Invalid concurrency for {key}: {val}. Must be between 1 and 32.")
            validated[key] = str(num)
        elif key == "WEKNORA_CHAT_ATTACHMENT_OCR_MAX_PAGES":
            try:
                num = int(val)
                if not (1 <= num <= 100):
                    raise ValueError
            except ValueError:
                raise ValueError(f"Invalid max pages: {val}. Must be between 1 and 100.")
            validated[key] = str(num)
        elif key == "WEKNORA_CHAT_ATTACHMENT_WAIT_TIMEOUT_SEC":
            try:
                num = int(val)
                if not (5 <= num <= 600):
                    raise ValueError
            except ValueError:
                raise ValueError(f"Invalid timeout: {val}. Must be between 5 and 600.")
            validated[key] = str(num)
        elif key == "WEKNORA_CHAT_ATTACHMENT_TTL_HOURS":
            try:
                num = int(val)
                if not (1 <= num <= 720):
                    raise ValueError
            except ValueError:
                raise ValueError(f"Invalid TTL hours for {key}: {val}. Must be between 1 and 720.")
            validated[key] = str(num)
        elif key == "OLLAMA_BASE_URL":
            canonical = canonicalize_ollama_url(val)
            if not canonical:
                raise ValueError(f"Invalid or unsafe OLLAMA_BASE_URL: '{val}'. Must be a local loopback URL on an approved port (e.g. http://127.0.0.1:11434).")
            validated[key] = canonical
        elif key == "STREAM_MANAGER_TYPE":
            val_clean = val.strip().lower()
            if val_clean != "memory":
                raise ValueError("Lite edition only supports STREAM_MANAGER_TYPE='memory'")
            validated[key] = "memory"
        elif key in ("DB_DRIVER", "RETRIEVE_DRIVER"):
            val_clean = val.strip().lower()
            if val_clean != "sqlite":
                raise ValueError(f"Lite edition only supports {key}='sqlite'")
            validated[key] = "sqlite"
        elif key == "STORAGE_TYPE":
            val_clean = val.strip().lower()
            if val_clean != "local":
                raise ValueError("Lite edition only supports STORAGE_TYPE='local'")
            validated[key] = "local"
        elif key == "GIN_MODE":
            val_clean = val.strip().lower()
            if val_clean not in ("debug", "release", "test"):
                raise ValueError("GIN_MODE must be one of: debug, release, test")
            validated[key] = val_clean
        elif key == "LOG_LEVEL":
            val_clean = val.strip().lower()
            if val_clean not in ("debug", "info", "warn", "warning", "error", "fatal"):
                raise ValueError("LOG_LEVEL must be one of: debug, info, warn, error, fatal")
            validated[key] = val_clean
        elif key in ("LLM_MODEL_NAME", "EMBEDDING_MODEL_NAME"):
            val_clean = val.strip()
            if not re.match(r"^[a-zA-Z0-9_\-\.:/]+$", val_clean) or len(val_clean) > 128:
                raise ValueError(f"Invalid model name: {val}. Allowed characters: alphanumeric, dash, underscore, dot, colon, slash.")
            validated[key] = val_clean
        elif key == "WEKNORA_LANGUAGE":
            val_clean = val.strip()
            if not re.match(r"^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$", val_clean):
                raise ValueError(f"Invalid language locale code: {val}. Must be a BCP-47 tag like en-US.")
            validated[key] = val_clean
        else:
            validated[key] = val.strip()
    return validated


def write_env(updates: Dict[str, str]) -> Dict[str, str]:
    _ensure_paths()
    validated_updates = validate_config_updates(updates)
    current = read_env()
    current.update(validated_updates)
    
    # Read template or existing file to preserve structure
    source_file = ENV_FILE if ENV_FILE.exists() else ENV_TEMPLATE
    output_lines: List[str] = []
    seen_keys = set()

    if source_file.exists():
        with open(source_file, "r", encoding="utf-8") as f:
            for line in f:
                stripped = line.strip()
                if stripped and not stripped.startswith("#") and "=" in stripped:
                    key = stripped.split("=", 1)[0].strip()
                    if key in current:
                        output_lines.append(f"{key}={current[key]}\n")
                        seen_keys.add(key)
                        continue
                output_lines.append(line)

    for k, v in current.items():
        if k not in seen_keys:
            output_lines.append(f"{k}={v}\n")

    with open(ENV_FILE, "w", encoding="utf-8") as f:
        f.writelines(output_lines)
    
    # Also keep WeKnora/.env.lite in sync if repo exists
    repo_env = REPO_DIR / ".env.lite"
    if REPO_DIR.exists():
        try:
            shutil.copy2(ENV_FILE, repo_env)
        except Exception:
            pass

    return get_safe_config()


def check_port(port: int, host: str = "127.0.0.1") -> bool:
    import socket
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.2)
            return s.connect_ex((host, port)) == 0
    except Exception:
        return False


def check_http_alive(port: int, host: str = "127.0.0.1") -> bool:
    """Verifies that an actual HTTP server is actively responding on the port."""
    try:
        req = urllib.request.Request(f"http://{host}:{port}/", headers={"User-Agent": "One-EAD-Health"})
        with urllib.request.urlopen(req, timeout=1.0) as resp:
            return resp.status < 500
    except Exception:
        return False


_tool_cache: Dict[str, tuple[bool, float]] = {}
_ollama_cache: Dict[str, tuple[Dict[str, Any], float]] = {}


def check_tool(cmd: str) -> bool:
    now = time.time()
    cached = _tool_cache.get(cmd)
    if cached and (now - cached[1] < 30.0):
        return cached[0]
    result = shutil.which(cmd) is not None
    _tool_cache[cmd] = (result, now)
    return result


APPROVED_OLLAMA_PORTS = {11434, 11435}


def canonicalize_ollama_url(url: str) -> Optional[str]:
    """Strictly validates and canonicalizes an Ollama URL for SSRF prevention.
    
    Permits only HTTP/HTTPS on local loopback hosts and approved Ollama ports (default 11434).
    Rejects remote hosts, credentials/userinfo, path/query injection, and unexpected ports.
    """
    if not url or not isinstance(url, str):
        return None
    url_clean = url.strip()
    if not url_clean:
        return None
    try:
        parsed = urllib.parse.urlsplit(url_clean)
    except Exception:
        return None

    # Scheme must be http or https (http is standard for local Ollama)
    if parsed.scheme not in ("http", "https"):
        return None

    # Disallow user credentials in URL
    if parsed.username or parsed.password or "@" in parsed.netloc:
        return None

    hostname = parsed.hostname
    if not hostname:
        return None
    hostname_clean = hostname.lower().strip("[]")

    is_loopback = False
    if hostname_clean in ("127.0.0.1", "localhost", "::1"):
        is_loopback = True
    else:
        try:
            ip = ipaddress.ip_address(hostname_clean)
            if ip.is_loopback:
                is_loopback = True
        except ValueError:
            return None

    if not is_loopback:
        return None

    port = parsed.port
    if port is None:
        port = 11434

    if port not in APPROVED_OLLAMA_PORTS:
        return None

    # Return clean canonical base URL
    return f"{parsed.scheme}://{hostname_clean}:{port}"


def is_safe_ollama_url(url: str) -> bool:
    """Validates that an Ollama URL strictly points to local loopback on an approved port."""
    return canonicalize_ollama_url(url) is not None


def check_ollama(url: Optional[str] = None, force_refresh: bool = False) -> Dict[str, Any]:
    if not url:
        cfg = read_env()
        url = cfg.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434")

    # Enforce loopback check to prevent SSRF and canonicalize URL
    canonical_url = canonicalize_ollama_url(url)
    if not canonical_url:
        return {
            "available": False,
            "url": url,
            "models": [],
            "error": "SSRF Protection: Only local loopback Ollama instances (127.0.0.1/localhost) on approved ports (11434) may be probed."
        }

    now = time.time()
    if not force_refresh:
        cached = _ollama_cache.get(canonical_url)
        if cached and (now - cached[1] < 15.0):
            return cached[0]

    endpoint = f"{canonical_url}/api/tags"
    try:
        req = urllib.request.Request(endpoint, headers={"User-Agent": "One-EAD-WeKnora"})
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            models = [m.get("name") for m in data.get("models", [])]
            res = {
                "available": True,
                "url": canonical_url,
                "models": models,
                "count": len(models)
            }
            _ollama_cache[canonical_url] = (res, now)
            return res
    except Exception as exc:
        res = {
            "available": False,
            "url": canonical_url,
            "models": [],
            "error": str(exc)
        }
        _ollama_cache[canonical_url] = (res, now)
        return res


def ensure_ollama_running(url: Optional[str] = None) -> bool:
    """Ensures the local Ollama server is running in background if available on system."""
    info = check_ollama(url)
    if info.get("available"):
        return True
    
    ollama_path = shutil.which("ollama")
    if not ollama_path:
        default_path = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Ollama" / "ollama.exe"
        if default_path.exists():
            ollama_path = str(default_path)
            
    if ollama_path:
        append_log(f"Auto-launching local Ollama server: {ollama_path} serve")
        try:
            subprocess.Popen([ollama_path, "serve"], creationflags=_NO_WINDOW)
            for _ in range(12):
                time.sleep(0.5)
                if check_ollama(url).get("available"):
                    append_log("Local Ollama service online.")
                    return True
        except Exception as exc:
            append_log(f"Failed to auto-start Ollama: {exc}")
    return False


def get_hardware_info() -> Dict[str, Any]:
    """Provides hardware profiles tailored for 6GB VRAM & 16GB RAM."""
    return {
        "target_vram_gb": 6,
        "target_ram_gb": 16,
        "mode": "lite",
        "budget": {
            "os_reserve_mb": 800,
            "embedding_mb": 300,
            "chat_model_mb": 4400,
            "kv_cache_buffer_mb": 644,
            "total_vram_mb": 6144,
        },
        "recommended_tiers": [
            {
                "tier": "Tier 1: Ultra-Fast & Safe (Zero OOM Risk)",
                "chat_model": "qwen2.5:3b",
                "chat_vram": "~2.0 GB",
                "embed_model": "nomic-embed-text",
                "embed_vram": "~275 MB",
                "total_vram": "~2.5 GB",
                "fit_rating": "Flawless",
                "pull_cmd": "ollama pull qwen2.5:3b && ollama pull nomic-embed-text"
            },
            {
                "tier": "Tier 2: Primary Engineering LLM",
                "chat_model": "qwen2.5:7b",
                "chat_vram": "~4.7 GB",
                "embed_model": "nomic-embed-text",
                "embed_vram": "~275 MB",
                "total_vram": "~5.0 GB",
                "fit_rating": "Recommended (Installed)",
                "pull_cmd": "ollama run qwen2.5:7b"
            },
            {
                "tier": "Tier 3: Reasoning Specialist (DeepSeek-R1)",
                "chat_model": "deepseek-r1:7b",
                "chat_vram": "~4.7 GB",
                "embed_model": "nomic-embed-text",
                "embed_vram": "~275 MB",
                "total_vram": "~5.1 GB",
                "fit_rating": "Feasible (4k context)",
                "pull_cmd": "ollama pull deepseek-r1:7b && ollama pull nomic-embed-text"
            }
        ]
    }


def status() -> Dict[str, Any]:
    _ensure_paths()
    cfg = read_env()
    port = int(cfg.get("SERVER_PORT", cfg.get("PORT", "8082")))
    host = cfg.get("SERVER_HOST", "127.0.0.1")
    binary = get_active_binary()
    repo_exists = (REPO_DIR / "cmd" / "server" / "main.go").exists()
    web_dist_exists = (REPO_DIR / "web" / "index.html").exists() or (REPO_DIR / "frontend" / "dist" / "index.html").exists()

    with _lock:
        is_proc_alive = _process is not None and _process.poll() is None
        http_alive = check_http_alive(port, host)
        is_running = is_proc_alive and http_alive
        if is_running:
            pid = _process.pid
            start_math_watchdog()
        elif is_proc_alive:
            pid = _process.pid
        elif http_alive:
            is_running = True
            pid = None
            start_math_watchdog()
        else:
            pid = None

    ollama_info = check_ollama(cfg.get("OLLAMA_BASE_URL"))

    tools = {
        "git": check_tool("git"),
        "node": check_tool("node"),
        "npm": check_tool("npm"),
        "go": check_tool("go"),
        "gcc": check_tool("gcc") or check_tool("clang"),
    }

    return {
        "name": "WeKnora Lite",
        "edition": "lite",
        "running": is_running,
        "pid": pid,
        "port": port,
        "host": host,
        "service_url": f"http://{host}:{port}",
        "proxy_url": f"/api/weknora/proxy",
        "installed": binary is not None,
        "binary_path": str(binary) if binary else None,
        "repo_exists": repo_exists,
        "frontend_built": web_dist_exists,
        "tools": tools,
        "ollama": ollama_info,
        "hardware": get_hardware_info(),
        "build": {
            "building": _build_status["building"],
            "phase": _build_status["phase"],
            "message": _build_status["message"],
            "error": _build_status["error"]
        },
        "watchdog": {
            "active": _watchdog_thread is not None and _watchdog_thread.is_alive(),
        },
        "config": get_safe_config(),
    }


def _pipe_output(proc: subprocess.Popen) -> None:
    stdout = proc.stdout
    if not stdout:
        return
    while True:
        try:
            line = stdout.readline()
            if not line:
                if proc.poll() is not None:
                    break
                time.sleep(0.02)
                continue
            if isinstance(line, bytes):
                line = line.decode("utf-8", errors="replace")
            append_log(line)
        except Exception as exc:
            append_log(f"[supervisor] stdout drain exception: {exc}")
            time.sleep(0.02)
            if proc.poll() is not None:
                break


def start_service() -> Dict[str, Any]:
    global _process
    with _lock:
        cfg = read_env()
        port = int(cfg.get("SERVER_PORT", cfg.get("PORT", "8082")))
        host = cfg.get("SERVER_HOST", "127.0.0.1")

        if _process and _process.poll() is None:
            if check_http_alive(port, host):
                return {"ok": True, "message": "Service is already running", "pid": _process.pid}
            append_log(f"Process PID {_process.pid} is alive but unresponsive on port {port}. Cleaning up...")
            stop_service()
            time.sleep(0.5)

        binary = get_active_binary()
        if not binary:
            raise RuntimeError(
                "WeKnora-lite binary not found. Please build the Lite binary first."
            )

        if check_http_alive(port, host):
            return {"ok": True, "message": f"Port {port} is already active", "pid": None}

        # If an unresponsive process or zombie socket is holding the port, clear it
        if check_port(port, host):
            append_log(f"Cleaning up unresponsive process holding port {port}...")
            stop_service()
            time.sleep(0.5)

        # Build clean environment dictionary
        env = dict(os.environ)
        env.update(cfg)
        env["SERVER_HOST"] = "127.0.0.1"
        env["WEKNORA_LITE_SETUP_TOKEN"] = get_setup_token()
        env["EDITION"] = "lite"
        env["DB_DRIVER"] = "sqlite"
        env["DB_PATH"] = str((DATA_DIR / "weknora.db").resolve()).replace("\\", "/")
        env["RETRIEVE_DRIVER"] = "sqlite"
        env["STREAM_MANAGER_TYPE"] = "memory"
        env["STORAGE_TYPE"] = "local"
        env["LOCAL_STORAGE_BASE_DIR"] = str((DATA_DIR / "files").resolve()).replace("\\", "/")
        env["DUCKDB_SKIP_EXTENSION_LOAD"] = "1"
        env["AUTO_MIGRATE"] = "true"
        env["WEKNORA_LANGUAGE"] = cfg.get("WEKNORA_LANGUAGE", "en-US")
        web_dir = REPO_DIR / "web"
        if not web_dir.exists():
            web_dir = MODULE_DIR / "web"
        if web_dir.exists():
            env["WEKNORA_WEB_DIR"] = str(web_dir)
        env["DOC_EXTRACTOR_SCRIPT"] = str(MODULE_DIR / "scripts" / "doc_extractor.py")

        # Automatically ensure Ollama is active on loopback
        ensure_ollama_running(cfg.get("OLLAMA_BASE_URL"))

        append_log(f"Starting WeKnora Lite: {binary} on {host}:{port}")
        
        try:
            _process = subprocess.Popen(
                [str(binary)],
                cwd=str(binary.parent),
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                bufsize=0,
                creationflags=_NO_WINDOW,
            )
            
            thread = threading.Thread(target=_pipe_output, args=(_process,), daemon=True)
            thread.start()
            start_math_watchdog()

            # Wait briefly for startup (high-frequency 25ms polling for instant readiness)
            for _ in range(120):
                time.sleep(0.025)
                if _process.poll() is not None:
                    break
                if check_port(port, host):
                    break

            return {
                "ok": True,
                "message": "WeKnora Lite started",
                "pid": _process.pid,
                "url": f"http://{host}:{port}"
            }
        except Exception as exc:
            append_log(f"Failed to start WeKnora Lite: {exc}")
            raise RuntimeError(f"Failed to launch WeKnora Lite: {exc}")


def stop_service() -> Dict[str, Any]:
    global _process
    stop_math_watchdog()
    with _lock:
        if not _process or _process.poll() is not None:
            _process = None
            cfg = read_env()
            port = int(cfg.get("SERVER_PORT", cfg.get("PORT", "8082")))
            if check_port(port, "127.0.0.1"):
                try:
                    if sys.platform == "win32":
                        subprocess.run(["taskkill", "/F", "/IM", "WeKnora-lite.exe"], capture_output=True)
                        out = subprocess.check_output(f"netstat -ano | findstr :{port}", shell=True, text=True)
                        for line in out.strip().splitlines():
                            parts = line.split()
                            if len(parts) >= 5 and "LISTENING" in parts:
                                orphan_pid = int(parts[-1])
                                append_log(f"Terminating orphaned WeKnora instance (PID {orphan_pid})...")
                                subprocess.run(["taskkill", "/F", "/T", "/PID", str(orphan_pid)], capture_output=True)
                except Exception as exc:
                    append_log(f"Error terminating orphaned process on port {port}: {exc}")
            elif sys.platform == "win32":
                subprocess.run(["taskkill", "/F", "/IM", "WeKnora-lite.exe"], capture_output=True)
            return {"ok": True, "message": "Service is not running"}

        append_log(f"Stopping WeKnora Lite (PID {_process.pid})...")
        try:
            if sys.platform == "win32":
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(_process.pid)], capture_output=True)
                subprocess.run(["taskkill", "/F", "/IM", "WeKnora-lite.exe"], capture_output=True)
            else:
                _process.terminate()
            try:
                _process.wait(timeout=1.5)
            except subprocess.TimeoutExpired:
                _process.kill()
                _process.wait(timeout=0.5)
            append_log("WeKnora Lite stopped successfully")
        except Exception as exc:
            append_log(f"Error stopping process: {exc}")
        finally:
            _process = None

    return {"ok": True, "message": "Service stopped"}


def restart_service() -> Dict[str, Any]:
    stop_service()
    cfg = read_env()
    port = int(cfg.get("SERVER_PORT", cfg.get("PORT", "8082")))
    host = cfg.get("SERVER_HOST", "127.0.0.1")
    # Dynamically wait for port release with high-frequency 25ms polling
    for _ in range(40):
        if not check_port(port, host):
            break
        time.sleep(0.025)
    return start_service()


def get_logs(limit: int = 200) -> List[str]:
    with _lock:
        items = list(_logs)
        return items[-limit:]


def run_frontend_build() -> None:
    """Builds frontend SPA in background."""
    global _build_thread
    if _build_status["building"]:
        return

    def _worker():
        _build_status["building"] = True
        _build_status["phase"] = "frontend"
        _build_status["message"] = "Running npm install & build..."
        _build_status["error"] = None
        _build_status["log"].clear()

        frontend_dir = REPO_DIR / "frontend"
        try:
            append_log("[Build] Starting frontend build...")
            npm_cmd = shutil.which("npm.cmd") if os.name == "nt" else shutil.which("npm")
            if not npm_cmd:
                npm_cmd = shutil.which("npm")
            if not npm_cmd:
                raise RuntimeError("npm executable not found in PATH.")

            node_modules = frontend_dir / "node_modules"
            if not node_modules.exists():
                append_log("[Build] node_modules not present, installing with --ignore-scripts...")
                proc = subprocess.Popen(
                    [npm_cmd, "install", "--prefer-offline", "--ignore-scripts"],
                    cwd=str(frontend_dir),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    shell=False,
                    creationflags=_NO_WINDOW,
                )
                for line in proc.stdout:
                    _build_status["log"].append(line.rstrip())
                proc.wait()
                if proc.returncode != 0:
                    raise RuntimeError(f"npm install failed with exit code {proc.returncode}")
            else:
                append_log("[Build] node_modules already exists. Skipping npm install to protect against script execution.")

            append_log("[Build] Compiling frontend bundle...")
            proc2 = subprocess.Popen(
                [npm_cmd, "run", "build"],
                cwd=str(frontend_dir),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                shell=False,
                creationflags=_NO_WINDOW,
            )
            for line in proc2.stdout:
                _build_status["log"].append(line.rstrip())
            proc2.wait()
            if proc2.returncode != 0:
                raise RuntimeError(f"npm run build failed with exit code {proc2.returncode}")

            dist = frontend_dir / "dist"
            web_dir = REPO_DIR / "web"
            if dist.exists():
                if web_dir.exists():
                    shutil.rmtree(web_dir)
                shutil.copytree(dist, web_dir)
                _build_status["phase"] = "done"
                _build_status["message"] = "Frontend assets built and copied to web/ successfully."
                append_log("[Build] Frontend build succeeded.")
            else:
                _build_status["phase"] = "error"
                _build_status["error"] = "frontend/dist not found after build."
        except Exception as exc:
            _build_status["phase"] = "error"
            _build_status["error"] = str(exc)
            append_log(f"[Build] Frontend build failed: {exc}")
        finally:
            _build_status["building"] = False

def _atexit_cleanup() -> None:
    global _process
    stop_math_watchdog()
    with _lock:
        if _process and _process.poll() is None:
            try:
                if sys.platform == "win32":
                    subprocess.run(["taskkill", "/F", "/T", "/PID", str(_process.pid)], capture_output=True)
                else:
                    _process.kill()
            except Exception:
                pass

atexit.register(_atexit_cleanup)

