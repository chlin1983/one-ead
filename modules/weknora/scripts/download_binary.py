"""Automated GitHub Releases downloader for WeKnora Lite prebuilt binaries.

Enables fresh clones to instantly acquire prebuilt WeKnora-lite.exe without
requiring Go, MinGW GCC, or Node.js compilers.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import io
import json
import os
import re
import shutil
import stat
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

MODULE_DIR = Path(__file__).resolve().parent.parent
BINARY_NAME = "WeKnora-lite.exe" if os.name == "nt" else "WeKnora-lite"
BINARY_PATH = MODULE_DIR / BINARY_NAME
DEFAULT_REPO = "chlin1983/one-ead"

# Direct release asset URLs (GitHub redirects /latest/download/<asset> to the actual release asset)
DEFAULT_ASSET_ZIP = "weknora-lite-windows-amd64.zip"
DEFAULT_ASSET_EXE = BINARY_NAME

# --- Supply-chain integrity -------------------------------------------------
# A prebuilt executable is only installed if its SHA-256 matches a digest pinned in
# release_manifest.json (committed to git, i.e. reviewed) or supplied out-of-band via
# WEKNORA_RELEASE_SHA256. There is no "latest" fallback and no unverified install.
MANIFEST_PATH = MODULE_DIR / "release_manifest.json"
ALLOWED_DOWNLOAD_HOSTS = frozenset({
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
})
ALLOWED_REPOS = frozenset({DEFAULT_REPO})
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class IntegrityError(RuntimeError):
    """Raised when a download is not from an approved source or fails verification."""


def load_manifest() -> Dict[str, Any]:
    try:
        with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def validate_download_url(url: str, *, initial: bool = True) -> None:
    """Allow only HTTPS URLs on approved hosts; the initial URL must be a release path."""
    parsed = urllib.parse.urlsplit(url or "")
    if parsed.scheme != "https":
        raise IntegrityError(f"Refusing non-HTTPS download URL: {url}")
    host = (parsed.hostname or "").lower()
    if host not in ALLOWED_DOWNLOAD_HOSTS or parsed.port not in (None, 443) or parsed.username:
        raise IntegrityError(f"Download host not approved: {host or url}")
    if initial:
        m = re.fullmatch(r"/([^/]+/[^/]+)/releases/download/[^/]+/[^/]+", parsed.path)
        if host != "github.com" or not m or m.group(1) not in ALLOWED_REPOS:
            raise IntegrityError(f"Download URL is not an approved release asset path: {url}")


class _AllowlistRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_download_url(newurl, initial=False)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def expected_sha256(asset_name: str, tag: Optional[str]) -> str:
    """Return the trusted digest for an asset, or raise IntegrityError (fail closed)."""
    env = os.environ.get("WEKNORA_RELEASE_SHA256", "").strip().lower()
    if env:
        if not _SHA256_RE.match(env):
            raise IntegrityError("WEKNORA_RELEASE_SHA256 is not a valid SHA-256 hex digest")
        return env
    manifest = load_manifest()
    if tag and manifest.get("tag") and manifest["tag"] != tag:
        raise IntegrityError(f"Tag {tag} does not match pinned release {manifest['tag']}")
    digest = str((manifest.get("assets") or {}).get(asset_name, "")).strip().lower()
    if not _SHA256_RE.match(digest):
        raise IntegrityError(
            f"No pinned SHA-256 for '{asset_name}' in {MANIFEST_PATH.name}. Refusing to install "
            "an unverified binary. Add the digest from the release's SHA256SUMS.txt via a reviewed commit."
        )
    return digest


def verify_sha256(path: Path, expected: str) -> None:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    if not hmac.compare_digest(h.hexdigest(), expected.lower()):
        raise IntegrityError(f"SHA-256 mismatch: expected {expected}, got {h.hexdigest()}")


class DownloadProgress:
    def __init__(self, callback: Optional[Callable[[int, int, str], None]] = None):
        self.callback = callback
        self.downloaded = 0
        self.total = 0
        self.last_update = 0.0

    def update(self, chunk_size: int, total_size: int, message: str = ""):
        self.downloaded += chunk_size
        self.total = total_size
        now = time.time()
        # Rate limit console / callback updates to 10Hz
        if now - self.last_update >= 0.1 or (self.total > 0 and self.downloaded >= self.total):
            self.last_update = now
            if self.callback:
                self.callback(self.downloaded, self.total, message)
            else:
                pct = (self.downloaded / self.total * 100) if self.total > 0 else 0
                mb_down = self.downloaded / (1024 * 1024)
                mb_tot = self.total / (1024 * 1024) if self.total > 0 else 0
                sys.stdout.write(f"\r[Downloader] {message} {mb_down:.1f} MB / {mb_tot:.1f} MB ({pct:.1f}%)")
                sys.stdout.flush()


def get_candidate_urls(repo: str = DEFAULT_REPO, tag: Optional[str] = None) -> List[str]:
    """Candidate URLs for an exact pinned release (never "latest")."""
    tag = tag or load_manifest().get("tag")
    if not tag:
        raise IntegrityError("No release tag pinned: set 'tag' in release_manifest.json or pass --tag")
    base = f"https://github.com/{repo}/releases/download/{tag}"
    return [f"{base}/{DEFAULT_ASSET_ZIP}", f"{base}/{DEFAULT_ASSET_EXE}"]


def download_stream(
    url: str,
    target_path: Path,
    progress: DownloadProgress,
    timeout: float = 60.0
) -> bool:
    """Streams download from URL to target_path with chunking and progress reporting."""
    headers = {
        "User-Agent": "One-EAD-WeKnora-Downloader/1.0",
        "Accept": "*/*",
    }
    validate_download_url(url)
    req = urllib.request.Request(url, headers=headers)
    opener = urllib.request.build_opener(_AllowlistRedirect)
    try:
        with opener.open(req, timeout=timeout) as resp:
            total_size = int(resp.headers.get("Content-Length", 0))
            chunk_size = 128 * 1024  # 128 KB
            downloaded = 0
            with open(target_path, "wb") as f:
                while True:
                    chunk = resp.read(chunk_size)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    progress.update(len(chunk), total_size, "Downloading release asset...")
            return True
    except Exception as exc:
        if target_path.exists():
            target_path.unlink(missing_ok=True)
        raise exc


MAX_ZIP_ENTRIES = 20000
MAX_ZIP_UNCOMPRESSED_BYTES = 2 * 1024 ** 3  # 2 GiB


def _safe_member_parts(member: str) -> List[str]:
    """Split an archive member name into safe path components or raise IntegrityError.

    Rejects absolute paths, drive prefixes / alternate data streams, '..' components,
    NUL bytes and empty/dot-only names.
    """
    if not member or "\x00" in member:
        raise IntegrityError(f"Unsafe archive entry (empty or NUL): {member!r}")
    norm = member.replace("\\", "/")
    if norm.startswith("/") or re.match(r"^[A-Za-z]:", norm) or norm.startswith("//"):
        raise IntegrityError(f"Unsafe archive entry (absolute path): {member!r}")
    parts = [p for p in norm.split("/") if p not in ("", ".")]
    if not parts:
        raise IntegrityError(f"Unsafe archive entry (empty path): {member!r}")
    for part in parts:
        if part == ".." or ":" in part:
            raise IntegrityError(f"Unsafe archive entry (traversal or drive prefix): {member!r}")
    return parts


def _confined_target(root: Path, parts: List[str]) -> Path:
    """Resolve root/parts and prove the result stays inside root."""
    root_resolved = root.resolve()
    target = root_resolved.joinpath(*parts).resolve()
    if target != root_resolved and root_resolved not in target.parents:
        raise IntegrityError(f"Archive entry escapes extraction directory: {'/'.join(parts)}")
    return target


def _validate_archive(zf: zipfile.ZipFile) -> None:
    infos = zf.infolist()
    if len(infos) > MAX_ZIP_ENTRIES:
        raise IntegrityError("Archive has too many entries")
    if sum(i.file_size for i in infos) > MAX_ZIP_UNCOMPRESSED_BYTES:
        raise IntegrityError("Archive uncompressed size exceeds limit")
    for info in infos:
        _safe_member_parts(info.filename)
        mode = (info.external_attr >> 16) & 0xFFFF
        if stat.S_ISLNK(mode):
            raise IntegrityError(f"Archive contains a symbolic link: {info.filename!r}")


def _write_atomic(zf: zipfile.ZipFile, info: zipfile.ZipInfo, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(target.name + ".part")
    with zf.open(info) as src, open(tmp, "wb") as dst:
        shutil.copyfileobj(src, dst)
    os.replace(tmp, target)


def install_from_zip(zip_path: Path, module_dir: Path) -> Dict[str, Any]:
    """Safely extract the binary and web assets from a release zip.

    The whole archive is validated first (no absolute/drive/'..' names, no symlinks, size
    limits) and every destination is resolved and confined to its intended directory.
    Any unsafe entry aborts the install with IntegrityError before files are written.
    """
    extracted = {"binary": False, "web": False, "files": []}
    dist_root = module_dir / "dist"
    with zipfile.ZipFile(zip_path, "r") as zf:
        _validate_archive(zf)
        for info in zf.infolist():
            parts = _safe_member_parts(info.filename)
            is_dir = info.filename.endswith("/") or info.filename.endswith("\\")

            if not is_dir and parts[-1].lower() == BINARY_NAME.lower():
                target_exe = _confined_target(module_dir, [BINARY_NAME])
                _write_atomic(zf, info, target_exe)
                if os.name != "nt":
                    try:
                        target_exe.chmod(0o755)
                    except OSError:
                        pass
                extracted["binary"] = True
                extracted["files"].append(str(target_exe))

            # Web dist assets: everything after the first 'dist' or 'web' component
            marker = next((i for i, p in enumerate(parts) if p in ("dist", "web")), None)
            if marker is not None and len(parts) > marker + 1:
                target_file = _confined_target(dist_root, parts[marker + 1:])
                if is_dir:
                    target_file.mkdir(parents=True, exist_ok=True)
                else:
                    _write_atomic(zf, info, target_file)
                    extracted["web"] = True

    return extracted


ACCEPT_LOCAL_BUILD_ENV = "WEKNORA_ACCEPT_LOCAL_BUILD_SHA256"


def verify_existing_binary(target_exe: Path, accept_local_build_sha256: Optional[str] = None) -> Dict[str, Any]:
    """Verify an already-installed binary instead of blindly trusting it.

    * SHA-256 matches the pinned digest -> accepted as verified.
    * Otherwise rejected. Metadata files such as build_info.json are NEVER treated as proof.
    * A locally built binary can be used only through an explicit user decision: supply the exact
      SHA-256 of the file you accept (env WEKNORA_ACCEPT_LOCAL_BUILD_SHA256 or --accept-local-build-sha256).
      The file must match that digest, and the result is labelled UNVERIFIED.
    """
    base = {"binary_path": str(target_exe), "skipped": True}
    try:
        expected = expected_sha256(BINARY_NAME, None)
        verify_sha256(target_exe, expected)
        return {**base, "ok": True, "verified": True, "message": f"Existing binary verified against pinned SHA-256 ({target_exe})"}
    except IntegrityError as exc:
        reason = str(exc)

    accepted = (accept_local_build_sha256 or os.environ.get(ACCEPT_LOCAL_BUILD_ENV, "")).strip().lower()
    if accepted:
        if not _SHA256_RE.match(accepted):
            return {**base, "ok": False, "verified": False, "message": f"{ACCEPT_LOCAL_BUILD_ENV} is not a valid SHA-256 hex digest"}
        try:
            verify_sha256(target_exe, accepted)
        except IntegrityError as exc:
            return {**base, "ok": False, "verified": False, "message": f"Binary does not match the SHA-256 you accepted: {exc}"}
        return {
            **base, "ok": True, "verified": False, "local_build": True, "accepted_sha256": accepted,
            "message": f"UNVERIFIED local build in use by explicit user decision (SHA-256 {accepted}); "
                       "not checked against a trusted release digest.",
        }
    return {
        **base, "ok": False, "verified": False,
        "message": f"Existing binary at {target_exe} failed integrity verification: {reason}. "
                   f"If this is your own local build, accept that exact file explicitly by setting "
                   f"{ACCEPT_LOCAL_BUILD_ENV}=<its SHA-256>; otherwise remove it and re-download.",
    }


def download_weknora_binary(
    repo: str = DEFAULT_REPO,
    tag: Optional[str] = None,
    custom_url: Optional[str] = None,
    progress_callback: Optional[Callable[[int, int, str], None]] = None,
    force: bool = False,
    accept_local_build_sha256: Optional[str] = None,
) -> Dict[str, Any]:
    """High-level downloader: checks candidates, downloads, and unpacks binary."""
    target_exe = MODULE_DIR / BINARY_NAME
    if target_exe.exists() and not force:
        return verify_existing_binary(target_exe, accept_local_build_sha256)

    try:
        urls = [custom_url] if custom_url else get_candidate_urls(repo=repo, tag=tag)
    except IntegrityError as exc:
        return {"ok": False, "message": str(exc), "errors": [str(exc)]}
    progress = DownloadProgress(callback=progress_callback)

    errors: List[str] = []
    for url in urls:
        if not url:
            continue
        try:
            if progress_callback:
                progress_callback(0, 0, f"Connecting to {url}...")
            else:
                print(f"[Downloader] Attempting download from: {url}")

            with tempfile.TemporaryDirectory() as tmpdir:
                tmp_path = Path(tmpdir) / "download_payload.tmp"
                asset_name = Path(urllib.parse.urlsplit(url).path).name
                expected = expected_sha256(asset_name, tag)
                download_stream(url, tmp_path, progress)
                verify_sha256(tmp_path, expected)

                # Check if downloaded file is zip or raw exe
                is_zip = False
                try:
                    with zipfile.ZipFile(tmp_path, "r") as test_zf:
                        is_zip = True
                except zipfile.BadZipFile:
                    is_zip = False

                if is_zip:
                    if progress_callback:
                        progress_callback(progress.downloaded, progress.total, "Extracting prebuilt package...")
                    res = install_from_zip(tmp_path, MODULE_DIR)
                    if not res["binary"]:
                        raise RuntimeError(f"Zip archive from {url} did not contain {BINARY_NAME}")
                else:
                    # Raw binary
                    if progress_callback:
                        progress_callback(progress.downloaded, progress.total, "Installing binary...")
                    shutil.move(str(tmp_path), str(target_exe))
                    if os.name != "nt":
                        try:
                            target_exe.chmod(0o755)
                        except Exception:
                            pass

                # Record build info
                build_info_path = MODULE_DIR / "build_info.json"
                try:
                    info = {
                        "build_date": time.strftime("%Y-%m-%d %H:%M:%S"),
                        "source": "github_release",
                        "release_url": url,
                        "edition": "lite",
                        "downloaded": True,
                        "sha256_verified": True
                    }
                    with open(build_info_path, "w", encoding="utf-8") as f:
                        json.dump(info, f, indent=2)
                except Exception:
                    pass

                if not progress_callback:
                    print(f"\n[Downloader] Successfully installed {BINARY_NAME} to {target_exe}")

                return {
                    "ok": True,
                    "message": "WeKnora Lite prebuilt binary installed successfully.",
                    "binary_path": str(target_exe),
                    "source_url": url
                }

        except urllib.error.HTTPError as http_err:
            if http_err.code == 404:
                errors.append(f"{url} -> HTTP 404 Not Found (no release asset uploaded yet to https://github.com/{repo}/releases)")
            else:
                errors.append(f"{url} -> HTTP {http_err.code} {http_err.reason}")
        except Exception as exc:
            errors.append(f"{url} -> {exc}")

    all_404 = all("HTTP 404" in e for e in errors) if errors else False
    if all_404:
        msg = (
            f"No prebuilt release found at https://github.com/{repo}/releases. "
            "To publish the prebuilt binary, run the GitHub Actions workflow "
            "'.github/workflows/build-weknora.yml' on GitHub, or create a release and upload WeKnora-lite.exe."
        )
    else:
        error_summary = " | ".join(errors)
        msg = f"Failed to download prebuilt binary. Errors: {error_summary}"

    return {
        "ok": False,
        "message": msg,
        "errors": errors
    }



def main():
    parser = argparse.ArgumentParser(description="Download prebuilt WeKnora Lite binary from GitHub Releases")
    parser.add_argument("--repo", default=DEFAULT_REPO, help="GitHub repository (e.g. chlin1983/one-ead)")
    parser.add_argument("--tag", default=None, help="Release tag (default: latest)")
    parser.add_argument("--url", default=None, help="Direct asset URL to download")
    parser.add_argument("--accept-local-build-sha256", default=None, help="explicitly accept an UNVERIFIED local build with exactly this SHA-256")
    parser.add_argument("--force", action="store_true", help="Overwrite existing binary if present")
    args = parser.parse_args()

    res = download_weknora_binary(
        repo=args.repo,
        tag=args.tag,
        custom_url=args.url,
        force=args.force,
        accept_local_build_sha256=args.accept_local_build_sha256,
    )
    if not res.get("ok"):
        print(f"\n[ERROR] {res.get('message')}", file=sys.stderr)
        sys.exit(1)
    else:
        print(f"\n[SUCCESS] {res.get('message')}")
        sys.exit(0)


if __name__ == "__main__":
    main()
