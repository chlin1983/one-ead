"""PdfCraft — Rust PDF Workbench & Editor plugin for One EAD.

High-performance, local PDF workbench built with pure Rust and WebAssembly.
Supports viewing, organizing pages, combining, splitting, form filling, and
searching without any cloud dependencies.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Body, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response

from modules.pdfcraft import pdfcraft
from server.module import PortalModule

ICON = (
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>'
    '<polyline points="14 2 14 8 20 8"/>'
    '<path d="M9 13h6"/>'
    '<path d="M9 17h4"/>'
    '<polygon points="15 11 18 8 20 10 17 13" fill="currentColor" fill-opacity="0.25"/>'
    '</svg>'
)

router = APIRouter()


@router.get("/status")
def tool_status() -> dict:
    return pdfcraft.status()


@router.post("/check")
def check_updates() -> dict:
    pdfcraft.check_latest(force=True)
    return pdfcraft.status()


@router.post("/install")
def install(payload: dict = Body(default={})) -> dict:
    return pdfcraft.start_install(force=bool(payload.get("force")))


@router.post("/config")
def configure(payload: dict = Body(...)) -> dict:
    pdfcraft.set_config(payload)
    return pdfcraft.status()


@router.get("/docs")
def list_docs() -> list[dict]:
    return pdfcraft.list_documents()


@router.post("/upload")
async def upload_doc(file: UploadFile = File(...)) -> dict:
    if not file.filename:
        raise HTTPException(400, "Missing filename")
    content = await file.read()
    if not content:
        raise HTTPException(400, "Empty file")
    return pdfcraft.save_uploaded_document(file.filename, content)


@router.get("/doc/{filename:path}")
def get_doc(filename: str) -> FileResponse:
    p = pdfcraft.get_document_path(filename)
    if not p:
        raise HTTPException(404, "Document not found")
    # Add CORS and streaming headers so WebAssembly fetch inside iframe succeeds
    return FileResponse(
        path=str(p),
        media_type="application/pdf",
        filename=p.name,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Headers": "*",
            "Cache-Control": "public, max-age=3600",
        },
    )


@router.delete("/doc/{filename:path}")
def delete_doc(filename: str) -> dict:
    success = pdfcraft.delete_document(filename)
    if not success:
        raise HTTPException(404, "Document not found")
    return {"status": "ok", "deleted": filename}


@router.post("/reveal")
def reveal_folder() -> dict:
    return pdfcraft.reveal_docs_dir()


MODULE = PortalModule(
    id="pdfcraft",
    title="PdfCraft",
    subtitle="Rust PDF Workbench & Editor",
    icon=ICON,
    accent="#12a58a",
    order=85,
    web_dir="web",
    router=router,
)
