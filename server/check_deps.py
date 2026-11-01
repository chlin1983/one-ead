"""Smart dependency verification and auto-installer for One EAD.

Checks that all required Python packages are installed before launching.
- On subsequent launches: instant check (<0.01s) using a cached signature in .deps_ok.
- On fresh PC / git clone: automatically detects missing packages, installs them
  from requirements.txt with friendly progress output, and caches verification.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

_ROOT = Path(__file__).resolve().parent.parent
REQUIREMENTS_FILE = _ROOT / "requirements.txt"
LOCK_FILE = _ROOT / "requirements.lock"
STAMP_FILE = _ROOT / ".deps_ok"

# List of (pip_spec, import_module_name, friendly_label)
REQUIRED_PACKAGES: List[Tuple[str, str, str]] = [
    ("fastapi>=0.110", "fastapi", "FastAPI"),
    ("uvicorn[standard]>=0.29", "uvicorn", "Uvicorn"),
    ("python-multipart>=0.0.9", "multipart", "Python Multipart"),
    ("pdfplumber>=0.11", "pdfplumber", "pdfplumber"),
    ("pymupdf>=1.23.0", "pymupdf", "PyMuPDF"),
    ("numpy>=1.24", "numpy", "NumPy"),
    ("scipy>=1.10", "scipy", "SciPy"),
    ("httpx>=0.27", "httpx", "HTTPX"),
]


def _compute_signature() -> str:
    """Compute a hash signature based on requirements.txt content and python executable."""
    h = hashlib.sha256()
    if REQUIREMENTS_FILE.exists():
        try:
            h.update(REQUIREMENTS_FILE.read_bytes())
        except OSError:
            pass
    if LOCK_FILE.exists():
        try:
            h.update(b"lock:")
            h.update(LOCK_FILE.read_bytes())
        except OSError:
            pass
    # Normalize python executable path (lowercase on Windows)
    h.update(str(sys.executable).lower().encode("utf-8"))
    h.update(f"{sys.version_info[0]}.{sys.version_info[1]}".encode("utf-8"))
    return h.hexdigest()



_SHA256_HEX_RE = re.compile(r"^[0-9a-f]{64}$")


def verify_lockfile_integrity(lock_path: Path) -> Tuple[bool, str, List[Dict[str, Any]]]:
    """Cryptographically validates a requirements lockfile.

    Ensures:
    1. Lockfile exists and contains at least one requirement.
    2. Every package uses an exact version specifier ('==').
    3. Every package has at least one valid SHA-256 hash (--hash=sha256:<64 hex>).
    4. Rejects ranges, unpinned dependencies, and malformed digests.
    """
    if not lock_path.exists():
        return False, f"Lockfile not found: {lock_path}", []

    try:
        content = lock_path.read_text(encoding="utf-8")
    except Exception as exc:
        return False, f"Failed to read lockfile: {exc}", []

    lines = content.splitlines()
    entries: List[Dict[str, Any]] = []
    current_entry: Optional[Dict[str, Any]] = None

    for line_num, raw_line in enumerate(lines, 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith(("--require-hashes", "--index-url", "--extra-index-url", "--no-index", "-r ", "-i ", "-f ")):
            continue

        is_continuation = line.endswith("\\")
        clean_part = line[:-1].strip() if is_continuation else line

        if clean_part.startswith("--hash="):
            if current_entry is None:
                return False, f"Line {line_num}: Hash specification without preceding package", []
            hash_val = clean_part[7:].strip()
            if not hash_val.startswith("sha256:"):
                return False, f"Line {line_num}: Only sha256 hashes are permitted, got {hash_val}", []
            hex_digest = hash_val[7:].lower()
            if not _SHA256_HEX_RE.match(hex_digest):
                return False, f"Line {line_num}: Malformed SHA-256 digest: {hex_digest}", []
            current_entry["hashes"].append(hex_digest)
        else:
            if current_entry is not None:
                if not current_entry["hashes"]:
                    return False, f"Package {current_entry['name']} missing required --hash verification", []
                entries.append(current_entry)
                current_entry = None

            tokens = clean_part.split()
            pkg_spec = tokens[0]
            inline_hashes = []
            for t in tokens[1:]:
                if t.startswith("--hash=sha256:"):
                    h = t[14:].lower()
                    if _SHA256_HEX_RE.match(h):
                        inline_hashes.append(h)
                    else:
                        return False, f"Line {line_num}: Malformed SHA-256 in {t}", []

            if "==" not in pkg_spec:
                return False, f"Line {line_num}: Package '{pkg_spec}' must be pinned with exact '==' version", []
            name, ver = pkg_spec.split("==", 1)
            name = name.strip()
            ver = ver.strip()
            if not name or not ver or any(c in ver for c in (">", "<", "~", "*")):
                return False, f"Line {line_num}: Invalid version pin '{pkg_spec}'", []

            current_entry = {"name": name, "version": ver, "hashes": inline_hashes, "line": line_num}

    if current_entry is not None:
        if not current_entry["hashes"]:
            return False, f"Package {current_entry['name']} missing required --hash verification", []
        entries.append(current_entry)

    if not entries:
        return False, "Lockfile contains no package requirements", []

    return True, f"Verified {len(entries)} pinned and hash-verified packages", entries


def verify_installed_against_lock(lock_path: Path) -> Tuple[bool, List[str]]:
    """Verifies that installed packages match the pinned lockfile versions."""
    import importlib.metadata
    ok, msg, entries = verify_lockfile_integrity(lock_path)
    if not ok:
        return False, [msg]

    mismatches = []
    for entry in entries:
        pkg_name = entry["name"]
        expected_ver = entry["version"]
        try:
            installed_ver = importlib.metadata.version(pkg_name)
            if installed_ver != expected_ver:
                mismatches.append(f"{pkg_name}: installed {installed_ver} != locked {expected_ver}")
        except importlib.metadata.PackageNotFoundError:
            mismatches.append(f"{pkg_name}: not installed (locked at {expected_ver})")

    return len(mismatches) == 0, mismatches


def is_already_verified() -> bool:
    """Return True if dependencies were previously verified and nothing changed."""
    if not STAMP_FILE.exists():
        return False
    try:
        data = json.loads(STAMP_FILE.read_text(encoding="utf-8"))
        if data.get("signature") == _compute_signature():
            return True
    except Exception:
        pass
    return False


def get_missing_packages() -> List[Tuple[str, str, str]]:
    """Return list of (pip_spec, import_module_name, label) for missing modules."""
    missing: List[Tuple[str, str, str]] = []
    for pkg_spec, mod_name, label in REQUIRED_PACKAGES:
        try:
            if importlib.util.find_spec(mod_name) is None:
                missing.append((pkg_spec, mod_name, label))
        except Exception:
            missing.append((pkg_spec, mod_name, label))
    return missing


def mark_verified() -> None:
    """Write .deps_ok stamp with current signature."""
    try:
        data = {
            "signature": _compute_signature(),
            "python": str(sys.executable),
            "version": f"{sys.version_info[0]}.{sys.version_info[1]}.{sys.version_info[2]}",
            "timestamp": time.time(),
        }
        STAMP_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except Exception as exc:
        # Non-critical if cache file cannot be written
        pass


def ensure_dependencies() -> bool:
    """Check dependencies; install missing ones from requirements.txt if needed.

    Returns True if all dependencies are satisfied, False otherwise.
    """
    # Fast path: instant return if cached signature matches (<0.01s)
    if is_already_verified():
        return True

    # Check for missing modules without importing heavy packages
    missing = get_missing_packages()
    if not missing:
        mark_verified()
        return True

    print("======================================================================")
    print(" [One EAD] First-Time Initialization: Missing Python Dependencies")
    print("======================================================================")
    print(" The following required packages were not found on this PC:")
    for _, _, label in missing:
        print(f"   - {label}")
    print()
    print(" Installing missing packages from requirements.txt...")
    print(" (This automatic setup only runs once on this PC)")
    print("======================================================================")
    print()

    if LOCK_FILE.exists():
        print(" Installing missing packages using reproducible, hash-verified lockfile (requirements.lock)...")
        cmd = [sys.executable, "-m", "pip", "install", "--require-hashes", "-r", str(LOCK_FILE)]
    else:
        print(" [SECURITY WARNING] requirements.lock not found. Installing from unpinned requirements.txt...")
        cmd = [sys.executable, "-m", "pip", "install", "-r", str(REQUIREMENTS_FILE)]
    try:
        res = subprocess.run(cmd)
        if res.returncode != 0:
            print()
            print("======================================================================")
            print(" [ERROR] 'pip install -r requirements.txt' failed with exit code:", res.returncode)
            print(" Please verify your internet connection or install manually with:")
            print(f"   pip install -r {REQUIREMENTS_FILE.name}")
            print("======================================================================")
            return False
    except Exception as exc:
        print(f"[ERROR] Failed to execute pip: {exc}")
        return False

    # Re-verify that missing packages are now importable
    still_missing = get_missing_packages()
    if still_missing:
        print()
        print("======================================================================")
        print(" [ERROR] The following packages are still missing after pip installation:")
        for _, _, label in still_missing:
            print(f"   - {label}")
        print(" Please install them manually using:")
        print(f"   pip install -r {REQUIREMENTS_FILE.name}")
        print("======================================================================")
        return False

    print()
    print("======================================================================")
    print(" [One EAD] All required dependencies successfully installed & verified!")
    print(" Starting application...")
    print("======================================================================")
    print()

    mark_verified()
    return True


if __name__ == "__main__":
    if not ensure_dependencies():
        sys.exit(1)
    sys.exit(0)
