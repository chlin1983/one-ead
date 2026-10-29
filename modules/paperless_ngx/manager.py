"""Vault manager and document archive engine for One EAD Paperless-ngx.

Stores documents strictly in an external vault outside the git repository
(default: ~/Documents/OneEAD_Archive) ensuring 100% data privacy from AI tooling
and version control. Provides full-text FTS5 search and 1-click Explorer integration.
"""

from __future__ import annotations

import atexit
from datetime import datetime
import hashlib
import html
import httpx
import json
import logging
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import threading
import time
from typing import Any, Dict, List, Optional
import uuid

from modules.paperless_ngx import ocr_engine

logger = logging.getLogger("one_ead.paperless.manager")


def get_vault_path() -> Path:
    """Returns the external vault path, honoring ONEEAD_ARCHIVE_DIR if configured."""
    custom = os.environ.get("ONEEAD_ARCHIVE_DIR")
    if custom:
        p = Path(custom)
    else:
        p = Path.home() / "Documents" / "OneEAD_Archive"
    return p


def get_db_path() -> Path:
    return get_vault_path() / "meta.db"


def get_documents_dir() -> Path:
    return get_vault_path() / "documents"


def get_ocr_cache_dir() -> Path:
    return get_vault_path() / "ocr_cache"


def get_thumbnails_dir() -> Path:
    return get_vault_path() / "thumbnails"


def get_previews_dir() -> Path:
    return get_vault_path() / "previews"


def init_vault() -> None:
    """Ensures vault folders and SQLite FTS5 tables exist."""
    vault = get_vault_path()
    docs_dir = get_documents_dir()
    ocr_dir = get_ocr_cache_dir()
    thumbs_dir = get_thumbnails_dir()
    previews_dir = get_previews_dir()

    vault.mkdir(parents=True, exist_ok=True)
    docs_dir.mkdir(parents=True, exist_ok=True)
    ocr_dir.mkdir(parents=True, exist_ok=True)
    thumbs_dir.mkdir(parents=True, exist_ok=True)
    previews_dir.mkdir(parents=True, exist_ok=True)

    db_path = get_db_path()
    with sqlite3.connect(str(db_path)) as con:
        cur = con.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                original_name TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                file_hash TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                tags TEXT DEFAULT '',
                page_count INTEGER DEFAULT 0,
                ocr_pages INTEGER DEFAULT 0,
                ocr_status TEXT DEFAULT 'pending',
                error_msg TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            """
        )
        cur.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(
                doc_id UNINDEXED,
                title,
                content,
                tags,
                tokenize='unicode61'
            );
            """
        )
        con.commit()

        # Ensure FTS text is populated if documents lack full text
        try:
            cur.execute("SELECT count(*) FROM document_fts WHERE length(content) < 150")
            short_count = cur.fetchone()[0] or 0
            if short_count > 0:
                weknora_db = get_vault_path() / "weknora_data" / "weknora.db"
                if weknora_db.is_file():
                    with sqlite3.connect(str(weknora_db)) as wek_con:
                        wek_cur = wek_con.cursor()
                        cur.execute("SELECT id, original_name, tags FROM documents")
                        docs_to_sync = cur.fetchall()
                        for doc_id, orig_name, tags in docs_to_sync:
                            wek_cur.execute(
                                "SELECT content FROM chunks WHERE knowledge_id = ? ORDER BY chunk_index ASC",
                                (doc_id,),
                            )
                            chunks = [r[0] for r in wek_cur.fetchall() if r[0]]
                            if not chunks:
                                wek_cur.execute("SELECT id FROM knowledges WHERE file_name = ?", (orig_name,))
                                for kr in wek_cur.fetchall():
                                    wek_cur.execute(
                                        "SELECT content FROM chunks WHERE knowledge_id = ? ORDER BY chunk_index ASC",
                                        (kr[0],),
                                    )
                                    c_list = [r[0] for r in wek_cur.fetchall() if r[0]]
                                    if len(c_list) > len(chunks):
                                        chunks = c_list
                            if chunks:
                                full_text = "\n\n".join(chunks)
                                cache_file = get_ocr_cache_dir() / f"{doc_id}.md"
                                if not cache_file.is_file():
                                    cache_file.write_text(full_text, encoding="utf-8")
                                cur.execute("DELETE FROM document_fts WHERE doc_id = ?", (doc_id,))
                                cur.execute(
                                    "INSERT INTO document_fts (doc_id, title, content, tags) VALUES (?, ?, ?, ?)",
                                    (doc_id, orig_name, full_text, tags),
                                )
                                cur.execute(
                                    "UPDATE documents SET page_count = ?, ocr_pages = ?, ocr_status = 'completed' WHERE id = ?",
                                    (max(1, len(chunks) // 10), len(chunks), doc_id),
                                )
                    con.commit()
        except Exception as e:
            logger.warning("FTS auto-sync check: %s", e)


def get_db_connection() -> sqlite3.Connection:
    init_vault()
    con = sqlite3.connect(str(get_db_path()), timeout=15)
    con.row_factory = sqlite3.Row
    return con


def get_vault_stats() -> Dict[str, Any]:
    """Returns overall archive status, storage metrics, and OCR availability."""
    init_vault()
    tess_info = ocr_engine.get_tesseract_info()

    with get_db_connection() as con:
        cur = con.cursor()
        cur.execute("SELECT COUNT(*), SUM(file_size), SUM(page_count) FROM documents")
        row = cur.fetchone()
        doc_count = row[0] or 0
        total_size = row[1] or 0
        total_pages = row[2] or 0

        cur.execute("SELECT COUNT(*) FROM documents WHERE ocr_status = 'completed'")
        ocr_completed = cur.fetchone()[0] or 0

        cur.execute("SELECT tags, COUNT(*) FROM documents WHERE tags != '' GROUP BY tags ORDER BY COUNT(*) DESC")
        cat_rows = cur.fetchall()
        categories = [{"name": r[0], "count": r[1]} for r in cat_rows]

    return {
        "vault_path": str(get_vault_path()),
        "documents_path": str(get_documents_dir()),
        "document_count": doc_count,
        "total_size_bytes": total_size,
        "total_pages": total_pages,
        "ocr_completed_count": ocr_completed,
        "categories": categories,
        "tesseract": tess_info,
    }


def _force_hwnd_to_top(hwnd: int, folder_name: str = "") -> None:
    """Helper to bring a specific HWND to absolute top of z-order over Google Chrome."""
    try:
        import ctypes
        import time
        from ctypes import wintypes
        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32

        if not hwnd:
            return

        user32.IsWindow.argtypes = [wintypes.HWND]
        user32.IsWindow.restype = wintypes.BOOL
        user32.SetWindowPos.argtypes = [wintypes.HWND, ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_uint]
        user32.SetWindowPos.restype = wintypes.BOOL
        user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
        user32.ShowWindow.restype = wintypes.BOOL
        user32.BringWindowToTop.argtypes = [wintypes.HWND]
        user32.BringWindowToTop.restype = wintypes.BOOL
        user32.SetForegroundWindow.argtypes = [wintypes.HWND]
        user32.SetForegroundWindow.restype = wintypes.BOOL
        user32.GetAncestor.argtypes = [wintypes.HWND, wintypes.UINT]
        user32.GetAncestor.restype = wintypes.HWND

        # Switch to input desktop if available
        try:
            hdesk = user32.OpenInputDesktop(0, False, 0x10000000)
            if hdesk:
                user32.SetThreadDesktop(hdesk)
        except Exception:
            pass

        # Resolve to root window if child window/tab
        root_hwnd = user32.GetAncestor(hwnd, 2) or hwnd
        if not user32.IsWindow(root_hwnd):
            root_hwnd = hwnd

        if not user32.IsWindow(root_hwnd):
            return

        # Restore window if minimized
        if user32.IsIconic(root_hwnd):
            user32.ShowWindow(root_hwnd, 9)  # SW_RESTORE
        else:
            user32.ShowWindow(root_hwnd, 5)  # SW_SHOW

        # Simulate Alt key down/up to bypass Windows ForegroundLockTimeout
        user32.keybd_event(0x12, 0, 0, 0)
        user32.keybd_event(0x12, 0, 2, 0)

        # AttachThreadInput
        cur_thread = kernel32.GetCurrentThreadId()
        fg_hwnd = user32.GetForegroundWindow()
        fg_thread = user32.GetWindowThreadProcessId(fg_hwnd, None)
        target_thread = user32.GetWindowThreadProcessId(root_hwnd, None)

        if fg_thread and fg_thread != cur_thread:
            user32.AttachThreadInput(cur_thread, fg_thread, True)
        if target_thread and target_thread != cur_thread:
            user32.AttachThreadInput(cur_thread, target_thread, True)

        SWP_FLAGS = 0x0001 | 0x0002 | 0x0040  # SWP_NOSIZE | SWP_NOMOVE | SWP_SHOWWINDOW
        HWND_TOPMOST = ctypes.c_void_p(-1)
        HWND_NOTOPMOST = ctypes.c_void_p(-2)

        # Place window at HWND_TOPMOST so it rises above the browser immediately
        user32.SetWindowPos(root_hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_FLAGS)
        user32.BringWindowToTop(root_hwnd)
        user32.SetForegroundWindow(root_hwnd)
        user32.SwitchToThisWindow(root_hwnd, True)

        if fg_thread and fg_thread != cur_thread:
            user32.AttachThreadInput(cur_thread, fg_thread, False)
        if target_thread and target_thread != cur_thread:
            user32.AttachThreadInput(cur_thread, target_thread, False)

        # Release topmost status after a short delay so the window behaves normally
        def _release():
            time.sleep(0.8)
            try:
                user32.SetWindowPos(root_hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010)
            except Exception:
                pass

        threading.Thread(target=_release, daemon=True).start()
    except Exception as exc:
        logger.debug("force_hwnd_to_top skipped: %s", exc)


def _activate_explorer_window(target_path_str: str) -> None:
    """Helper running in background thread to find and bring ONLY the matching Explorer window to foreground.
    Never activates or touches unrelated Explorer windows."""
    import time
    time.sleep(0.4)
    try:
        import ctypes
        from ctypes import wintypes
        user32 = ctypes.windll.user32

        hdesk = user32.OpenDesktopW("Default", 0, False, 0x10000000)
        if hdesk:
            user32.SetThreadDesktop(hdesk)

        target_norm = os.path.normpath(target_path_str).lower()
        folder_name = os.path.basename(target_norm).lower()

        exact_hwnds = []

        EnumWindows = user32.EnumWindows
        EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        EnumWindows.argtypes = [EnumWindowsProc, wintypes.LPARAM]
        EnumWindows.restype = wintypes.BOOL

        def enum_cb(hwnd, lparam):
            if user32.IsWindow(hwnd):
                cbuf = ctypes.create_unicode_buffer(256)
                user32.GetClassNameW(hwnd, cbuf, 256)
                if cbuf.value in ("CabinetWClass", "ExploreWClass"):
                    tlen = user32.GetWindowTextLengthW(hwnd)
                    tbuf = ctypes.create_unicode_buffer(tlen + 1)
                    user32.GetWindowTextW(hwnd, tbuf, tlen + 1)
                    title = tbuf.value.lower()
                    if folder_name and folder_name in title:
                        exact_hwnds.append(hwnd)
                    elif folder_name in ("documents", "oneead_archive", "archive") and any(k in title for k in ("documents", "oneead", "archive")):
                        exact_hwnds.append(hwnd)
            return True

        # Poll up to 5 times (total 1.5s) to allow Explorer to register the window
        for _ in range(5):
            EnumWindows(EnumWindowsProc(enum_cb), 0)
            if exact_hwnds:
                break
            time.sleep(0.3)

        # Also check COM shell.Windows() to locate matching tab's window handle
        if not exact_hwnds:
            try:
                import pythoncom
                import win32com.client
                pythoncom.CoInitialize()
                try:
                    shell = win32com.client.Dispatch("Shell.Application")
                    for w in shell.Windows():
                        try:
                            loc_name = str(w.LocationName or "").lower()
                            loc_url = str(w.LocationURL or "").lower()
                            h = getattr(w, "HWND", 0)
                            if h and user32.IsWindow(h):
                                if folder_name and (folder_name in loc_name or folder_name in loc_url):
                                    if h not in exact_hwnds:
                                        exact_hwnds.insert(0, h)
                                elif folder_name in ("documents", "oneead_archive", "archive") and any(k in loc_name or k in loc_url for k in ("documents", "oneead", "archive")):
                                    if h not in exact_hwnds:
                                        exact_hwnds.append(h)
                        except Exception:
                            pass
                finally:
                    pythoncom.CoUninitialize()
            except Exception:
                pass

        if not exact_hwnds:
            logger.debug("No matching Explorer window found for %s; unrelated windows remain untouched.", folder_name)
            return

        best_hwnd = exact_hwnds[0]
        _force_hwnd_to_top(best_hwnd, folder_name)
    except Exception as exc:
        logger.debug("Foreground activation skipped: %s", exc)


def open_vault_in_explorer(subfolder: str = "", doc_id: str = "") -> Dict[str, Any]:
    """Opens C:\\Users\\Z00314DJ\\Documents\\OneEAD_Archive\\documents (or category folder) in native Windows File Explorer and forces it on top."""
    import threading
    init_vault()
    clean_sub = subfolder.strip().strip("/\\")

    target_file = None
    target_dir = None

    # 1. If doc_id given, lookup document in db
    if doc_id:
        doc = get_document(doc_id)
        if doc and doc.get("filename"):
            candidate = get_documents_dir() / doc["filename"]
            if candidate.exists() and candidate.is_file():
                target_file = candidate
                target_dir = candidate.parent

    # 2. If no target_file yet, check if clean_sub is a file or subfolder
    if not target_file:
        if clean_sub and (get_documents_dir() / clean_sub).is_file():
            target_file = get_documents_dir() / clean_sub
            target_dir = target_file.parent
        elif not clean_sub or clean_sub.lower() in ("documents", "root", "archive", "oneead_archive"):
            target_dir = get_documents_dir()  # C:\Users\Z00314DJ\Documents\OneEAD_Archive\documents
        else:
            target_dir = get_documents_dir() / clean_sub

    target_dir.mkdir(parents=True, exist_ok=True)
    dir_str = str(target_dir.resolve())

    # 3. Check if an existing OneEAD window is already open in COM; navigate and focus it directly
    found_existing = False
    try:
        import pythoncom
        import win32com.client
        pythoncom.CoInitialize()
        try:
            shell = win32com.client.Dispatch("Shell.Application")
            for w in shell.Windows():
                try:
                    url = str(w.LocationURL or "").lower()
                    name = str(w.LocationName or "").lower()
                    if "oneead_archive" in url or "oneead" in name:
                        w.Navigate2(dir_str)
                        _force_hwnd_to_top(w.HWND, target_dir.name)
                        found_existing = True
                        break
                except Exception:
                    continue
        finally:
            pythoncom.CoUninitialize()
    except Exception:
        pass

    if found_existing:
        return {"ok": True, "path": dir_str, "message": "Navigated existing Explorer window"}

    # 4. If no target_file specified, check if target_dir has a file to select (which reliably opens target_dir)
    if not target_file or not target_file.exists():
        first_pdf = next(target_dir.glob("*.pdf"), None)
        if first_pdf and first_pdf.is_file():
            target_file = first_pdf

    if target_file and target_file.exists():
        file_str = str(target_file.resolve())
        args = f'/select,"{file_str}"'
        display_path = file_str
    else:
        args = f'/n,"{dir_str}"'
        display_path = dir_str

    try:
        launched = False
        try:
            import pythoncom
            import win32com.client
            pythoncom.CoInitialize()
            try:
                shell = win32com.client.Dispatch("Shell.Application")
                shell.ShellExecute("explorer.exe", args, "", "open", 1)
                launched = True
            finally:
                pythoncom.CoUninitialize()
        except Exception:
            pass

        if not launched:
            subprocess.Popen(f'explorer.exe {args}')

        threading.Thread(target=_activate_explorer_window, args=(dir_str,), daemon=True).start()
        return {"ok": True, "path": display_path, "message": "Opened in Windows Explorer"}
    except Exception as exc:
        logger.warning("Explorer launch failed: %s", exc)
        return {"ok": False, "error": str(exc)}


def get_or_create_preview_pdf(doc_id: str) -> Optional[Path]:
    """Retrieves or generates a high-fidelity PDF preview for any document format (PPTX, DOCX, XLSX, PNG, etc.)."""
    init_vault()
    doc = get_document(doc_id)
    if not doc:
        return None

    doc_path = get_documents_dir() / doc["filename"]
    if not doc_path.is_file():
        return None

    if doc_path.suffix.lower() == ".pdf":
        return doc_path

    preview_path = get_previews_dir() / f"{doc_id}.pdf"
    if preview_path.is_file() and preview_path.stat().st_size > 0:
        return preview_path

    try:
        ok = ocr_engine.convert_to_pdf(doc_path, preview_path)
        if ok and preview_path.is_file() and preview_path.stat().st_size > 0:
            return preview_path
    except Exception as exc:
        logger.warning("Preview PDF generation failed for %s (%s): %s", doc_id, doc["filename"], exc)

    return None


def save_uploaded_document(
    filename: str,
    file_bytes: bytes,
    tags: str = "",
    category: str = "",
    auto_ocr: bool = True,
    lang: str = "eng",
) -> Dict[str, Any]:
    """Saves a document into an organized subfolder in external vault and optionally runs OCR."""
    init_vault()
    doc_id = str(uuid.uuid4())
    safe_name = "".join(c for c in filename if c.isalnum() or c in "._- ()[]").strip() or "document.pdf"
    
    clean_cat = "".join(c for c in (category.strip() or tags.strip() or "General") if c.isalnum() or c in "._- ()[]").strip() or "General"
    subfolder = get_documents_dir() / clean_cat
    subfolder.mkdir(parents=True, exist_ok=True)

    dest_path = subfolder / safe_name
    if dest_path.exists():
        stem = dest_path.stem
        ext = dest_path.suffix
        dest_path = subfolder / f"{stem}_{doc_id[:6]}{ext}"

    stored_name = f"{clean_cat}/{dest_path.name}"
    file_size = len(file_bytes)
    file_hash = hashlib.sha256(file_bytes).hexdigest()
    now_str = datetime.now().isoformat(timespec="seconds")

    with open(dest_path, "wb") as f:
        f.write(file_bytes)

    ext = Path(filename).suffix.lower()
    mime_map = {
        ".pdf": "application/pdf",
        ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".ppt": "application/vnd.ms-powerpoint",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".doc": "application/msword",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xls": "application/vnd.ms-excel",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".bmp": "image/bmp",
        ".webp": "image/webp",
        ".txt": "text/plain",
        ".csv": "text/csv",
    }
    detected_mime = mime_map.get(ext, "application/octet-stream")

    with get_db_connection() as con:
        cur = con.cursor()
        cur.execute(
            """
            INSERT INTO documents (
                id, filename, original_name, file_size, file_hash, mime_type,
                tags, page_count, ocr_pages, ocr_status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 'pending', ?, ?)
            """,
            (
                doc_id,
                stored_name,
                filename,
                file_size,
                file_hash,
                detected_mime,
                clean_cat,
                now_str,
                now_str,
            ),
        )
        cur.execute(
            """
            INSERT INTO document_fts (doc_id, title, content, tags)
            VALUES (?, ?, ?, ?)
            """,
            (doc_id, filename, f"{filename} {clean_cat}", clean_cat),
        )
        con.commit()

    if auto_ocr:
        process_document_ocr(doc_id, lang=lang, auto_sync_weknora=True)
    else:
        try:
            copy_to_weknora_vault(doc_id, auto_ocr_if_missing=False)
        except Exception as sync_exc:
            logger.debug("Upload sync to WeKnora: %s", sync_exc)

    return get_document(doc_id)


def process_document_ocr(doc_id: str, lang: str = "eng", auto_sync_weknora: bool = True) -> Dict[str, Any]:
    """Runs dual-pipeline OCR and text extraction for any document type in the vault."""
    doc = get_document(doc_id)
    if not doc:
        raise ValueError(f"Document {doc_id} not found.")

    doc_path = get_documents_dir() / doc["filename"]
    if not doc_path.is_file():
        raise FileNotFoundError(f"Underlying file {doc_path} missing.")

    ocr_dir = get_ocr_cache_dir()
    cache_path = ocr_dir / f"{doc_id}.md"

    try:
        # Pipeline A: Generate preview PDF for non-PDFs (PPTX, DOCX, XLSX, Images)
        preview_pdf = get_or_create_preview_pdf(doc_id)

        # Pipeline B: Multi-format text extraction & OCR
        markdown_text, page_count, ocr_pages = ocr_engine.extract_and_ocr_document(
            doc_path=doc_path,
            preview_pdf_path=preview_pdf,
            lang=lang,
        )

        with open(cache_path, "w", encoding="utf-8") as f:
            f.write(markdown_text)

        # Pre-warm thumbnail
        get_or_create_thumbnail(doc_id)

        status = "completed" if (ocr_pages > 0 or page_count > 0) else "digital_only"
        now_str = datetime.now().isoformat(timespec="seconds")

        with get_db_connection() as con:
            cur = con.cursor()
            cur.execute(
                """
                UPDATE documents
                SET page_count = ?, ocr_pages = ?, ocr_status = ?, error_msg = '', updated_at = ?
                WHERE id = ?
                """,
                (page_count, ocr_pages, status, now_str, doc_id),
            )
            # Update FTS5 index
            cur.execute("DELETE FROM document_fts WHERE doc_id = ?", (doc_id,))
            cur.execute(
                """
                INSERT INTO document_fts (doc_id, title, content, tags)
                VALUES (?, ?, ?, ?)
                """,
                (doc_id, doc["original_name"], markdown_text, doc["tags"]),
            )
            con.commit()

        # Automatically synchronize clean OCR markdown to WeKnora ingestion storage
        if auto_sync_weknora:
            try:
                copy_to_weknora_vault(doc_id, auto_ocr_if_missing=False)
                logger.info("Automatically synced OCR markdown to WeKnora for doc: %s", doc_id)
            except Exception as sync_exc:
                logger.warning("Auto-sync to WeKnora failed for %s: %s", doc_id, sync_exc)

        return get_document(doc_id)

    except Exception as exc:
        logger.exception("OCR extraction failed for %s: %s", doc_id, exc)
        now_str = datetime.now().isoformat(timespec="seconds")
        with get_db_connection() as con:
            cur = con.cursor()
            cur.execute(
                """
                UPDATE documents
                SET ocr_status = 'failed', error_msg = ?, updated_at = ?
                WHERE id = ?
                """,
                (str(exc), now_str, doc_id),
            )
            con.commit()
        return get_document(doc_id)


def sanitize_fts_query(query: str) -> str:
    """Sanitizes user input into safe SQLite FTS5 prefix tokens."""
    words = re.findall(r"[\w\u0080-\uffff]+", query)
    if not words:
        return ""
    return " ".join(f'"{w}"*' for w in words)


def sanitize_snippet_html(raw_snippet: str) -> str:
    """Safely escapes HTML in FTS snippets while preserving highlighting."""
    if not raw_snippet:
        return ""
    # Replace FTS <b> match markers with temporary placeholders
    s = raw_snippet.replace("<b>", "\x01").replace("</b>", "\x02")
    # Escape any raw HTML characters (<, >, &, ", ') from the document OCR text
    s = html.escape(s)
    # Restore styled highlight
    s = s.replace("\x01", "<b class=\"pngx-match-hl\">").replace("\x02", "</b>")
    return s


def find_all_query_pages(doc_id: str, query: str) -> List[int]:
    """Finds all 1-based page numbers where the search query appears.
    Checks PyMuPDF directly first (exact match coordinates), and falls back
    to cached OCR Markdown if needed.
    """
    if not query or not query.strip():
        return []

    clean_q = query.strip()
    q_lower = clean_q.lower()
    matching_pages = set()

    # 1. Check PDF directly via PyMuPDF (fitz) on original or converted preview
    try:
        preview_pdf = get_or_create_preview_pdf(doc_id)
        if preview_pdf and preview_pdf.is_file():
            import pymupdf
            pdf_doc = pymupdf.open(str(preview_pdf))
            for page_idx in range(len(pdf_doc)):
                page = pdf_doc[page_idx]
                rects = page.search_for(clean_q)
                if rects:
                    matching_pages.add(page_idx + 1)
            pdf_doc.close()
    except Exception as exc:
        logger.debug("Failed searching PDF for query pages: %s", exc)

    # 2. Check OCR markdown cache (especially for scanned PDFs or OCR-extracted text)
    if not matching_pages:
        cache_path = get_ocr_cache_dir() / f"{doc_id}.md"
        if cache_path.is_file():
            try:
                content = cache_path.read_text(encoding="utf-8", errors="replace")
                pattern = re.compile(r"<!--\s*Page\s+(\d+)", re.IGNORECASE)
                page_markers = []
                for match in pattern.finditer(content):
                    page_markers.append((match.start(), int(match.group(1))))
                
                pos = 0
                while True:
                    idx = content.lower().find(q_lower, pos)
                    if idx == -1:
                        break
                    matched_page = 1
                    for marker_pos, p_num in page_markers:
                        if marker_pos <= idx:
                            matched_page = p_num
                        else:
                            break
                    matching_pages.add(matched_page)
                    pos = idx + len(q_lower)
            except Exception as exc:
                logger.debug("Failed reading OCR cache for query pages: %s", exc)

    return sorted(list(matching_pages))


def find_query_page(doc_id: str, query: str) -> int:
    """Finds the 1-based page number where the search query first appears."""
    pages = find_all_query_pages(doc_id, query)
    return pages[0] if pages else 1


def list_documents(query: str = "", tag: str = "", status: str = "") -> List[Dict[str, Any]]:
    """Lists vault documents with optional full-text search, tag and status filtering."""
    init_vault()
    with get_db_connection() as con:
        cur = con.cursor()

        fts_q = sanitize_fts_query(query)
        if fts_q:
            # Use SQLite FTS5 MATCH with ranking
            sql = """
                SELECT d.*, snippet(document_fts, 2, '<b>', '</b>', '...', 25) AS snippet
                FROM documents d
                JOIN document_fts f ON d.id = f.doc_id
                WHERE document_fts MATCH ?
            """
            params: List[Any] = [fts_q]
            if tag.strip():
                sql += " AND d.tags LIKE ?"
                params.append(f"%{tag.strip()}%")
            if status.strip():
                sql += " AND d.ocr_status = ?"
                params.append(status.strip())
            sql += " ORDER BY rank LIMIT 100"
            cur.execute(sql, params)
        else:
            sql = "SELECT d.*, '' AS snippet FROM documents d WHERE 1=1"
            params = []
            if tag.strip():
                sql += " AND d.tags LIKE ?"
                params.append(f"%{tag.strip()}%")
            if status.strip():
                sql += " AND d.ocr_status = ?"
                params.append(status.strip())
            sql += " ORDER BY d.created_at DESC LIMIT 200"
            cur.execute(sql, params)

        rows = cur.fetchall()
        docs = [dict(r) for r in rows]
        unique_docs: List[Dict[str, Any]] = []
        seen_ids = set()
        clean_q = query.strip()
        for doc in docs:
            d_id = doc.get("id")
            if d_id and d_id not in seen_ids:
                seen_ids.add(d_id)
                if doc.get("snippet"):
                    doc["snippet"] = sanitize_snippet_html(doc["snippet"])
                if clean_q:
                    all_matches = find_all_query_pages(doc["id"], clean_q)
                    doc["match_pages"] = all_matches
                    doc["match_page"] = all_matches[0] if all_matches else 1
                else:
                    doc["match_pages"] = []
                    doc["match_page"] = 1
                unique_docs.append(doc)
        return unique_docs


def get_document(doc_id: str) -> Optional[Dict[str, Any]]:
    """Retrieves document record and presence of cached OCR text."""
    init_vault()
    with get_db_connection() as con:
        cur = con.cursor()
        cur.execute("SELECT * FROM documents WHERE id = ?", (doc_id,))
        row = cur.fetchone()
        if not row:
            return None
        d = dict(row)
        cache_path = get_ocr_cache_dir() / f"{doc_id}.md"
        d["has_ocr_cache"] = cache_path.is_file()
        return d


def get_document_markdown(doc_id: str) -> str:
    """Reads cached OCR/markdown for the document."""
    cache_path = get_ocr_cache_dir() / f"{doc_id}.md"
    if cache_path.is_file():
        return cache_path.read_text(encoding="utf-8", errors="replace")
    return ""


def get_or_create_thumbnail(doc_id: str, dpi: int = 75) -> Optional[Path]:
    """Renders or retrieves cached first-page PNG thumbnail for any document type."""
    init_vault()
    thumb_path = get_thumbnails_dir() / f"{doc_id}.png"
    if thumb_path.is_file():
        return thumb_path

    doc = get_document(doc_id)
    if not doc:
        return None

    doc_path = get_documents_dir() / doc["filename"]
    if not doc_path.is_file():
        return None

    ext = doc_path.suffix.lower()

    # Direct image thumbnail
    if ext in (".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tiff", ".tif"):
        try:
            from PIL import Image
            with Image.open(str(doc_path)) as im:
                im.thumbnail((320, 420))
                im.convert("RGB").save(str(thumb_path), format="PNG")
                return thumb_path
        except Exception as exc:
            logger.warning("Direct image thumbnail failed for %s: %s", doc_id, exc)

    # PDF or Office documents (PPTX, DOCX, XLSX): render from preview PDF
    preview_pdf = get_or_create_preview_pdf(doc_id)
    if preview_pdf and preview_pdf.is_file():
        try:
            import pymupdf
            pdf = pymupdf.open(str(preview_pdf))
            if len(pdf) > 0:
                pix = pdf[0].get_pixmap(dpi=dpi)
                pix.save(str(thumb_path))
                pdf.close()
                return thumb_path
            pdf.close()
        except Exception as exc:
            logger.warning("Thumbnail generation failed for %s: %s", doc_id, exc)
    return None


def update_document_tags(doc_id: str, tags: str) -> Optional[Dict[str, Any]]:
    """Updates tags for a document and syncs FTS."""
    init_vault()
    now_str = datetime.now().isoformat(timespec="seconds")
    with get_db_connection() as con:
        cur = con.cursor()
        cur.execute(
            "UPDATE documents SET tags = ?, updated_at = ? WHERE id = ?",
            (tags.strip(), now_str, doc_id),
        )
        # Update FTS5 tags column
        cur.execute("UPDATE document_fts SET tags = ? WHERE doc_id = ?", (tags.strip(), doc_id))
        con.commit()
    return get_document(doc_id)


def delete_document(doc_id: str) -> bool:
    """Deletes a document from the vault, including original, preview, thumbnail, and OCR cache."""
    doc = get_document(doc_id)
    if not doc:
        return False

    doc_path = get_documents_dir() / doc["filename"]
    if doc_path.is_file():
        try:
            doc_path.unlink()
        except Exception:
            pass

    preview_path = get_previews_dir() / f"{doc_id}.pdf"
    if preview_path.is_file():
        try:
            preview_path.unlink()
        except Exception:
            pass

    thumb_path = get_thumbnails_dir() / f"{doc_id}.png"
    if thumb_path.is_file():
        try:
            thumb_path.unlink()
        except Exception:
            pass

    cache_path = get_ocr_cache_dir() / f"{doc_id}.md"
    if cache_path.is_file():
        try:
            cache_path.unlink()
        except Exception:
            pass

    with get_db_connection() as con:
        cur = con.cursor()
        cur.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
        cur.execute("DELETE FROM document_fts WHERE doc_id = ?", (doc_id,))
        con.commit()

    orig_name = doc.get("original_name") if doc else ""
    if orig_name:
        try:
            delete_document_from_weknora(orig_name)
        except Exception as del_err:
            logger.debug("Error purging document '%s' from WeKnora: %s", orig_name, del_err)

    return True


_weknora_jwt_cache = {"token": None, "expiry": 0.0}


def get_weknora_api_token(force_refresh: bool = False) -> Optional[str]:
    """Obtains or reuses an authenticated JWT token from WeKnora Lite service."""
    now = time.time()
    if not force_refresh and _weknora_jwt_cache["token"] and now < _weknora_jwt_cache["expiry"]:
        return _weknora_jwt_cache["token"]

    try:
        from modules.weknora.manager import get_setup_token, read_env
        token = get_setup_token()
        cfg = read_env()
        port = int(cfg.get("SERVER_PORT", cfg.get("PORT", "8082")))
        host = "127.0.0.1"

        client = httpx.Client(timeout=10.0)
        resp = client.post(
            f"http://{host}:{port}/api/v1/auth/auto-setup",
            json={},
            headers={"X-WeKnora-Desktop-Token": token},
        )
        if resp.status_code == 200:
            data = resp.json()
            jwt = data.get("token")
            if jwt:
                _weknora_jwt_cache["token"] = jwt
                _weknora_jwt_cache["expiry"] = now + 600.0  # Cache for 10 minutes
                return jwt
    except Exception as exc:
        logger.debug("Failed acquiring WeKnora JWT token: %s", exc)
    return None


def get_or_create_weknora_kb(category_name: str, jwt: str, port: int = 8082) -> Optional[str]:
    """Finds or creates a Knowledge Base in WeKnora matching category_name."""
    weknora_db = get_vault_path() / "weknora_data" / "weknora.db"
    if weknora_db.is_file():
        try:
            with sqlite3.connect(str(weknora_db)) as con:
                cur = con.cursor()
                cur.execute("SELECT id FROM knowledge_bases WHERE name = ? AND deleted_at IS NULL", (category_name,))
                row = cur.fetchone()
                if not row:
                    cur.execute(
                        "SELECT id FROM knowledge_bases WHERE LOWER(name) = ? AND deleted_at IS NULL",
                        (category_name.lower(),),
                    )
                    row = cur.fetchone()
                if row:
                    return row[0]
        except Exception:
            pass

    # Query via API
    headers = {"Authorization": f"Bearer {jwt}"}
    client = httpx.Client(timeout=15.0)
    try:
        res = client.get(f"http://127.0.0.1:{port}/api/v1/knowledge-bases", headers=headers)
        if res.status_code == 200:
            for kb in res.json().get("data", []):
                if kb.get("name", "").strip().lower() == category_name.strip().lower():
                    return kb.get("id")
    except Exception as e:
        logger.debug("Error listing WeKnora KBs: %s", e)

    # Not found, automatically create the Knowledge Base for this category
    try:
        create_res = client.post(
            f"http://127.0.0.1:{port}/api/v1/knowledge-bases",
            headers=headers,
            json={"name": category_name, "type": "document"},
        )
        if create_res.status_code in (200, 201):
            return create_res.json().get("data", {}).get("id")
    except Exception as ce:
        logger.warning("Error creating WeKnora KB for category '%s': %s", category_name, ce)
    return None


def upload_document_to_weknora_kb(doc_id: str) -> Dict[str, Any]:
    """Ensures a document registered in Paperless-ngx is formally registered and indexed
    in its corresponding WeKnora Knowledge Base.
    """
    doc = get_document(doc_id)
    if not doc:
        return {"ok": False, "error": "Document not found"}

    doc_path = get_documents_dir() / doc["filename"]
    if not doc_path.is_file():
        return {"ok": False, "error": "Document file missing on disk"}

    category = (doc.get("tags") or "").strip()
    if not category:
        parent_name = Path(doc["filename"]).parent.name
        if parent_name and parent_name not in (".", "/"):
            category = parent_name
        else:
            category = "General Acoustic Knowledge"

    orig_name = Path(doc["original_name"]).name

    # Ultra-fast check in weknora.db: if already registered and active in this KB, skip
    weknora_db = get_vault_path() / "weknora_data" / "weknora.db"
    if weknora_db.is_file():
        try:
            with sqlite3.connect(str(weknora_db)) as con:
                cur = con.cursor()
                cur.execute(
                    """
                    SELECT k.id FROM knowledges k
                    JOIN knowledge_bases kb ON k.knowledge_base_id = kb.id
                    WHERE (kb.name = ? OR LOWER(kb.name) = ?) AND k.file_name = ? AND k.deleted_at IS NULL
                    """,
                    (category, category.lower(), orig_name),
                )
                existing = cur.fetchone()
                if existing:
                    return {"ok": True, "already_indexed": True, "knowledge_id": existing[0]}
        except Exception as db_err:
            logger.debug("weknora.db check error: %s", db_err)

    jwt = get_weknora_api_token()
    if not jwt:
        return {"ok": False, "error": "WeKnora service not available or not authenticated"}

    from modules.weknora.manager import read_env
    cfg = read_env()
    port = int(cfg.get("SERVER_PORT", cfg.get("PORT", "8082")))

    kb_id = get_or_create_weknora_kb(category, jwt, port)
    if not kb_id:
        return {"ok": False, "error": f"Failed resolving Knowledge Base for '{category}'"}

    try:
        client = httpx.Client(timeout=120.0)
        with open(doc_path, "rb") as f:
            file_bytes = f.read()

        mime = doc.get("mime_type") or "application/octet-stream"
        files = {"file": (orig_name, file_bytes, mime)}
        data = {"fileName": orig_name}

        upload_res = client.post(
            f"http://127.0.0.1:{port}/api/v1/knowledge-bases/{kb_id}/knowledge/file",
            headers={"Authorization": f"Bearer {jwt}"},
            files=files,
            data=data,
        )
        if upload_res.status_code in (200, 201):
            logger.info("Successfully uploaded '%s' to WeKnora KB '%s'", orig_name, category)
            return {"ok": True, "weknora_registered": True, "kb_id": kb_id}
        elif upload_res.status_code == 409:
            return {"ok": True, "already_indexed": True, "kb_id": kb_id}
        else:
            logger.warning("WeKnora file upload failed (HTTP %d): %s", upload_res.status_code, upload_res.text)
            return {"ok": False, "status_code": upload_res.status_code, "error": upload_res.text}
    except Exception as up_err:
        logger.warning("Failed uploading '%s' to WeKnora: %s", orig_name, up_err)
        return {"ok": False, "error": str(up_err)}


def delete_document_from_weknora(orig_name: str) -> None:
    """Removes a document from WeKnora Knowledge Base when deleted from Paperless-ngx."""
    file_name = Path(orig_name).name
    weknora_db = get_vault_path() / "weknora_data" / "weknora.db"
    doc_ids_to_del: List[str] = []
    if weknora_db.is_file():
        try:
            with sqlite3.connect(str(weknora_db)) as con:
                cur = con.cursor()
                cur.execute("SELECT id FROM knowledges WHERE file_name = ? AND deleted_at IS NULL", (file_name,))
                doc_ids_to_del = [r[0] for r in cur.fetchall()]
        except Exception:
            pass

    if doc_ids_to_del:
        jwt = get_weknora_api_token()
        if jwt:
            try:
                from modules.weknora.manager import read_env
                cfg = read_env()
                port = int(cfg.get("SERVER_PORT", cfg.get("PORT", "8082")))
                client = httpx.Client(timeout=15.0)
                for wid in doc_ids_to_del:
                    client.delete(
                        f"http://127.0.0.1:{port}/api/v1/knowledge/{wid}",
                        headers={"Authorization": f"Bearer {jwt}"},
                    )
            except Exception as del_err:
                logger.debug("WeKnora API delete error: %s", del_err)
        # Soft delete in weknora.db as immediate fallback
        try:
            with sqlite3.connect(str(weknora_db)) as con:
                cur = con.cursor()
                cur.execute(
                    "UPDATE knowledges SET deleted_at = CURRENT_TIMESTAMP WHERE file_name = ? AND deleted_at IS NULL",
                    (file_name,),
                )
                con.commit()
        except Exception:
            pass


def copy_to_weknora_vault(doc_id: str, auto_ocr_if_missing: bool = True) -> Dict[str, Any]:
    """Copies the clean OCR Markdown AND original document to WeKnora's document ingestion folder,
    and automatically registers the document in WeKnora's Knowledge Base for instant RAG QA.
    """
    doc = get_document(doc_id)
    if not doc:
        raise ValueError(f"Document {doc_id} not found.")

    doc_path = get_documents_dir() / doc["filename"]

    md_text = get_document_markdown(doc_id)
    if not md_text and auto_ocr_if_missing:
        # If OCR not run yet, run it now without recursing sync
        doc = process_document_ocr(doc_id, auto_sync_weknora=False)
        md_text = get_document_markdown(doc_id)

    if not md_text and doc_path.is_file() and doc_path.suffix.lower() in (".txt", ".md", ".csv", ".json", ".xml", ".html"):
        try:
            md_text = doc_path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            pass

    # Determine WeKnora files target directory
    target_dirs: List[Path] = []
    try:
        from modules.weknora.manager import get_data_dir
        primary_dir = get_data_dir() / "files"
        primary_dir.mkdir(parents=True, exist_ok=True)
        target_dirs.append(primary_dir)
    except Exception:
        pass

    fallback_dir = Path(__file__).resolve().parent.parent / "weknora" / "data" / "files"
    fallback_dir.mkdir(parents=True, exist_ok=True)
    if fallback_dir not in target_dirs:
        target_dirs.append(fallback_dir)

    base_stem = Path(doc["original_name"]).stem
    target_filename = f"{base_stem}_ocr.md"
    written_paths: List[str] = []

    # 1. Export clean OCR markdown
    if md_text:
        for d in target_dirs:
            dest_file = d / target_filename
            dest_file.write_text(md_text, encoding="utf-8")
            written_paths.append(str(dest_file))

    # 2. Copy original document file
    if doc_path.is_file():
        for d in target_dirs:
            dest_orig = d / Path(doc["original_name"]).name
            try:
                if not dest_orig.exists() or dest_orig.stat().st_size != doc_path.stat().st_size:
                    shutil.copy2(str(doc_path), str(dest_orig))
                    written_paths.append(str(dest_orig))
            except Exception as copy_err:
                logger.debug("Failed copying original file to WeKnora folder: %s", copy_err)

    # 3. Formally register document in WeKnora Knowledge Base
    kb_upload_res = {}
    try:
        kb_upload_res = upload_document_to_weknora_kb(doc_id)
    except Exception as kb_err:
        logger.debug("WeKnora KB upload error: %s", kb_err)

    return {
        "ok": True,
        "message": f"Synchronized '{doc['original_name']}' to WeKnora knowledge base.",
        "exported_file": written_paths[0] if written_paths else target_filename,
        "weknora_kb_sync": kb_upload_res,
    }


_scan_lock = threading.Lock()
_watcher_thread: Optional[threading.Thread] = None
_watcher_stop_event = threading.Event()


def scan_and_sync_vault(auto_ocr: bool = True, lang: str = "eng") -> Dict[str, Any]:
    """Scans the external vault documents folder (~/Documents/OneEAD_Archive/documents)
    for any untracked or newly added files, registers them in meta.db, runs OCR,
    and automatically synchronizes them to WeKnora knowledge base.
    """
    if not _scan_lock.acquire(blocking=False):
        return {
            "ok": True,
            "busy": True,
            "scanned": 0,
            "new_imported": 0,
            "message": "Vault scan is already running in background.",
            "imported_docs": [],
        }

    try:
        init_vault()
        docs_dir = get_documents_dir()
        if not docs_dir.exists():
            docs_dir.mkdir(parents=True, exist_ok=True)
            return {
                "ok": True,
                "scanned": 0,
                "new_imported": 0,
                "skipped_existing": 0,
                "message": "Documents directory initialized; vault is empty.",
                "imported_docs": [],
            }

        valid_extensions = {
            ".pdf", ".pptx", ".ppt", ".docx", ".doc", ".xlsx", ".xls",
            ".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tiff", ".tif",
            ".txt", ".csv", ".md", ".rtf", ".docm", ".xlsm", ".pptm",
            ".htm", ".html",
        }

        mime_map = {
            ".pdf": "application/pdf",
            ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            ".ppt": "application/vnd.ms-powerpoint",
            ".pptm": "application/vnd.ms-powerpoint.presentation.macroEnabled.12",
            ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".doc": "application/msword",
            ".docm": "application/vnd.ms-word.document.macroEnabled.12",
            ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ".xls": "application/vnd.ms-excel",
            ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".bmp": "image/bmp",
            ".webp": "image/webp",
            ".tiff": "image/tiff",
            ".tif": "image/tiff",
            ".txt": "text/plain",
            ".csv": "text/csv",
            ".md": "text/markdown",
            ".rtf": "application/rtf",
            ".htm": "text/html",
            ".html": "text/html",
        }

        # Query existing documents
        with get_db_connection() as con:
            cur = con.cursor()
            cur.execute("SELECT id, filename, file_hash, file_size FROM documents")
            existing_rows = cur.fetchall()

        registered_paths = set()
        registered_hashes = {}
        for r in existing_rows:
            fn = r["filename"]
            if fn:
                registered_paths.add(Path(fn).as_posix().lower())
                registered_paths.add(fn.lower())
            if r["file_hash"]:
                registered_hashes[r["file_hash"]] = r["id"]

        scanned_count = 0
        new_imported = []
        errors = []
        docs_to_ocr = []

        # Recursively traverse documents directory
        for item in docs_dir.rglob("*"):
            if not item.is_file():
                continue

            if item.name.startswith((".", "~$")):
                continue

            ext = item.suffix.lower()
            if ext not in valid_extensions:
                continue

            scanned_count += 1
            rel_path = item.relative_to(docs_dir)
            rel_posix = rel_path.as_posix()
            rel_posix_lower = rel_posix.lower()

            if rel_posix_lower in registered_paths:
                continue

            try:
                st = item.stat()
                file_size = st.st_size
                if file_size == 0:
                    continue
                with open(item, "rb") as f:
                    file_bytes = f.read()
            except (PermissionError, OSError) as read_err:
                logger.warning("Could not read file %s (file in use or locked): %s", item, read_err)
                errors.append(f"{item.name}: {read_err}")
                continue

            file_hash = hashlib.sha256(file_bytes).hexdigest()

            # Check if file was moved or renamed
            if file_hash in registered_hashes:
                old_doc_id = registered_hashes[file_hash]
                old_doc = get_document(old_doc_id)
                if old_doc:
                    old_file_path = docs_dir / old_doc["filename"]
                    if not old_file_path.exists():
                        now_str = datetime.now().isoformat(timespec="seconds")
                        with get_db_connection() as con:
                            cur = con.cursor()
                            cur.execute(
                                "UPDATE documents SET filename = ?, updated_at = ? WHERE id = ?",
                                (rel_posix, now_str, old_doc_id),
                            )
                            con.commit()
                        registered_paths.add(rel_posix_lower)
                        continue

            # Determine category from folder structure
            parent_rel = rel_path.parent
            if parent_rel != Path("."):
                category = parent_rel.as_posix().replace("/", " - ")
            else:
                category = "General"

            clean_cat = "".join(c for c in category if c.isalnum() or c in "._- ()[]").strip() or "General"
            doc_id = str(uuid.uuid4())
            now_str = datetime.now().isoformat(timespec="seconds")
            detected_mime = mime_map.get(ext, "application/octet-stream")

            try:
                with get_db_connection() as con:
                    cur = con.cursor()
                    cur.execute(
                        """
                        INSERT INTO documents (
                            id, filename, original_name, file_size, file_hash, mime_type,
                            tags, page_count, ocr_pages, ocr_status, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 'pending', ?, ?)
                        """,
                        (
                            doc_id,
                            rel_posix,
                            item.name,
                            file_size,
                            file_hash,
                            detected_mime,
                            clean_cat,
                            now_str,
                            now_str,
                        ),
                    )
                    cur.execute(
                        """
                        INSERT INTO document_fts (doc_id, title, content, tags)
                        VALUES (?, ?, ?, ?)
                        """,
                        (doc_id, item.name, f"{item.name} {clean_cat}", clean_cat),
                    )
                    con.commit()

                registered_paths.add(rel_posix_lower)
                registered_hashes[file_hash] = doc_id

                new_imported.append({
                    "id": doc_id,
                    "name": item.name,
                    "category": clean_cat,
                    "size": file_size,
                })
                docs_to_ocr.append(doc_id)
                logger.info("Auto-scanned & registered vault document: %s (%s)", item.name, doc_id)

            except Exception as imp_err:
                logger.exception("Failed importing scanned vault file %s: %s", item, imp_err)
                errors.append(f"{item.name}: {imp_err}")

        # Process newly discovered documents: run OCR and guarantee WeKnora synchronization
        for d_id in docs_to_ocr:
            if auto_ocr:
                try:
                    process_document_ocr(d_id, lang=lang, auto_sync_weknora=True)
                except Exception as ocr_err:
                    logger.warning("OCR processing error for doc %s during scan: %s", d_id, ocr_err)
            try:
                copy_to_weknora_vault(d_id, auto_ocr_if_missing=False)
            except Exception as w_err:
                logger.debug("WeKnora sync fallback error for doc %s: %s", d_id, w_err)

        # Automatically ensure ALL documents in the vault have their clean text, files, and Knowledge Base records in WeKnora
        try:
            from modules.weknora.manager import get_data_dir
            weknora_files_dir = get_data_dir() / "files"
            with get_db_connection() as con:
                cur = con.cursor()
                cur.execute("SELECT id, original_name FROM documents")
                all_vault_docs = cur.fetchall()
            for d_row in all_vault_docs:
                stem = Path(d_row["original_name"]).stem
                dest_md = weknora_files_dir / f"{stem}_ocr.md" if weknora_files_dir.is_dir() else None
                if dest_md and not dest_md.exists():
                    copy_to_weknora_vault(d_row["id"], auto_ocr_if_missing=True)
                else:
                    upload_document_to_weknora_kb(d_row["id"])
        except Exception as sync_all_err:
            logger.debug("Automatic WeKnora reconciliation error: %s", sync_all_err)

        # Reconcile deleted documents:
        # If user manually deleted a file from disk in ~/Documents/OneEAD_Archive/documents,
        # automatically purge its record from meta.db, document_fts, thumbnails, OCR cache, and WeKnora.
        cleaned_up_count = 0
        try:
            with get_db_connection() as con:
                cur = con.cursor()
                cur.execute("SELECT id, filename, original_name FROM documents")
                registered_docs = cur.fetchall()

            for d_row in registered_docs:
                d_id = d_row["id"]
                fn = d_row["filename"]
                orig_name = d_row["original_name"]
                expected_disk_file = docs_dir / fn
                if not expected_disk_file.is_file():
                    logger.info("Detected manual file deletion: %s (%s). Purging database record and caches.", orig_name, d_id)
                    delete_document(d_id)
                    cleaned_up_count += 1
                    try:
                        from modules.weknora.manager import get_data_dir
                        weknora_files_dir = get_data_dir() / "files"
                        if weknora_files_dir.is_dir():
                            stem = Path(orig_name).stem
                            md_f = weknora_files_dir / f"{stem}_ocr.md"
                            if md_f.is_file():
                                md_f.unlink()
                            orig_f = weknora_files_dir / Path(orig_name).name
                            if orig_f.is_file():
                                orig_f.unlink()
                    except Exception as wek_del_err:
                        logger.debug("WeKnora cleanup error for %s: %s", orig_name, wek_del_err)
        except Exception as del_reconcile_err:
            logger.debug("Deletion reconciliation error: %s", del_reconcile_err)

        return {
            "ok": True,
            "scanned": scanned_count,
            "new_imported": len(new_imported),
            "skipped_existing": scanned_count - len(new_imported),
            "imported_docs": new_imported,
            "errors": errors,
            "message": f"Vault scan complete. Discovered and imported {len(new_imported)} new document(s) (OCR & WeKnora synced)."
            if new_imported else "Vault is up to date. No new documents found.",
        }
    finally:
        _scan_lock.release()


def _vault_watcher_loop(interval_sec: int = 20) -> None:
    logger.info("Vault watcher background loop started (interval=%ds)", interval_sec)
    # Give the app a couple seconds to boot up before initial scan
    if not _watcher_stop_event.wait(3.0):
        try:
            scan_and_sync_vault(auto_ocr=True)
        except Exception as exc:
            logger.debug("Initial vault scan error: %s", exc)

    while not _watcher_stop_event.is_set():
        if _watcher_stop_event.wait(interval_sec):
            break
        try:
            scan_and_sync_vault(auto_ocr=True)
        except Exception as exc:
            logger.debug("Periodic vault scan error: %s", exc)


def start_vault_watcher(interval_sec: int = 20) -> None:
    """Starts the continuous background watcher thread for ~/Documents/OneEAD_Archive/documents."""
    global _watcher_thread, _watcher_stop_event
    if _watcher_thread is not None and _watcher_thread.is_alive():
        return
    _watcher_stop_event.clear()
    _watcher_thread = threading.Thread(
        target=_vault_watcher_loop,
        args=(interval_sec,),
        daemon=True,
        name="OneEAD-VaultWatcher",
    )
    _watcher_thread.start()


def stop_vault_watcher() -> None:
    """Stops the background vault watcher thread."""
    global _watcher_stop_event
    _watcher_stop_event.set()


atexit.register(stop_vault_watcher)

