"""Smart dependency verification and auto-installer for One EAD.

SUPPLY-CHAIN INTEGRITY & LOCKFILE REVIEW PROCESS:
1. One EAD requires all dependencies and transitive sub-dependencies to be pinned
   with exact versions ('==') and cryptographic SHA-256 digests in requirements.lock.
2. The presence of hashes alone does not establish trustworthiness; the lockfile
   itself must be reviewed and committed to version control.
3. Lockfiles are never automatically regenerated or modified at runtime. Any package
   additions or upgrades must be generated in an isolated environment, verified with
   `pip hash`, reviewed, and committed through a pull request.
4. Normal application startup strictly fails closed if requirements.lock is missing,
   unpinned, or fails hash verification.
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
    """Compute a hash signature based strictly on requirements.lock content and python executable.

    Returns an empty string if requirements.lock does not exist or cannot be read.
    """
    if not LOCK_FILE.exists():
        return ""
    h = hashlib.sha256()
    try:
        h.update(b"lock:")
        h.update(LOCK_FILE.read_bytes())
    except OSError:
        return ""
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
    """Return True only if requirements.lock exists, passes cryptographic integrity,
    the .deps_ok stamp signature matches, AND every locked package version is verified installed.

    Fails closed on missing/invalid lockfile, stale stamp, or modified package versions.
    """
    if not LOCK_FILE.exists() or not STAMP_FILE.exists():
        return False

    lock_valid, _, _ = verify_lockfile_integrity(LOCK_FILE)
    if not lock_valid:
        return False

    try:
        data = json.loads(STAMP_FILE.read_text(encoding="utf-8"))
        sig = data.get("signature")
        if not sig or sig != _compute_signature():
            return False
    except Exception:
        return False

    # Never accept stamp based only on matching signature; strictly verify installed packages
    ok, _ = verify_installed_against_lock(LOCK_FILE)
    return ok


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


def mark_verified() -> bool:
    """Verifies installed packages against requirements.lock and writes .deps_ok stamp.

    Returns True if verification succeeded and stamp was written, False otherwise.
    Fails closed if requirements.lock is missing or verification fails.
    """
    if not LOCK_FILE.exists():
        print("[One EAD] Cannot mark dependencies verified: requirements.lock is missing.")
        return False

    ok, mismatches = verify_installed_against_lock(LOCK_FILE)
    if not ok:
        print("[One EAD] Cannot mark dependencies verified: installed packages do not match lockfile:")
        for m in mismatches:
            print(f"  - {m}")
        return False

    try:
        data = {
            "signature": _compute_signature(),
            "python": str(sys.executable),
            "version": f"{sys.version_info[0]}.{sys.version_info[1]}.{sys.version_info[2]}",
            "timestamp": time.time(),
        }
        STAMP_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
        return True
    except Exception:
        return False


def ensure_dependencies(install_missing: bool = False) -> bool:
    """Check dependencies against requirements.lock and required packages.

    Args:
        install_missing: If True, explicitly triggers pip installation with hash verification.
                         If False (default for normal startup), rejects uninstalled packages
                         without running pip.

    Returns:
        True if all dependencies are satisfied and verified, False otherwise.
    """
    # 1. Fail closed immediately if requirements.lock is missing or invalid
    if not LOCK_FILE.exists():
        print("======================================================================")
        print(" [SECURITY ERROR] requirements.lock is missing!")
        print(" One EAD requires a cryptographically pinned, hash-verified lockfile.")
        print(" Startup cannot proceed without requirements.lock.")
        print("======================================================================")
        return False

    lock_valid, lock_err_msg, _ = verify_lockfile_integrity(LOCK_FILE)
    if not lock_valid:
        print("======================================================================")
        print(" [SECURITY ERROR] requirements.lock is invalid or corrupted!")
        print(f" Reason: {lock_err_msg}")
        print(" Startup cannot proceed with an untrusted lockfile.")
        print("======================================================================")
        return False

    # Fast path: instant return if cached signature matches AND installed packages match lockfile (<0.01s)
    if is_already_verified():
        return True

    # Check for missing modules without importing heavy packages
    missing = get_missing_packages()
    lock_ok, lock_mismatches = verify_installed_against_lock(LOCK_FILE)

    if not missing and lock_ok:
        return mark_verified()

    print("======================================================================")
    print(" [One EAD] Dependency Verification Required")
    print("======================================================================")
    if missing:
        print(" The following required packages are missing:")
        for _, _, label in missing:
            print(f"   - {label}")
    if lock_mismatches:
        print(" The following lockfile version mismatches were detected:")
        for mm in lock_mismatches:
            print(f"   - {mm}")
    print()

    if not install_missing:
        print(" Automatic dependency installation during normal startup is disabled for security.")
        print(" To install or update dependencies with cryptographic hash verification, run:")
        print("     python server/check_deps.py --install")
        print(" or:")
        print(f"     pip install --require-hashes -r {LOCK_FILE.name}")
        print("======================================================================")
        return False

    print(" Installing verified dependencies using requirements.lock (--require-hashes)...")
    print("======================================================================")
    print()

    # Never fall back to unpinned requirements.txt; strictly require hash-verified lockfile
    cmd = [sys.executable, "-m", "pip", "install", "--require-hashes", "-r", str(LOCK_FILE)]
    try:
        res = subprocess.run(cmd)
        if res.returncode != 0:
            print()
            print("======================================================================")
            print(" [ERROR] Dependency installation failed with exit code:", res.returncode)
            print(" Please check your environment or install manually with:")
            print(f"   pip install --require-hashes -r {LOCK_FILE.name}")
            print("======================================================================")
            return False
    except Exception as exc:
        print(f"[ERROR] Failed to execute pip: {exc}")
        return False

    # Re-verify against lockfile
    lock_ok, lock_mismatches = verify_installed_against_lock(LOCK_FILE)
    if not lock_ok:
        print(" [ERROR] Installed packages still do not match lockfile:")
        for mm in lock_mismatches:
            print(f"   - {mm}")
        return False

    still_missing = get_missing_packages()
    if still_missing:
        print(" [ERROR] Missing packages after installation:")
        for _, _, label in still_missing:
            print(f"   - {label}")
        return False

    print(" [One EAD] All dependencies successfully verified against lockfile.")
    return mark_verified()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="One EAD Dependency Verification & Installer")
    parser.add_argument(
        "--install",
        action="store_true",
        help="Explicitly install missing/locked dependencies with cryptographic hash verification",
    )
    args = parser.parse_args()

    success = ensure_dependencies(install_missing=args.install)
    sys.exit(0 if success else 1)
