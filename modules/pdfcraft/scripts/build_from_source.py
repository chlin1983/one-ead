"""Build custom PdfCraft app from local Rust source code and deploy to One EAD.

Usage:
    python modules/pdfcraft/scripts/build_from_source.py
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
REPO_DIR = ROOT / "modules" / "pdfcraft" / "upstream" / "pdfcraft"
APP_DIR = ROOT / "modules" / "pdfcraft" / "web" / "app"

def build_pdfcraft():
    if not REPO_DIR.exists():
        print(f"[Error] PdfCraft repository not found at: {REPO_DIR}")
        sys.exit(1)

    web_app_dir = REPO_DIR / "apps" / "pdfcraft-web"
    if not web_app_dir.exists():
        web_app_dir = REPO_DIR

    print(f"============================================================")
    print(f" Building PdfCraft from raw Rust source...")
    print(f" Directory: {web_app_dir}")
    print(f"============================================================")

    trunk = shutil.which("trunk")
    if not trunk:
        print("[Error] 'trunk' is not installed or not in PATH.")
        print("To compile WebAssembly from Rust, install trunk:")
        print("    cargo install trunk --locked")
        print("    rustup target add wasm32-unknown-unknown")
        sys.exit(1)

    print("[1/2] Running trunk build --release...")
    res = subprocess.run(["trunk", "build", "--release"], cwd=str(web_app_dir))
    if res.returncode != 0:
        print(f"[Error] Trunk build failed with exit code {res.returncode}")
        sys.exit(res.returncode)

    dist_dir = REPO_DIR / "dist" / "web"
    if not dist_dir.exists():
        dist_dir = web_app_dir / "dist"
    if not dist_dir.exists():
        dist_dir = REPO_DIR / "dist"

    APP_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[2/2] Deploying compiled WebAssembly into {APP_DIR}...")
    for item in dist_dir.iterdir():
        dest = APP_DIR / item.name
        if item.is_dir():
            shutil.copytree(str(item), str(dest), dirs_exist_ok=True)
        else:
            shutil.copy2(str(item), str(dest))

    print(f"\n[Success] PdfCraft built and deployed into One EAD!")
    print(f"Open http://127.0.0.1:8100/modules/pdfcraft/ to test your custom changes.")

if __name__ == "__main__":
    build_pdfcraft()
