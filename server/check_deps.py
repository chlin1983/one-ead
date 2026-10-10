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
import subprocess
import sys
import time
from pathlib import Path
from typing import List, Tuple

_ROOT = Path(__file__).resolve().parent.parent
REQUIREMENTS_FILE = _ROOT / "requirements.txt"
STAMP_FILE = _ROOT / ".deps_ok"

# List of (pip_spec, import_module_name, friendly_label)
REQUIRED_PACKAGES: List[Tuple[str, str, str]] = [
    ("fastapi>=0.110", "fastapi", "FastAPI"),
    ("uvicorn[standard]>=0.29", "uvicorn", "Uvicorn"),
    ("python-multipart>=0.0.9", "multipart", "Python Multipart"),
    ("pdfplumber>=0.11", "pdfplumber", "pdfplumber"),
    ("pymupdf>=1.23.0", "fitz", "PyMuPDF (fitz)"),
    ("numpy>=1.24", "numpy", "NumPy"),
    ("scipy>=1.10", "scipy", "SciPy"),
]


def _compute_signature() -> str:
    """Compute a hash signature based on requirements.txt content and python executable."""
    h = hashlib.sha256()
    if REQUIREMENTS_FILE.exists():
        try:
            h.update(REQUIREMENTS_FILE.read_bytes())
        except OSError:
            pass
    # Normalize python executable path (lowercase on Windows)
    h.update(str(sys.executable).lower().encode("utf-8"))
    h.update(f"{sys.version_info[0]}.{sys.version_info[1]}".encode("utf-8"))
    return h.hexdigest()


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
