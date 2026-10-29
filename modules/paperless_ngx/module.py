"""Paperless-ngx module for One EAD.

Document management, local OCR, and full-text search vault with 100% offline privacy.
Documents are stored securely in ~/Documents/OneEAD_Archive outside git.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse

from modules.paperless_ngx import manager, ocr_engine
from server.module import PortalModule

ICON = (
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>'
    '<polyline points="14 2 14 8 20 8"/>'
    '<line x1="16" y1="13" x2="8" y2="13"/>'
    '<line x1="16" y1="17" x2="8" y2="17"/>'
    '<polyline points="10 9 9 9 8 9"/>'
    '</svg>'
)

router = APIRouter()


@router.get("/stats")
def get_stats() -> dict:
    return manager.get_vault_stats()


@router.get("/tesseract")
def get_tesseract() -> dict:
    return ocr_engine.get_tesseract_info()


@router.post("/open-explorer")
def open_explorer(subfolder: str = "", doc_id: str = "") -> dict:
    return manager.open_vault_in_explorer(subfolder=subfolder, doc_id=doc_id)


@router.get("/documents")
def list_documents(q: str = "", tag: str = "", status: str = "") -> dict:
    docs = manager.list_documents(query=q, tag=tag, status=status)
    return {"documents": docs, "count": len(docs)}


@router.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    tags: str = Form(""),
    category: str = Form(""),
    auto_ocr: bool = Form(True),
    lang: str = Form("eng"),
) -> dict:
    if not file.filename:
        raise HTTPException(400, "Filename is required.")
    
    content = await file.read()
    if len(content) == 0:
        raise HTTPException(400, "Uploaded file is empty.")

    doc = manager.save_uploaded_document(
        filename=file.filename,
        file_bytes=content,
        tags=tags,
        category=category,
        auto_ocr=auto_ocr,
        lang=lang,
    )
    return {"ok": True, "document": doc}


@router.get("/documents/{doc_id}")
def get_document_meta(doc_id: str) -> dict:
    doc = manager.get_document(doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    return {"document": doc}


_highlight_cache: dict[str, bytes] = {}


@router.get("/documents/{doc_id}/match-page")
def get_document_match_page(doc_id: str, q: str = "") -> dict:
    pages = manager.find_all_query_pages(doc_id, q)
    first_page = pages[0] if pages else 1
    return {
        "doc_id": doc_id,
        "query": q,
        "page": first_page,
        "pages": pages,
        "total": len(pages),
    }


@router.get("/documents/{doc_id}/markdown")
def get_document_markdown(doc_id: str, limit: Optional[int] = None):
    doc = manager.get_document(doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    md = manager.get_document_markdown(doc_id)
    if limit and limit > 0 and len(md) > limit:
        total_len = len(md)
        md = md[:limit] + f"\n\n\n---\n[Showing fast preview of first {limit:,} characters. Total document length is {total_len:,} characters.]"
    return PlainTextResponse(md, media_type="text/markdown; charset=utf-8")


@router.get("/documents/{doc_id}/download")
def download_document(doc_id: str):
    doc = manager.get_document(doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    file_path = manager.get_documents_dir() / doc["filename"]
    if not file_path.is_file():
        manager.delete_document(doc_id)
        raise HTTPException(404, f"File '{doc['original_name']}' was removed from external vault. Database record cleaned.")
    return FileResponse(
        path=str(file_path),
        filename=doc["original_name"],
        media_type=doc.get("mime_type", "application/octet-stream"),
    )


@router.get("/documents/{doc_id}/view")
def view_document(doc_id: str, p: Optional[int] = None, q: Optional[str] = None):
    doc = manager.get_document(doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    file_path = manager.get_documents_dir() / doc["filename"]
    if not file_path.is_file():
        manager.delete_document(doc_id)
        raise HTTPException(404, f"File '{doc['original_name']}' was removed from external vault. Database record cleaned.")

    # Pipeline A: Get or generate high-fidelity PDF preview for right-panel inline viewing
    preview_path = manager.get_or_create_preview_pdf(doc_id)
    target_path = preview_path if (preview_path and preview_path.is_file()) else file_path

    stem = Path(doc["original_name"]).stem
    pdf_filename = f"{stem}.pdf"

    clean_q = (q or "").strip()
    if clean_q and target_path.suffix.lower() == ".pdf":
        cache_key = f"{doc_id}:{clean_q.lower()}"
        if cache_key in _highlight_cache:
            return Response(
                content=_highlight_cache[cache_key],
                media_type="application/pdf",
                headers={
                    "Content-Disposition": f"inline; filename=\"{pdf_filename}\"",
                    "Cache-Control": "public, max-age=3600",
                },
            )

        try:
            import pymupdf
            pdf_doc = pymupdf.open(str(target_path))
            has_matches = False
            for page in pdf_doc:
                rects = page.search_for(clean_q)
                for r in rects:
                    has_matches = True
                    annot = page.add_highlight_annot(r)
                    annot.set_colors(stroke=(1.0, 0.90, 0.0))  # Vivid yellow highlight
                    annot.set_opacity(0.6)
                    annot.update()

            if has_matches:
                pdf_bytes = pdf_doc.tobytes(deflate=True)
                pdf_doc.close()
                if len(_highlight_cache) > 40:
                    _highlight_cache.pop(next(iter(_highlight_cache)))
                _highlight_cache[cache_key] = pdf_bytes
                return Response(
                    content=pdf_bytes,
                    media_type="application/pdf",
                    headers={
                        "Content-Disposition": f"inline; filename=\"{pdf_filename}\"",
                        "Cache-Control": "public, max-age=3600",
                    },
                )
            pdf_doc.close()
        except Exception as exc:
            import logging
            logging.getLogger("paperless_ngx").warning("Failed highlighting PDF on view: %s", exc)

    if target_path.suffix.lower() == ".pdf":
        return FileResponse(
            path=str(target_path),
            media_type="application/pdf",
            headers={"Content-Disposition": f"inline; filename=\"{pdf_filename}\""},
        )

    return FileResponse(
        path=str(target_path),
        media_type=doc.get("mime_type", "application/octet-stream"),
        headers={"Content-Disposition": f"inline; filename=\"{doc['original_name']}\""},
    )


@router.get("/documents/{doc_id}/thumbnail")
def get_document_thumbnail(doc_id: str):
    thumb_path = manager.get_or_create_thumbnail(doc_id)
    if thumb_path and thumb_path.is_file():
        return FileResponse(
            path=str(thumb_path),
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=86400, immutable"},
        )
    raise HTTPException(404, "Thumbnail not available")


@router.post("/documents/{doc_id}/ocr")
def trigger_ocr(doc_id: str, lang: str = "eng") -> dict:
    try:
        updated = manager.process_document_ocr(doc_id, lang=lang, auto_sync_weknora=True)
        weknora_synced = False
        weknora_file = None
        if updated:
            base_stem = Path(updated.get("original_name", "")).stem
            weknora_file = f"{base_stem}_ocr.md"
            fallback_path = Path(__file__).resolve().parent.parent / "weknora" / "data" / "files" / weknora_file
            weknora_synced = fallback_path.is_file()
        return {
            "ok": True,
            "document": updated,
            "weknora_synced": weknora_synced,
            "weknora_file": weknora_file,
        }
    except Exception as exc:
        raise HTTPException(500, f"OCR processing failed: {exc}")


@router.put("/documents/{doc_id}/tags")
def update_tags(doc_id: str, tags: str = Form(...)) -> dict:
    updated = manager.update_document_tags(doc_id, tags)
    if not updated:
        raise HTTPException(404, "Document not found")
    return {"ok": True, "document": updated}


@router.delete("/documents/{doc_id}")
def delete_document(doc_id: str) -> dict:
    success = manager.delete_document(doc_id)
    if not success:
        raise HTTPException(404, "Document not found")
    to_del = [k for k in _highlight_cache if k.startswith(f"{doc_id}:")]
    for k in to_del:
        _highlight_cache.pop(k, None)
    return {"ok": True}


@router.post("/documents/{doc_id}/sync-weknora")
def sync_to_weknora(doc_id: str) -> dict:
    try:
        res = manager.copy_to_weknora_vault(doc_id)
        return res
    except Exception as exc:
        raise HTTPException(500, f"Failed to sync to WeKnora: {exc}")


@router.post("/scan")
def scan_vault(auto_ocr: bool = True, lang: str = "eng") -> dict:
    """Manually triggers an immediate scan of ~/Documents/OneEAD_Archive/documents."""
    return manager.scan_and_sync_vault(auto_ocr=auto_ocr, lang=lang)


MODULE = PortalModule(
    id="paperless-ngx",
    title="Paperless-ngx",
    subtitle="Document archive & offline OCR",
    icon=ICON,
    accent="#059669",
    order=96,
    badge=None,
    web_dir="web",
    router=router,
)

# Automatically start background vault watcher on module load
try:
    manager.start_vault_watcher(interval_sec=20)
except Exception as _watcher_err:
    import logging
    logging.getLogger("paperless_ngx").warning("Failed to start vault watcher: %s", _watcher_err)

