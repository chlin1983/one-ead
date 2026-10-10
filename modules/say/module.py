"""Say — High-accuracy local speech-to-text dictation & transcription plugin.

Powered by Transformers.js v3 running ONNX-optimized Whisper Large-v3-Turbo
with WebGPU acceleration and mixed-precision (FP16/Q4) quantization.
100% private and runs entirely on the client side.
"""

from __future__ import annotations

import json
import mimetypes
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse

mimetypes.add_type("application/octet-stream", ".onnx")
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("text/javascript", ".mjs")

from server.module import PortalModule

ICON = (
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
    # Line-art head facing right: open skull arc, forehead, nose, lips, chin and a curved neck; three sound waves.
    '<path d="M2.6 14C1.3 12.4.9 10.8 1 9.2 1.2 5.4 4.2 2.9 8 2.9c3.8 0 6.8 1.9 7 4.9L15.1 9.4 16.4 13.1 15.4 13.9 15.9 15 14.6 15.7 15.3 16.7 14.5 18.3C13.2 19.3 12 19.4 11 19.4 10.2 19.5 10.1 20.2 10.1 21"/>'
    '<path d="M17.4 10a5 5 0 0 1 0 6.3"/>'
    '<path d="M18.8 8.5a6 6 0 0 1 0 9.1"/>'
    '<path d="M20.2 7.2a8 8 0 0 1 0 11.8"/>'
    '</svg>'
)

router = APIRouter()

SAY_DIR = Path(__file__).resolve().parent
DATA_DIR = SAY_DIR / "data"
NOTES_DIR = DATA_DIR / "notes"
RECORDINGS_DIR = DATA_DIR / "recordings"
STORAGE_DIR = Path(__file__).resolve().parent.parent.parent / "scratch" / "dictations"


def _ensure_dirs() -> None:
    NOTES_DIR.mkdir(parents=True, exist_ok=True)
    RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)


def _safe_id(note_id: str) -> str:
    cleaned = re.sub(r'[^a-zA-Z0-9_\-]', '', note_id.strip())
    return cleaned[:80] or f"note_{int(datetime.now().timestamp() * 1000)}"


def _safe_filename(name: str) -> str:
    cleaned = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', name.strip())
    return cleaned[:80] or "transcript"


_faster_whisper_models: Dict[str, Any] = {}

def get_faster_whisper_model(model_name: str = "base"):
    clean_name = model_name.replace("faster-whisper-", "").replace("server/", "").strip() or "base"
    if clean_name not in _faster_whisper_models:
        import faster_whisper
        _faster_whisper_models[clean_name] = faster_whisper.WhisperModel(
            clean_name,
            device="cpu",
            compute_type="int8",
            cpu_threads=4,
        )
    return _faster_whisper_models[clean_name], clean_name


@router.get("/status")
def plugin_status() -> Dict[str, Any]:
    """Returns the backend status and recommended configuration for Say."""
    return {
        "status": "ready",
        "plugin": "say",
        "version": "3.1.0",
        "default_model": "onnx-community/moonshine-tiny-ONNX",
        "system_ram_gb": 16,
        "recommended_architecture": "Lightweight CPU-First (Moonshine Tiny / faster-whisper)",
        "description": "Local AI speech dictation supporting lightweight CPU-first models and 16GB Host System RAM transcription.",
    }


@router.post("/transcribe")
async def transcribe_audio(
    request: Request,
    note_id: Optional[str] = None,
    model: str = "base",
    language: Optional[str] = None,
    task: str = "transcribe",
    prompt: Optional[str] = None,
) -> Dict[str, Any]:
    """Transcribes audio using host CPU memory (16GB RAM) via faster-whisper.
    Completely avoids browser WebGPU and WASM memory exhaustion limits.
    """
    _ensure_dirs()
    import io
    import time

    audio_bytes = await request.body()
    audio_source = None

    if audio_bytes and len(audio_bytes) > 0:
        audio_source = io.BytesIO(audio_bytes)
    elif note_id:
        sid = _safe_id(note_id)
        target = RECORDINGS_DIR / f"{sid}.webm"
        if target.is_file():
            audio_source = str(target)

    if not audio_source:
        raise HTTPException(status_code=400, detail="No audio provided for transcription.")

    try:
        t0 = time.time()
        whisper_model, clean_name = get_faster_whisper_model(model)

        transcribe_kwargs: Dict[str, Any] = {
            "beam_size": 1,
            "task": task or "transcribe",
        }
        if language and language != "auto":
            transcribe_kwargs["language"] = language
        if prompt:
            transcribe_kwargs["initial_prompt"] = prompt

        segments, info = whisper_model.transcribe(audio_source, **transcribe_kwargs)

        chunks = []
        text_parts = []
        for s in segments:
            clean_text = s.text.strip()
            if clean_text:
                chunks.append({
                    "timestamp": [round(s.start, 2), round(s.end, 2)],
                    "text": clean_text,
                })
                text_parts.append(clean_text)

        t_infer = time.time() - t0
        full_text = " ".join(text_parts)
        audio_dur = round(info.duration, 2) if hasattr(info, "duration") and info.duration else 0.0
        speed = round(audio_dur / max(0.01, t_infer), 1)

        return {
            "text": full_text,
            "chunks": chunks,
            "stats": {
                "engine": "faster-whisper (Host 16GB RAM)",
                "device": "cpu",
                "model": clean_name,
                "language": info.language if hasattr(info, "language") else "auto",
                "inferenceTimeSec": f"{t_infer:.2f}",
                "audioDurationSec": f"{audio_dur:.2f}",
                "speedMultiplier": f"{speed}x",
            },
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {exc}")


@router.get("/models")
def list_local_models() -> List[Dict[str, Any]]:
    """Lists status of offline ONNX models saved on local disk."""
    try:
        from modules.say.download_model import get_local_models_status
        return get_local_models_status()
    except Exception as exc:
        return [{"error": str(exc)}]


@router.post("/models/download")
def trigger_model_download(payload: Dict[str, Any] = Body(default={})) -> Dict[str, Any]:
    """Triggers background download of model weights to local disk."""
    model_key = payload.get("model", "moonshine-tiny")
    import threading
    from modules.say.download_model import download_model_files

    t = threading.Thread(target=download_model_files, args=(model_key,), daemon=True)
    t.start()
    return {"status": "started", "model": model_key}


@router.get("/notes")
def list_notes() -> List[Dict[str, Any]]:
    """Returns all dictation notes stored on disk, ordered by latest update."""
    _ensure_dirs()
    notes: List[Dict[str, Any]] = []
    for f in sorted(NOTES_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            with open(f, "r", encoding="utf-8") as fp:
                data = json.load(fp)
            note_id = data.get("id") or f.stem
            audio_path = RECORDINGS_DIR / f"{note_id}.webm"
            data["hasAudio"] = audio_path.is_file() and audio_path.stat().st_size > 0
            if data["hasAudio"]:
                data["audioUrl"] = f"/api/say/recordings/{note_id}"
                data["audioSizeBytes"] = audio_path.stat().st_size
            notes.append(data)
        except Exception:
            continue
    return notes


@router.get("/notes/{note_id}")
def get_note(note_id: str) -> Dict[str, Any]:
    """Retrieves a single note from disk."""
    _ensure_dirs()
    sid = _safe_id(note_id)
    target = NOTES_DIR / f"{sid}.json"
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Note not found")
    try:
        with open(target, "r", encoding="utf-8") as fp:
            data = json.load(fp)
        audio_path = RECORDINGS_DIR / f"{sid}.webm"
        data["hasAudio"] = audio_path.is_file() and audio_path.stat().st_size > 0
        if data["hasAudio"]:
            data["audioUrl"] = f"/api/say/recordings/{sid}"
            data["audioSizeBytes"] = audio_path.stat().st_size
        return data
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read note: {exc}")


@router.post("/notes/{note_id}")
def save_note(note_id: str, payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Persists a note to disk atomically."""
    _ensure_dirs()
    sid = _safe_id(note_id)
    payload["id"] = sid
    if "updatedAt" not in payload:
        payload["updatedAt"] = int(datetime.now().timestamp() * 1000)

    audio_path = RECORDINGS_DIR / f"{sid}.webm"
    has_audio = audio_path.is_file() and audio_path.stat().st_size > 0
    payload["hasAudio"] = has_audio
    if has_audio:
        payload["audioUrl"] = f"/api/say/recordings/{sid}"
        payload["audioSizeBytes"] = audio_path.stat().st_size

    target = NOTES_DIR / f"{sid}.json"
    temp_target = NOTES_DIR / f"{sid}.tmp"
    try:
        with open(temp_target, "w", encoding="utf-8") as fp:
            json.dump(payload, fp, indent=2, ensure_ascii=False)
        temp_target.replace(target)
        return {"status": "ok", "id": sid, "updatedAt": payload["updatedAt"], "hasAudio": has_audio}
    except Exception as exc:
        if temp_target.is_file():
            temp_target.unlink()
        raise HTTPException(status_code=500, detail=f"Failed to save note: {exc}")


@router.delete("/notes/{note_id}")
def delete_note(note_id: str) -> Dict[str, Any]:
    """Deletes a note and its recorded audio file from disk."""
    _ensure_dirs()
    sid = _safe_id(note_id)
    target = NOTES_DIR / f"{sid}.json"
    audio_target = RECORDINGS_DIR / f"{sid}.webm"
    if target.is_file():
        target.unlink()
    if audio_target.is_file():
        audio_target.unlink()
    return {"status": "ok", "deleted": sid}


@router.post("/recordings/{note_id}")
async def upload_recording(note_id: str, request: Request) -> Dict[str, Any]:
    """Saves raw recorded audio bytes to disk for permanent session persistence."""
    _ensure_dirs()
    sid = _safe_id(note_id)
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Empty audio recording body")

    target = RECORDINGS_DIR / f"{sid}.webm"
    try:
        with open(target, "wb") as fp:
            fp.write(body)

        # Update note JSON metadata if present
        note_target = NOTES_DIR / f"{sid}.json"
        if note_target.is_file():
            try:
                with open(note_target, "r", encoding="utf-8") as fp:
                    data = json.load(fp)
                data["hasAudio"] = True
                data["audioUrl"] = f"/api/say/recordings/{sid}"
                data["audioSizeBytes"] = len(body)
                with open(note_target, "w", encoding="utf-8") as fp:
                    json.dump(data, fp, indent=2, ensure_ascii=False)
            except Exception:
                pass

        return {
            "status": "ok",
            "id": sid,
            "size_bytes": len(body),
            "audio_url": f"/api/say/recordings/{sid}",
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save recording: {exc}")


@router.get("/recordings/{note_id}")
def stream_recording(note_id: str):
    """Streams a saved recording with HTTP Range support for audio scrubbing & timestamps."""
    _ensure_dirs()
    sid = _safe_id(note_id)
    target = RECORDINGS_DIR / f"{sid}.webm"
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Audio recording not found")
    return FileResponse(
        path=str(target),
        media_type="audio/webm",
        filename=f"{sid}.webm",
    )


@router.post("/export")
def export_transcript(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Saves a transcript to a local file on disk."""
    title = payload.get("title", "Dictation")
    content = payload.get("content", "")
    metadata = payload.get("metadata", {})
    file_format = payload.get("format", "md").lower()

    if not content:
        raise HTTPException(status_code=400, detail="Transcript content cannot be empty.")

    _ensure_dirs()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_title = _safe_filename(title.lower().replace(" ", "_"))
    filename = f"{safe_title}_{timestamp}.{file_format}"
    target_path = STORAGE_DIR / filename

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
    _ensure_dirs()
    files: List[Dict[str, Any]] = []
    for item in sorted(STORAGE_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
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
    _ensure_dirs()
    safe_name = _safe_filename(filename)
    target_path = STORAGE_DIR / safe_name
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
