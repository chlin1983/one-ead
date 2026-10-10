"""CLI tool and helper to download and cache Whisper ONNX models locally for air-gapped environments.

Usage:
    python modules/say/download_model.py
    python modules/say/download_model.py --model whisper-large-v3-turbo
    python modules/say/download_model.py --model whisper-tiny
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
from pathlib import Path
from typing import Callable, Dict, List, Optional

MODELS_DIR = Path(__file__).resolve().parent / "web" / "models"

MODEL_PRESETS: Dict[str, Dict[str, Any]] = {
    "moonshine-tiny": {
        "repo_id": "onnx-community/moonshine-tiny-ONNX",
        "dir_name": "moonshine-tiny",
        "files": [
            "config.json",
            "generation_config.json",
            "preprocessor_config.json",
            "tokenizer.json",
            "tokenizer_config.json",
            "special_tokens_map.json",
            "onnx/encoder_model_quantized.onnx",
            "onnx/decoder_model_merged_quantized.onnx",
        ],
    },
    "moonshine-base": {
        "repo_id": "onnx-community/moonshine-base-ONNX",
        "dir_name": "moonshine-base",
        "files": [
            "config.json",
            "generation_config.json",
            "preprocessor_config.json",
            "tokenizer.json",
            "tokenizer_config.json",
            "special_tokens_map.json",
            "onnx/encoder_model_quantized.onnx",
            "onnx/decoder_model_merged_quantized.onnx",
        ],
    },
    "whisper-tiny": {
        "repo_id": "onnx-community/whisper-tiny",
        "dir_name": "whisper-tiny",
        "files": [
            "config.json",
            "generation_config.json",
            "preprocessor_config.json",
            "tokenizer.json",
            "tokenizer_config.json",
            "special_tokens_map.json",
            "added_tokens.json",
            "vocab.json",
            "normalizer.json",
            "quantize_config.json",
            "onnx/encoder_model_quantized.onnx",
            "onnx/decoder_model_merged_quantized.onnx",
        ],
    },
    "whisper-large-v3-turbo": {
        "repo_id": "onnx-community/whisper-large-v3-turbo",
        "dir_name": "whisper-large-v3-turbo",
        "files": [
            "config.json",
            "generation_config.json",
            "preprocessor_config.json",
            "tokenizer.json",
            "tokenizer_config.json",
            "special_tokens_map.json",
            "added_tokens.json",
            "vocab.json",
            "normalizer.json",
            "quantize_config.json",
            "onnx/encoder_model_fp16.onnx",
            "onnx/decoder_model_merged_q4.onnx",
        ],
    },
}


def format_bytes(num_bytes: int) -> str:
    for unit in ["B", "KB", "MB", "GB"]:
        if num_bytes < 1024:
            return f"{num_bytes:.1f} {unit}"
        num_bytes /= 1024
    return f"{num_bytes:.1f} TB"


def get_local_models_status() -> List[Dict[str, Any]]:
    """Returns the local on-disk status of all supported presets."""
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    results = []

    for key, preset in MODEL_PRESETS.items():
        target_dir = MODELS_DIR / preset["dir_name"]
        is_ready = False
        total_size = 0
        missing = []

        if target_dir.exists():
            all_present = True
            for f in preset["files"]:
                file_path = target_dir / f
                if not file_path.exists() or file_path.stat().st_size == 0:
                    all_present = False
                    missing.append(f)
                else:
                    total_size += file_path.stat().st_size
            is_ready = all_present and len(missing) == 0

        results.append({
            "key": key,
            "repo_id": preset["repo_id"],
            "dir_name": preset["dir_name"],
            "is_ready": is_ready,
            "total_size_bytes": total_size,
            "total_size_formatted": format_bytes(total_size) if total_size > 0 else "0 B",
            "missing_files": missing,
        })
    return results


def download_file(url: str, dest_path: Path, progress_cb: Optional[Callable[[str, int, int], None]] = None) -> None:
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = dest_path.with_suffix(dest_path.suffix + ".part")

    req = urllib.request.Request(url, headers={"User-Agent": "OneEAD-Say/1.0"})

    with urllib.request.urlopen(req) as resp, open(temp_path, "wb") as f_out:
        total_size = int(resp.headers.get("Content-Length", 0))
        downloaded = 0
        chunk_size = 1024 * 512  # 512 KB
        start_time = time.time()

        while True:
            chunk = resp.read(chunk_size)
            if not chunk:
                break
            f_out.write(chunk)
            downloaded += len(chunk)

            if progress_cb:
                progress_cb(dest_path.name, downloaded, total_size)
            elif total_size > 0:
                elapsed = max(0.1, time.time() - start_time)
                speed = downloaded / elapsed
                pct = (downloaded / total_size) * 100
                bar = "#" * int(pct // 4) + "-" * (25 - int(pct // 4))
                sys.stdout.write(
                    f"\r  [{bar}] {pct:5.1f}% | {format_bytes(downloaded)}/{format_bytes(total_size)} | {format_bytes(int(speed))}/s  "
                )
                sys.stdout.flush()

    if not progress_cb and total_size > 0:
        sys.stdout.write("\n")

    temp_path.replace(dest_path)


def download_model_files(model_key: str = "whisper-large-v3-turbo") -> bool:
    preset = MODEL_PRESETS.get(model_key)
    if not preset:
        print(f"[Error] Unknown model preset: {model_key}. Available: {list(MODEL_PRESETS.keys())}")
        return False

    repo_id = preset["repo_id"]
    dir_name = preset["dir_name"]
    files = preset["files"]
    base_dir = MODELS_DIR / dir_name

    print(f"\n=======================================================")
    print(f" Downloading model preset: {model_key}")
    print(f" Source: https://huggingface.co/{repo_id}")
    print(f" Target: {base_dir}")
    print(f"=======================================================\n")

    for idx, rel_path in enumerate(files, 1):
        target_path = base_dir / rel_path
        if target_path.exists() and target_path.stat().st_size > 0:
            print(f"[{idx}/{len(files)}] {rel_path} (Already downloaded - {format_bytes(target_path.stat().st_size)})")
            continue

        file_url = f"https://huggingface.co/{repo_id}/resolve/main/{rel_path}"
        print(f"[{idx}/{len(files)}] Downloading {rel_path}...")
        try:
            download_file(file_url, target_path)
            print(f"  -> Saved {rel_path} ({format_bytes(target_path.stat().st_size)})")
        except Exception as exc:
            print(f"\n[Error] Failed to download {rel_path}: {exc}")
            return False

    print(f"\nModel {model_key} successfully downloaded and cached on disk for offline use!")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="Download and cache Whisper models for One EAD offline use.")
    parser.add_argument(
        "--model",
        choices=list(MODEL_PRESETS.keys()),
        default="whisper-large-v3-turbo",
        help="Model preset to download",
    )
    parser.add_argument(
        "--status",
        action="store_true",
        help="Show status of locally cached models on disk",
    )
    args = parser.parse_args()

    if args.status:
        statuses = get_local_models_status()
        print("\nLocally Cached Models Status:")
        for s in statuses:
            status_str = f"READY ({s['total_size_formatted']})" if s["is_ready"] else "NOT DOWNLOADED / INCOMPLETE"
            print(f" - {s['key']}: {status_str}")
        return

    success = download_model_files(args.model)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
