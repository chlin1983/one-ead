"""Automated GitHub Releases downloader for WeKnora Lite prebuilt binaries.

Enables fresh clones to instantly acquire prebuilt WeKnora-lite.exe without
requiring Go, MinGW GCC, or Node.js compilers.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

MODULE_DIR = Path(__file__).resolve().parent.parent
BINARY_NAME = "WeKnora-lite.exe" if os.name == "nt" else "WeKnora-lite"
BINARY_PATH = MODULE_DIR / BINARY_NAME
DEFAULT_REPO = "chlin1983/one-ead"

# Direct release asset URLs (GitHub redirects /latest/download/<asset> to the actual release asset)
DEFAULT_ASSET_ZIP = "weknora-lite-windows-amd64.zip"
DEFAULT_ASSET_EXE = BINARY_NAME


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
    """Generates candidate download URLs in preferred order."""
    custom_url = os.environ.get("WEKNORA_RELEASE_DOWNLOAD_URL", "").strip()
    urls: List[str] = []
    if custom_url:
        urls.append(custom_url)

    if tag:
        base = f"https://github.com/{repo}/releases/download/{tag}"
        urls.append(f"{base}/{DEFAULT_ASSET_ZIP}")
        urls.append(f"{base}/{DEFAULT_ASSET_EXE}")
    else:
        latest_base = f"https://github.com/{repo}/releases/latest/download"
        urls.append(f"{latest_base}/{DEFAULT_ASSET_ZIP}")
        urls.append(f"{latest_base}/{DEFAULT_ASSET_EXE}")

    return urls


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
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
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


def install_from_zip(zip_path: Path, module_dir: Path) -> Dict[str, Any]:
    """Extracts binary and web frontend assets from release zip."""
    extracted = {"binary": False, "web": False, "files": []}
    with zipfile.ZipFile(zip_path, "r") as zf:
        namelist = zf.namelist()
        for member in namelist:
            norm = member.replace("\\", "/").strip()
            filename = Path(norm).name
            if filename.lower() == BINARY_NAME.lower():
                # Extract binary directly into MODULE_DIR
                target_exe = module_dir / BINARY_NAME
                with zf.open(member) as src, open(target_exe, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                if os.name != "nt":
                    try:
                        target_exe.chmod(0o755)
                    except Exception:
                        pass
                extracted["binary"] = True
                extracted["files"].append(str(target_exe))

            # Extract web dist if present
            if "/dist/" in norm or norm.startswith("dist/") or "/web/" in norm or norm.startswith("web/"):
                sub_parts = norm.split("/")
                try:
                    idx = sub_parts.index("dist") if "dist" in sub_parts else sub_parts.index("web")
                    rel_sub = "/".join(sub_parts[idx + 1:])
                    if rel_sub:
                        target_file = module_dir / "dist" / rel_sub
                        if norm.endswith("/"):
                            target_file.mkdir(parents=True, exist_ok=True)
                        else:
                            target_file.parent.mkdir(parents=True, exist_ok=True)
                            with zf.open(member) as src, open(target_file, "wb") as dst:
                                shutil.copyfileobj(src, dst)
                            extracted["web"] = True
                except ValueError:
                    pass

    return extracted


def download_weknora_binary(
    repo: str = DEFAULT_REPO,
    tag: Optional[str] = None,
    custom_url: Optional[str] = None,
    progress_callback: Optional[Callable[[int, int, str], None]] = None,
    force: bool = False
) -> Dict[str, Any]:
    """High-level downloader: checks candidates, downloads, and unpacks binary."""
    target_exe = MODULE_DIR / BINARY_NAME
    if target_exe.exists() and not force:
        return {
            "ok": True,
            "message": f"Binary already exists at {target_exe}",
            "binary_path": str(target_exe),
            "skipped": True
        }

    urls = [custom_url] if custom_url else get_candidate_urls(repo=repo, tag=tag)
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
                download_stream(url, tmp_path, progress)

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
                        "downloaded": True
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
    parser.add_argument("--force", action="store_true", help="Overwrite existing binary if present")
    args = parser.parse_args()

    res = download_weknora_binary(
        repo=args.repo,
        tag=args.tag,
        custom_url=args.url,
        force=args.force
    )
    if not res.get("ok"):
        print(f"\n[ERROR] {res.get('message')}", file=sys.stderr)
        sys.exit(1)
    else:
        print(f"\n[SUCCESS] {res.get('message')}")
        sys.exit(0)


if __name__ == "__main__":
    main()
