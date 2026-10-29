"""Vault manager and document archive engine for One EAD Paperless-ngx.

Stores documents strictly in an external vault outside the git repository
(default: ~/Documents/OneEAD_Archive) ensuring 100% data privacy from AI tooling
and version control. Provides full-text FTS5 search and 1-click Explorer integration.
"""

from __future__ import annotations

from datetime import datetime
import hashlib
import html
import json
import logging
import os
from pathlib import Path
import re
import sqlite3
import subprocess
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
        process_document_ocr(doc_id, lang=lang)

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
        seen_names = set()
        clean_q = query.strip()
        for doc in docs:
            name = doc.get("original_name") or doc.get("id")
            if name not in seen_names:
                seen_names.add(name)
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

    return True


def copy_to_weknora_vault(doc_id: str, auto_ocr_if_missing: bool = True) -> Dict[str, Any]:
    """Copies the clean OCR Markdown to WeKnora's document ingestion folder.
    
    This allows WeKnora Lite to immediately index the OCR-enhanced technical text
    without needing manual re-upload.
    """
    doc = get_document(doc_id)
    if not doc:
        raise ValueError(f"Document {doc_id} not found.")

    md_text = get_document_markdown(doc_id)
    if not md_text and auto_ocr_if_missing:
        # If OCR not run yet, run it now without recursing sync
        doc = process_document_ocr(doc_id, auto_sync_weknora=False)
        md_text = get_document_markdown(doc_id)

    if not md_text:
        return {
            "ok": False,
            "message": "No OCR text available to sync.",
        }

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

    for d in target_dirs:
        dest_file = d / target_filename
        dest_file.write_text(md_text, encoding="utf-8")
        written_paths.append(str(dest_file))

    return {
        "ok": True,
        "message": f"Exported '{target_filename}' to WeKnora ingestion storage.",
        "exported_file": written_paths[0] if written_paths else target_filename,
    }
