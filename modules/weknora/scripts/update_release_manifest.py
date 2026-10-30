"""Maintainer tool: pin the SHA-256 digests of a WeKnora release into release_manifest.json.

Reviewed release process (see RELEASING.md):
  1. Run the 'Build WeKnora Lite Prebuilt Binary' workflow (publishes assets, SHA256SUMS.txt
     and a build-provenance attestation).
  2. Run:  python modules/weknora/scripts/update_release_manifest.py --tag <tag> --require-attestation
     It downloads every asset from the approved release path, computes SHA-256 locally,
     cross-checks SHA256SUMS.txt, verifies the GitHub attestation (gh CLI) and rewrites the manifest.
  3. Review the manifest diff and merge it through a pull request.

This tool never weakens the downloader's fail-closed behaviour; it only proposes a manifest.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Dict, List

try:  # package import keeps a single IntegrityError class when imported by tests/tools
    from modules.weknora.scripts import download_binary as db  # noqa: E402
except ImportError:  # executed as a standalone script
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import download_binary as db  # noqa: E402

ASSETS = [db.DEFAULT_ASSET_ZIP, db.DEFAULT_ASSET_EXE]
SUMS_NAME = "SHA256SUMS.txt"


def parse_sums(text: str) -> Dict[str, str]:
    """Parse 'sha256sum' style lines: '<64 hex>  <filename>'."""
    out: Dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split(None, 1)
        if len(parts) != 2 or not db._SHA256_RE.match(parts[0].lower()):
            raise db.IntegrityError(f"Malformed line in {SUMS_NAME}: {line!r}")
        out[parts[1].lstrip("*").strip()] = parts[0].lower()
    return out


def build_manifest(tag: str, computed: Dict[str, str], sums: Dict[str, str]) -> Dict[str, object]:
    """Cross-check locally computed digests against SHA256SUMS.txt and build the manifest."""
    for name, digest in computed.items():
        if sums.get(name) != digest:
            raise db.IntegrityError(
                f"{name}: downloaded digest {digest} does not match {SUMS_NAME} entry {sums.get(name)}"
            )
    return {
        "_comment": (
            "Pinned prebuilt WeKnora release. Updated only via the reviewed process in RELEASING.md. "
            "Downloads fail closed if an asset has no digest here."
        ),
        "tag": tag,
        "assets": dict(sorted(computed.items())),
    }


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _verify_attestation(path: Path, repo: str, required: bool) -> None:
    gh = shutil.which("gh")
    if not gh:
        if required:
            raise db.IntegrityError("gh CLI not found; cannot verify build provenance attestation")
        print(f"[WARN] gh CLI not found; skipping attestation check for {path.name}")
        return
    res = subprocess.run([gh, "attestation", "verify", str(path), "--repo", repo], capture_output=True, text=True)
    if res.returncode != 0:
        msg = f"Attestation verification failed for {path.name}: {res.stderr.strip() or res.stdout.strip()}"
        if required:
            raise db.IntegrityError(msg)
        print(f"[WARN] {msg}")
    else:
        print(f"[OK] Provenance attestation verified for {path.name}")


def main(argv: List[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tag", required=True)
    ap.add_argument("--repo", default=db.DEFAULT_REPO)
    ap.add_argument("--require-attestation", action="store_true", help="fail unless gh verifies build provenance")
    ap.add_argument("--dry-run", action="store_true", help="print the manifest without writing it")
    args = ap.parse_args(argv)

    base = f"https://github.com/{args.repo}/releases/download/{args.tag}"
    computed: Dict[str, str] = {}
    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        progress = db.DownloadProgress(callback=lambda *a: None)
        sums_path = tmpdir / SUMS_NAME
        db.download_stream(f"{base}/{SUMS_NAME}", sums_path, progress)
        sums = parse_sums(sums_path.read_text(encoding="utf-8"))
        for name in ASSETS:
            path = tmpdir / name
            db.download_stream(f"{base}/{name}", path, progress)
            computed[name] = _sha256(path)
            _verify_attestation(path, args.repo, args.require_attestation)

    manifest = build_manifest(args.tag, computed, sums)
    text = json.dumps(manifest, indent=2) + "\n"
    if args.dry_run:
        print(text)
    else:
        db.MANIFEST_PATH.write_text(text, encoding="utf-8")
        print(f"[OK] Wrote {db.MANIFEST_PATH}. Review the diff and merge via pull request.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except db.IntegrityError as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        sys.exit(1)
