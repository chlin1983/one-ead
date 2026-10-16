import os
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parents[3]
UPSTREAM_DIR = ROOT / "modules" / "artcraft" / "upstream"
UPSTREAM_DIR.mkdir(parents=True, exist_ok=True)

# Application & dependency repo definitions
REPOS = [
    {"name": "photocraft", "fork": "chlin1983/photocraft", "official": "storytold/photocraft"},
    {"name": "vectorcraft", "fork": "chlin1983/vectorcraft", "official": "storytold/vectorcraft"},
    {"name": "filmcraft", "fork": "chlin1983/filmcraft", "official": "storytold/filmcraft"},
    {"name": "lightcraft", "fork": "chlin1983/lightcraft", "official": "storytold/lightcraft"},
    {"name": "effectcraft", "fork": "chlin1983/effectcraft", "official": "storytold/effectcraft"},
    {"name": "designcraft", "fork": "chlin1983/designcraft", "official": "storytold/designcraft"},
    {"name": "figcraft", "fork": "chlin1983/figcraft", "official": "storytold/figcraft"},
    {"name": "wordcraft", "fork": "chlin1983/wordcraft", "official": "storytold/wordcraft"},
    {"name": "soundcraft", "fork": "chlin1983/soundcraft", "official": "storytold/soundcraft"},
    {"name": "deckcraft", "fork": "chlin1983/deckcraft", "official": "storytold/deckcraft"},
    {"name": "cadcraft", "fork": "chlin1983/cadcraft", "official": "storytold/cadcraft"},
    {"name": "gridcraft", "fork": "chlin1983/gridcraft", "official": "storytold/gridcraft"},
    {"name": "craft-libs", "fork": "chlin1983/craft-libs", "official": "storytold/craft-libs"},
    {"name": "craft-fonts", "fork": "chlin1983/craft-fonts", "official": "storytold/craft-fonts"},
]

def run_git(args, cwd=None):
    res = subprocess.run(["git"] + args, cwd=cwd, capture_output=True, text=True, encoding="utf-8")
    return res.returncode, res.stdout.strip(), res.stderr.strip()

for item in REPOS:
    name = item["name"]
    target = UPSTREAM_DIR / name
    official_url = f"https://github.com/{item['official']}.git"
    fork_url = f"https://github.com/{item['fork']}.git"

    if target.exists() and (target / ".git").exists():
        print(f"[{name}] Already cloned. Checking remotes...")
        run_git(["remote", "set-url", "origin", fork_url], cwd=target)
        _, out, _ = run_git(["remote"], cwd=target)
        if "upstream" not in out.split():
            run_git(["remote", "add", "upstream", official_url], cwd=target)
        else:
            run_git(["remote", "set-url", "upstream", official_url], cwd=target)
        continue

    print(f"[{name}] Cloning from official {official_url} (depth 1)...")
    # Clone from official to ensure full up-to-date tree
    rc, out, err = run_git(["clone", "--depth", "1", official_url, str(target)])
    if rc != 0:
        print(f"[{name}] Error cloning: {err}")
        continue

    # Set up origin pointing to user's fork and upstream pointing to official
    run_git(["remote", "set-url", "origin", fork_url], cwd=target)
    run_git(["remote", "add", "upstream", official_url], cwd=target)
    print(f"[{name}] Cloned & configured: origin -> {fork_url}, upstream -> {official_url}")

print("\nAll ArtCraft upstream repositories setup completed!")
