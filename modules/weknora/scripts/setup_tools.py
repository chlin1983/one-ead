"""Portable toolchain downloader for WeKnora Windows Native Build (Zero Docker).

Downloads standalone, portable Go and w64devkit (GCC MinGW) into modules/weknora/tools
so WeKnora-lite can compile natively without Docker, without admin rights, and without
modifying Windows system registry.
"""

from __future__ import annotations

import io
import os
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent.parent / "tools"
GO_URL = "https://go.dev/dl/go1.23.6.windows-amd64.zip"
GCC_URL = "https://github.com/skeeto/w64devkit/releases/download/v1.20.0/w64devkit-1.20.0.zip"


def download_and_extract(url: str, dest_dir: Path, label: str) -> None:
    dest_dir.mkdir(parents=True, exist_ok=True)
    print(f"[Toolchain] Downloading {label} from {url}...")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as resp:
        data = resp.read()
    print(f"[Toolchain] Downloaded {len(data) / (1024*1024):.1f} MB. Extracting to {dest_dir}...")

    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        zf.extractall(dest_dir)
    print(f"[Toolchain] {label} extracted successfully.")


def setup():
    TOOLS_DIR.mkdir(parents=True, exist_ok=True)
    
    # 1. Portable Go
    go_dir = TOOLS_DIR / "go"
    go_exe = go_dir / "bin" / "go.exe"
    if not go_exe.exists() and not (go_dir / "go" / "bin" / "go.exe").exists():
        download_and_extract(GO_URL, go_dir, "Portable Go 1.23.6")
        # Go zip extracts as 'go/bin/go.exe' inside dest_dir
        if (go_dir / "go" / "bin" / "go.exe").exists():
            for item in (go_dir / "go").iterdir():
                target = go_dir / item.name
                if target.exists():
                    if target.is_dir():
                        shutil.rmtree(target, ignore_errors=True)
                    else:
                        target.unlink(missing_ok=True)
                shutil.move(str(item), str(go_dir))
            shutil.rmtree(go_dir / "go", ignore_errors=True)

    # 2. Portable GCC / MinGW (w64devkit)
    gcc_dir = TOOLS_DIR / "w64devkit"
    gcc_exe = gcc_dir / "bin" / "gcc.exe"
    if not gcc_exe.exists() and not (gcc_dir / "w64devkit" / "bin" / "gcc.exe").exists():
        download_and_extract(GCC_URL, gcc_dir, "Portable w64devkit (GCC/MinGW)")
        if (gcc_dir / "w64devkit" / "bin" / "gcc.exe").exists():
            for item in (gcc_dir / "w64devkit").iterdir():
                target = gcc_dir / item.name
                if target.exists():
                    if target.is_dir():
                        shutil.rmtree(target, ignore_errors=True)
                    else:
                        target.unlink(missing_ok=True)
                shutil.move(str(item), str(gcc_dir))
            shutil.rmtree(gcc_dir / "w64devkit", ignore_errors=True)

    print("[Toolchain] Setup complete!")
    print(f"  Go  : {go_dir / 'bin' / 'go.exe'}")
    print(f"  GCC : {gcc_dir / 'bin' / 'gcc.exe'}")


if __name__ == "__main__":
    setup()
