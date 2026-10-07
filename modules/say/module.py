"""Say — High-accuracy local speech-to-text dictation & transcription plugin.

Powered by Transformers.js v3 running ONNX-optimized Whisper Large-v3-Turbo
with WebGPU acceleration and mixed-precision (FP16/Q4) quantization.
100% private and runs entirely on the client side.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import JSONResponse

from server.module import PortalModule

ICON = (
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>'
    '<path d="M19 10v2a7 7 0 0 1-14 0v-2"/>'
    '<line x1="12" y1="19" x2="12" y2="22"/>'
    '<line x1="8" y1="22" x2="16" y2="22"/>'
    '</svg>'
)

router = APIRouter()

STORAGE_DIR = Path(__file__).resolve().parent.parent.parent / "scratch" / "dictations"


def _ensure_storage_dir() -> Path:
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    return STORAGE_DIR


def _safe_filename(name: str) -> str:
    cleaned = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', name.strip())
    return cleaned[:80] or "transcript"


@router.get("/status")
def plugin_status() -> Dict[str, Any]:
    """Returns the backend status and recommended configuration for Say."""
    return {
        "status": "ready",
        "plugin": "say",
        "version": "3.0.0",
        "engine": "@huggingface/transformers-v3",
        "recommended_model": "onnx-community/whisper-large-v3-turbo",
        "recommended_device": "webgpu",
        "dtype": {
            "encoder_model": "fp16",
            "decoder_model_merged": "q4",
        },
        "description": "High-accuracy local Whisper dictation powered by WebGPU and FP16/Q4 mixed precision.",
    }


@router.post("/export")
def export_transcript(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Saves a transcript to a local file on disk."""
    title = payload.get("title", "Dictation")
    content = payload.get("content", "")
    metadata = payload.get("metadata", {})
    file_format = payload.get("format", "md").lower()

    if not content:
        raise HTTPException(status_code=400, detail="Transcript content cannot be empty.")

    storage = _ensure_storage_dir()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_title = _safe_filename(title.lower().replace(" ", "_"))
    filename = f"{safe_title}_{timestamp}.{file_format}"
    target_path = storage / filename

    try:
        if file_format == "json":
            export_data = {
                "title": title,
                "timestamp": datetime.now().isoformat(),
                "metadata": metadata,
                "content": content,
            }
            with open(target_path, "w", encoding="utf-8") as f:
                json.dump(export_data, f, indent=2, ensure_ascii=False)
        else:
            with open(target_path, "w", encoding="utf-8") as f:
                f.write(content)

        return {
            "status": "ok",
            "filename": filename,
            "path": str(target_path),
            "size_bytes": target_path.stat().st_size,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to write file: {exc}")


@router.get("/exports")
def list_exported_transcripts() -> List[Dict[str, Any]]:
    """Lists all saved transcripts in the local storage directory."""
    storage = _ensure_storage_dir()
    files: List[Dict[str, Any]] = []
    for item in sorted(storage.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if item.is_file() and item.suffix in [".md", ".txt", ".json"]:
            files.append({
                "filename": item.name,
                "size_bytes": item.stat().st_size,
                "modified": datetime.fromtimestamp(item.stat().st_mtime).isoformat(),
            })
    return files


@router.delete("/exports/{filename}")
def delete_exported_transcript(filename: str) -> Dict[str, Any]:
    """Deletes an exported transcript from disk."""
    storage = _ensure_storage_dir()
    safe_name = _safe_filename(filename)
    target_path = storage / safe_name
    if not target_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    target_path.unlink()
    return {"status": "ok", "deleted": safe_name}


MODULE = PortalModule(
    id="say",
    title="Say — Voice Dictation",
    subtitle="High-accuracy local Whisper Large-v3-Turbo (WebGPU)",
    icon=ICON,
    accent="#10b981",
    order=85,
    web_dir="web",
    router=router,
)
