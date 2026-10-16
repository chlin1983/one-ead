"""Build custom ArtCraft app from local Rust source code and deploy to One EAD.

Usage:
    python modules/artcraft/scripts/build_from_source.py <app_id>
    example:
    python modules/artcraft/scripts/build_from_source.py photocraft
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
UPSTREAM_DIR = ROOT / "modules" / "artcraft" / "upstream"
APPS_DIR = ROOT / "modules" / "artcraft" / "web" / "apps"

def build_app(app_id: str):
    repo_dir = UPSTREAM_DIR / app_id
    if not repo_dir.exists():
        print(f"[Error] Repository not found at: {repo_dir}")
        sys.exit(1)

    # Locate web app crate folder
    web_app_dir = repo_dir / "apps" / f"{app_id}-web"
    if not web_app_dir.exists():
        web_app_dir = repo_dir / "apps" / f"{app_id}"
    if not web_app_dir.exists():
        web_app_dir = repo_dir

    print(f"============================================================")
    print(f" Building {app_id} from raw Rust source...")
    print(f" Directory: {web_app_dir}")
    print(f"============================================================")

    # Check for trunk
    trunk = shutil.which("trunk")
    if not trunk:
        print("[Error] 'trunk' is not installed or not in PATH.")
        print("To compile WebAssembly from Rust, install trunk:")
        print("    cargo install trunk --locked")
        print("    rustup target add wasm32-unknown-unknown")
        sys.exit(1)

    # Run trunk build --release
    print("[1/2] Running trunk build --release...")
    res = subprocess.run(["trunk", "build", "--release"], cwd=str(web_app_dir))
    if res.returncode != 0:
        print(f"[Error] Trunk build failed with exit code {res.returncode}")
        sys.exit(res.returncode)

    # Copy dist output to One EAD app folder
    dist_dir = repo_dir / "dist" / "web"
    if not dist_dir.exists():
        dist_dir = web_app_dir / "dist"
    if not dist_dir.exists():
        dist_dir = repo_dir / "dist"

    target_app_dir = APPS_DIR / app_id
    target_app_dir.mkdir(parents=True, exist_ok=True)

    print(f"[2/2] Deploying compiled WebAssembly into {target_app_dir}...")
    for item in dist_dir.iterdir():
        dest = target_app_dir / item.name
        if item.is_dir():
            shutil.copytree(str(item), str(dest), dirs_exist_ok=True)
        else:
            shutil.copy2(str(item), str(dest))

    print(f"\n[Success] {app_id} built and deployed into One EAD!")
    print(f"Open http://127.0.0.1:8100/modules/artcraft/ to test your custom changes.")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python build_from_source.py <app_id>")
        print("Available: photocraft, vectorcraft, filmcraft, lightcraft, effectcraft, designcraft, etc.")
        sys.exit(1)
    build_app(sys.argv[1].lower().strip())
