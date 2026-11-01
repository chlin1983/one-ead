"""Vault manager and document archive engine for One EAD Paperless-ngx.

Stores documents strictly in an external vault outside the git repository
(default: ~/Documents/OneEAD_Archive) ensuring 100% data privacy from AI tooling
and version control. Provides full-text FTS5 search and 1-click Explorer integration.
"""

from __future__ import annotations
from server.security import secure_path_permissions

import atexit
from datetime import datetime
import hashlib
import hmac
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
from typing import Any, Dict, List, Optional, Tuple
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
    """Ensures vault folders and SQLite FTS5 tables exist and have secure NTFS permissions."""
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

    if not secure_path_permissions(vault, is_dir=True):
        raise PermissionError(f"Failed to secure NTFS permissions on Paperless vault directory: {vault}")
    if not secure_path_permissions(docs_dir, is_dir=True):
        raise PermissionError(f"Failed to secure NTFS permissions on Paperless documents directory: {docs_dir}")
    if not secure_path_permissions(ocr_dir, is_dir=True):
        raise PermissionError(f"Failed to secure NTFS permissions on Paperless OCR cache directory: {ocr_dir}")
    if not secure_path_permissions(thumbs_dir, is_dir=True):
        raise PermissionError(f"Failed to secure NTFS permissions on Paperless thumbnails directory: {thumbs_dir}")
    if not secure_path_permissions(previews_dir, is_dir=True):
        raise PermissionError(f"Failed to secure NTFS permissions on Paperless previews directory: {previews_dir}")

    db_path = get_db_path()
    with sqlite3.connect(str(db_path)) as con:
        cur = con.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                original_name TEXT NOT NULL,
                file_size INTEGER DEFAULT 0,
                file_hash TEXT,
                mime_type TEXT,
                tags TEXT DEFAULT '',
                page_count INTEGER DEFAULT 0,
                ocr_pages INTEGER DEFAULT 0,
                ocr_status TEXT DEFAULT 'pending',
                created_at TEXT,
                updated_at TEXT,
                error_msg TEXT DEFAULT ''
            )
            """
        )
        cur.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(
                doc_id UNINDEXED,
                title,
                content,
                tags,
                tokenize='unicode61 remove_diacritics 2'
            )
            """
        )
        cur.execute("PRAGMA table_info(documents)")
        cols = {row[1] for row in cur.fetchall()}
        if "error_msg" not in cols:
            cur.execute("ALTER TABLE documents ADD COLUMN error_msg TEXT DEFAULT ''")
        con.commit()

    if not secure_path_permissions(db_path, is_dir=False):
        raise PermissionError(f"Failed to secure NTFS permissions on Paperless database: {db_path}")

    with sqlite3.connect(str(db_path)) as con:
        cur = con.cursor()
        try:
            cur.execute("SELECT count(*) FROM document_fts WHERE length(content) < 150")
            short_count = cur.fetchone()[0] or 0
            if short_count > 0:
                from modules.weknora.manager import get_data_dir
                weknora_db = get_data_dir() / "weknora.db"
                if weknora_db.is_file():
                    with sqlite3.connect(str(weknora_db)) as wek_con:
                        wek_cur = wek_con.cursor()
                        cur.execute("SELECT id, original_name, tags FROM documents")
                        docs_to_sync = cur.fetchall()
                        for doc_id, orig_name, tags in docs_to_sync:
                            wek_cur.execute(
                                """
                                SELECT content FROM chunks
                                WHERE document_id IN (
                                    SELECT id FROM documents WHERE name = ? OR name = ?
                                ) ORDER BY chunk_index ASC
                                """,
                                (orig_name, f"{Path(orig_name).stem}_ocr.md")
                            )
                            chunks = wek_cur.fetchall()
                            if chunks:
                                full_text = "\n\n".join(c[0] for c in chunks if c[0])
                                cur.execute("DELETE FROM document_fts WHERE doc_id = ?", (doc_id,))
                                cur.execute(
                                    """
                                    INSERT INTO document_fts (doc_id, title, content, tags)
                                    VALUES (?, ?, ?, ?)
                                    """,
                                    (doc_id, orig_name, full_text, tags)
                                )
                                cur.execute(
                                    "UPDATE documents SET page_count = ?, ocr_pages = ?, ocr_status = 'completed' WHERE id = ?",
                                    (max(1, len(chunks) // 10), len(chunks), doc_id),
                                )
                    con.commit()
        except Exception as fts_err:
            logger.debug("Non-fatal error populating Paperless full-text index: %s", fts_err)


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
    """Opens documents vault directory in native Windows File Explorer and forces it on top."""
    import threading
    init_vault()
    docs_dir = get_documents_dir().resolve()
    clean_sub = subfolder.strip().strip("/\\")

    # Reject path traversal tokens
    if ".." in Path(clean_sub).parts or Path(clean_sub).is_absolute():
        return {"ok": False, "error": "Path traversal rejected: invalid subfolder path."}

    target_file = None
    target_dir = None

    # 1. If doc_id given, lookup document in db
    if doc_id:
        doc = get_document(doc_id)
        if doc and doc.get("filename"):
            candidate = (get_documents_dir() / doc["filename"]).resolve()
            if docs_dir not in candidate.parents:
                return {"ok": False, "error": "Path traversal rejected: document outside vault."}
            if candidate.exists() and candidate.is_file():
                target_file = candidate
                target_dir = candidate.parent

    # 2. If no target_file yet, check if clean_sub is a file or subfolder
    if not target_file:
        if clean_sub and (get_documents_dir() / clean_sub).is_file():
            target_file = (get_documents_dir() / clean_sub).resolve()
            if docs_dir not in target_file.parents:
                return {"ok": False, "error": "Path traversal rejected: target file outside vault."}
            target_dir = target_file.parent
        elif not clean_sub or clean_sub.lower() in ("documents", "root", "archive", "oneead_archive"):
            target_dir = docs_dir
        else:
            resolved_sub = (get_documents_dir() / clean_sub).resolve()
            if docs_dir not in resolved_sub.parents and resolved_sub != docs_dir:
                return {"ok": False, "error": "Path traversal rejected: target folder outside vault."}
            target_dir = resolved_sub

    if docs_dir not in target_dir.parents and target_dir != docs_dir:
        return {"ok": False, "error": "Path traversal rejected: target directory outside vault."}

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
            subprocess.Popen(["explorer.exe", args])

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
    auto_sync_weknora: bool = False,
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
        process_document_ocr(doc_id, lang=lang, auto_sync_weknora=auto_sync_weknora)
    elif auto_sync_weknora:
        try:
            copy_to_weknora_vault(doc_id, auto_ocr_if_missing=False, approved=True)
        except Exception as sync_exc:
            logger.debug("Upload sync to WeKnora: %s", sync_exc)

    return get_document(doc_id)


def process_document_ocr(doc_id: str, lang: str = "eng", auto_sync_weknora: bool = False) -> Dict[str, Any]:
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

        # Synchronize clean OCR markdown to WeKnora ingestion storage ONLY when explicitly approved
        if auto_sync_weknora:
            try:
                copy_to_weknora_vault(doc_id, auto_ocr_if_missing=False, approved=True)
                logger.info("Explicitly approved sync of OCR markdown to WeKnora for doc: %s", doc_id)
            except Exception as sync_exc:
                logger.warning("WeKnora sync failed for %s: %s", doc_id, sync_exc)

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


def copy_to_weknora_vault(doc_id: str, auto_ocr_if_missing: bool = True, approved: bool = False) -> Dict[str, Any]:
    """Copies the clean OCR Markdown AND original document to WeKnora's document ingestion folder,
    and automatically registers the document in WeKnora's Knowledge Base for instant RAG QA.

    Requires explicit user approval (approved=True) to prevent automatic leakage.
    """
    if not approved:
        raise PermissionError(
            f"Document {doc_id} cannot be synchronized to WeKnora without explicit user approval."
        )
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


def _get_reconciliation_secret() -> bytes:
    """Retrieves the protected server portal secret for HMAC token generation.
    Fails closed if the secret is missing, empty, or cannot be retrieved.
    Never falls back to a public or hardcoded secret.
    """
    from server.security import get_portal_token
    token = get_portal_token()
    if not token or not isinstance(token, str) or not token.strip():
        raise RuntimeError("Protected server secret unavailable: get_portal_token() returned empty or invalid token.")
    return token.encode("utf-8")


def _compute_candidates_token(candidate_ids: List[str], expiry_seconds: int = 300) -> str:
    """Computes an HMAC-SHA256 bound confirmation token with expiry for candidate document IDs
    using the protected server secret.
    """
    sorted_ids = sorted(candidate_ids)
    cand_digest = hashlib.sha256(",".join(sorted_ids).encode("utf-8")).hexdigest()[:16]
    exp = int(time.time()) + expiry_seconds
    msg = f"{cand_digest}:{exp}:{len(sorted_ids)}".encode("utf-8")
    sig = hmac.new(_get_reconciliation_secret(), msg, hashlib.sha256).hexdigest()[:32]
    return f"{exp}_{cand_digest}_{sig}"


def _verify_candidates_token(token: Optional[str], candidate_ids: List[str]) -> Tuple[bool, str]:
    """Validates confirmation token format, expiry, and HMAC signature with protected server secret."""
    if not token or not isinstance(token, str) or not token.strip():
        return False, "Confirmation token is missing or empty."

    parts = token.strip().split("_")
    if len(parts) != 3:
        return False, "Invalid confirmation token format."

    try:
        exp_time = int(parts[0])
    except ValueError:
        return False, "Invalid confirmation token: invalid timestamp."

    if time.time() > exp_time:
        return False, "Confirmation token has expired. Please re-run dry-run preview before confirming deletion."

    try:
        secret = _get_reconciliation_secret()
    except Exception as exc:
        return False, f"Reconciliation security secret unavailable: {exc}"

    sorted_ids = sorted(candidate_ids)
    expected_digest = hashlib.sha256(",".join(sorted_ids).encode("utf-8")).hexdigest()[:16]
    msg = f"{expected_digest}:{exp_time}:{len(sorted_ids)}".encode("utf-8")
    expected_sig = hmac.new(secret, msg, hashlib.sha256).hexdigest()[:32]

    if not hmac.compare_digest(parts[1], expected_digest) or not hmac.compare_digest(parts[2], expected_sig):
        return False, "Candidate set changed or invalid token signature. Please re-run dry-run preview before confirming deletion."

    return True, "Valid"


_scan_lock = threading.Lock()
_watcher_thread: Optional[threading.Thread] = None
_watcher_stop_event = threading.Event()


def reconcile_missing_documents(
    approved: bool = False,
    dry_run: bool = False,
    expected_candidate_ids: Optional[List[str]] = None,
    confirmation_token: Optional[str] = None,
) -> Dict[str, Any]:
    """Reconciles deleted documents by removing records for files deleted from disk.

    Safety constraints:
    1. Prevents concurrent reconciliation and active scan operations using _scan_lock.
    2. Supports non-destructive dry-run preview (dry_run=True) returning candidate list & bound confirmation token.
    3. Requires explicit approval (approved=True) and a valid, non-stale confirmation token bound to candidates.
    4. Aborts if candidate set changes between preview and execution.
    5. Strictly verifies that the external documents directory exists and is accessible.
       If the directory is unmounted, missing, or partially unreadable, aborts immediately
       without deleting any records to protect against data loss.
    6. Validates full scan completeness, rejects symlinks, and blocks path traversal.
    7. Preserves recoverability by backing up metadata and OCR text to recovery/ before purging.
    8. Secures recovery directory, JSON files, and audit log with fail-closed NTFS permissions.
    9. Revalidates each candidate immediately before deletion to ensure files haven't reappeared.
    10. Writes structured audit trail to cleanup_audit.log and tracks partial failures independently.
    """
    if not _scan_lock.acquire(blocking=False):
        return {
            "ok": False,
            "busy": True,
            "cleaned_up": 0,
            "message": "Vault operation is already running in background.",
        }

    try:
        # Verify that HMAC secret is available upfront; fail closed if unavailable
        try:
            _get_reconciliation_secret()
        except Exception as sec_err:
            logger.error("Reconciliation aborted: failed to retrieve secure portal secret: %s", sec_err)
            return {
                "ok": False,
                "cleaned_up": 0,
                "message": f"Reconciliation aborted: security token service unavailable ({sec_err}).",
            }

        docs_dir = get_documents_dir()
        if not docs_dir.exists() or not docs_dir.is_dir():
            logger.warning("Vault documents directory %s does not exist or is unmounted. Aborting cleanup to prevent data loss.", docs_dir)
            return {
                "ok": False,
                "cleaned_up": 0,
                "message": f"Archive documents directory does not exist or is unmounted at {docs_dir}. Reconciliation aborted to protect records.",
            }

        # Verify accessibility and full scan completeness with strict symlink / traversal checks
        accessible_rel_paths = set()
        traversal_errors = []

        def _on_walk_error(err):
            traversal_errors.append(str(err))

        resolved_docs = docs_dir.resolve()
        try:
            for root, dirs, files in os.walk(str(docs_dir), onerror=_on_walk_error):
                root_path = Path(root)
                if root_path.is_symlink():
                    traversal_errors.append(f"Symlink directory rejected: {root_path}")
                    continue
                try:
                    resolved_root = root_path.resolve()
                    if resolved_root != resolved_docs and resolved_docs not in resolved_root.parents:
                        traversal_errors.append(f"Directory traversal outside vault rejected: {root_path}")
                        continue
                except Exception as exc:
                    traversal_errors.append(f"Path resolution error for {root_path}: {exc}")
                    continue

                for d in list(dirs):
                    d_path = root_path / d
                    try:
                        if d_path.is_symlink():
                            traversal_errors.append(f"Symlink directory rejected: {d_path}")
                            dirs.remove(d)
                            continue
                        resolved_d = d_path.resolve()
                        if resolved_docs not in resolved_d.parents and resolved_d != resolved_docs:
                            traversal_errors.append(f"Directory traversal outside vault rejected: {d_path}")
                            dirs.remove(d)
                            continue
                    except Exception as exc:
                        traversal_errors.append(f"Directory inspection error for {d_path}: {exc}")
                        dirs.remove(d)
                        continue

                for f in files:
                    p = root_path / f
                    try:
                        if p.is_symlink():
                            traversal_errors.append(f"Symlink file rejected: {p}")
                            continue
                        resolved_p = p.resolve()
                        if resolved_docs not in resolved_p.parents:
                            traversal_errors.append(f"File traversal outside vault rejected: {p}")
                            continue
                        if p.is_file():
                            rel = p.relative_to(docs_dir).as_posix().lower()
                            accessible_rel_paths.add(rel)
                    except (OSError, PermissionError) as exc:
                        traversal_errors.append(f"{p}: {exc}")
        except (OSError, PermissionError, Exception) as top_err:
            traversal_errors.append(f"{docs_dir}: {top_err}")

        if traversal_errors:
            logger.warning(
                "Vault directory traversal encountered %d read error(s). Aborting cleanup to prevent data loss: %s",
                len(traversal_errors),
                traversal_errors[:3],
            )
            return {
                "ok": False,
                "cleaned_up": 0,
                "message": f"Archive directory scan incomplete: {len(traversal_errors)} read error(s) during traversal. Reconciliation aborted.",
                "errors": traversal_errors[:10],
            }

        with get_db_connection() as con:
            cur = con.cursor()
            cur.execute("SELECT id, filename, original_name, file_hash, file_size, tags, created_at FROM documents")
            registered_docs = cur.fetchall()

        if registered_docs and not accessible_rel_paths:
            logger.warning("Vault documents directory is empty while %d documents are registered. Aborting cleanup.", len(registered_docs))
            return {
                "ok": False,
                "cleaned_up": 0,
                "message": "Archive directory is empty while documents are registered. Aborting cleanup to prevent catastrophic loss.",
            }

        # Identify missing candidate documents and validate relative paths
        candidates = []
        for d_row in registered_docs:
            fn = d_row["filename"]
            if not fn or Path(fn).is_absolute() or ".." in Path(fn).parts:
                logger.warning("Invalid or suspicious filename in database: %s", fn)
                continue
            cand_disk_path = docs_dir / fn
            # Check if cand_disk_path or any of its parent directory components is a symlink
            try:
                curr = cand_disk_path
                is_sym = False
                while curr != docs_dir and curr != curr.parent:
                    if curr.is_symlink():
                        is_sym = True
                        break
                    curr = curr.parent
                if is_sym:
                    logger.warning("Symlink path component detected for %s at %s. Aborting reconciliation.", fn, curr)
                    return {
                        "ok": False,
                        "cleaned_up": 0,
                        "message": f"Symlink detected for document path '{fn}' at '{curr}'. Reconciliation aborted to protect against unsafe deletion.",
                    }
            except Exception as exc:
                logger.warning("Error checking symlink for %s: %s", fn, exc)
                return {
                    "ok": False,
                    "cleaned_up": 0,
                    "message": f"Path check failed for '{fn}': {exc}. Reconciliation aborted.",
                }
            fn_rel = Path(fn).as_posix().lower()
            if fn_rel and fn_rel not in accessible_rel_paths:
                candidates.append(dict(d_row))

        candidate_ids = sorted(c["id"] for c in candidates)
        token = _compute_candidates_token(candidate_ids, expiry_seconds=300) if candidate_ids else ""

        # Handle dry-run preview
        if dry_run:
            return {
                "ok": True,
                "dry_run": True,
                "candidate_count": len(candidates),
                "candidates": [{"id": c["id"], "original_name": c["original_name"], "filename": c["filename"]} for c in candidates],
                "confirmation_token": token,
                "message": f"Dry-run preview: {len(candidates)} document(s) missing from disk. Pass confirmation_token to approve deletion." if candidates else "No missing documents found.",
            }

        if not approved:
            raise PermissionError("Destructive reconciliation requires explicit user approval.")

        # Require a non-empty confirmation token
        if not confirmation_token or not isinstance(confirmation_token, str) or not confirmation_token.strip():
            raise PermissionError("Destructive reconciliation requires a non-empty confirmation token.")

        # Validate token authenticity, freshness and candidate binding
        is_valid, token_msg = _verify_candidates_token(confirmation_token, candidate_ids)
        if not is_valid:
            logger.warning("Confirmation token validation failed: %s", token_msg)
            return {
                "ok": False,
                "cleaned_up": 0,
                "message": token_msg,
            }

        # Guard against candidate set drifting between preview and execution
        if expected_candidate_ids is not None and sorted(expected_candidate_ids) != candidate_ids:
            logger.warning("Candidate IDs mismatch expected preview set. Aborting cleanup.")
            return {
                "ok": False,
                "cleaned_up": 0,
                "message": "Candidate list changed since preview. Aborting cleanup to prevent accidental deletion.",
            }

        vault = get_vault_path()
        audit_log = vault / "cleanup_audit.log"
        recovery_dir = vault / "recovery"
        recovery_dir.mkdir(parents=True, exist_ok=True)
        if not secure_path_permissions(recovery_dir, is_dir=True):
            raise PermissionError(f"Failed to secure NTFS permissions on recovery directory {recovery_dir}")

        if not audit_log.exists():
            audit_log.touch()
        if not secure_path_permissions(audit_log, is_dir=False):
            raise PermissionError(f"Failed to secure NTFS permissions on cleanup audit log {audit_log}")

        now_iso = datetime.now().isoformat(timespec="seconds")
        with open(audit_log, "a", encoding="utf-8") as af:
            af.write(f"[{now_iso}] [INTENT] Initiating deletion reconciliation for {len(candidates)} candidate(s) (token={confirmation_token})\n")

        cleaned_up_count = 0
        partial_errors = []

        for c in candidates:
            d_id = c["id"]
            orig_name = c["original_name"]
            fn = c.get("filename")
            try:
                # Revalidate candidate immediately before deletion: check if file reappeared on disk
                if fn:
                    candidate_disk_path = docs_dir / fn
                    if candidate_disk_path.exists() and candidate_disk_path.is_file() and not candidate_disk_path.is_symlink():
                        logger.warning("Candidate %s reappeared on disk before deletion. Skipping.", fn)
                        continue

                # 1. Back up record and OCR text to recovery folder before deletion
                rec_file = recovery_dir / f"{d_id}.json"
                ocr_cache_path = get_ocr_cache_dir() / f"{d_id}.md"
                ocr_text = ""
                if ocr_cache_path.is_file():
                    try:
                        ocr_text = ocr_cache_path.read_text(encoding="utf-8", errors="replace")
                    except Exception:
                        pass
                rec_payload = {"metadata": c, "ocr_text": ocr_text, "deleted_at": now_iso}
                rec_file.write_text(json.dumps(rec_payload, indent=2), encoding="utf-8")
                if not secure_path_permissions(rec_file, is_dir=False):
                    raise PermissionError(f"Failed to secure NTFS permissions on recovery file {rec_file}")

                # 2. Delete database record AFTER recovery data is written and secured
                del_ok = delete_document(d_id)
                if not del_ok:
                    raise RuntimeError(f"Database deletion failed for document {d_id}")

                # 3. Purge WeKnora cache files
                try:
                    from modules.weknora.manager import get_data_dir
                    weknora_files_dir = get_data_dir() / "files"
                    if weknora_files_dir.is_dir():
                        stem = Path(orig_name).stem
                        md_f = weknora_files_dir / f"{stem}_ocr.md"
                        if md_f.is_file():
                            md_f.unlink(missing_ok=True)
                        orig_f = weknora_files_dir / Path(orig_name).name
                        if orig_f.is_file():
                            orig_f.unlink(missing_ok=True)
                except Exception as wek_err:
                    logger.debug("WeKnora cache cleanup error for %s: %s", orig_name, wek_err)

                cleaned_up_count += 1
                with open(audit_log, "a", encoding="utf-8") as af:
                    af.write(f"[{now_iso}] [DELETED] id={d_id} name='{orig_name}' hash={c.get('file_hash')}\n")
            except Exception as del_err:
                logger.exception("Failed deleting document %s: %s", d_id, del_err)
                partial_errors.append(f"{d_id}: {del_err}")
                with open(audit_log, "a", encoding="utf-8") as af:
                    af.write(f"[{now_iso}] [ERROR] id={d_id} error='{del_err}'\n")

        if partial_errors:
            with open(audit_log, "a", encoding="utf-8") as af:
                af.write(f"[{now_iso}] [PARTIAL FAILURE] Cleaned up {cleaned_up_count}/{len(candidates)} with {len(partial_errors)} error(s)\n")
            return {
                "ok": False,
                "partial_failure": True,
                "cleaned_up": cleaned_up_count,
                "total_candidates": len(candidates),
                "errors": partial_errors,
                "message": f"Cleanup partially failed: {len(partial_errors)} error(s).",
            }

        with open(audit_log, "a", encoding="utf-8") as af:
            af.write(f"[{now_iso}] [COMPLETE] Successfully purged {cleaned_up_count} missing document records\n")

        return {
            "ok": True,
            "cleaned_up": cleaned_up_count,
            "message": f"Successfully purged {cleaned_up_count} missing document records."
            if cleaned_up_count else "All registered documents verified present on disk.",
        }
    finally:
        _scan_lock.release()


def scan_and_sync_vault(
    auto_ocr: bool = False,
    lang: str = "eng",
    sync_weknora: bool = False,
    approved: bool = False,
) -> Dict[str, Any]:
    """Scans the external vault documents folder (~/Documents/OneEAD_Archive/documents)
    for any untracked or newly added files, registers them in meta.db.

    Automatic WeKnora synchronization is disabled by default and requires explicit approval.
    Destructive record deletion is NEVER performed by scan operations.
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

        resolved_docs = docs_dir.resolve()
        # Recursively traverse documents directory
        for item in docs_dir.rglob("*"):
            try:
                if item.is_symlink():
                    logger.warning("Ignoring symlink in vault documents: %s", item)
                    continue
                resolved_item = item.resolve()
                if resolved_item != resolved_docs and resolved_docs not in resolved_item.parents:
                    logger.warning("Rejecting path traversal outside vault: %s", item)
                    continue
            except Exception:
                continue
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

        # Process newly discovered documents: run OCR if requested (never auto-sync WeKnora by default)
        for d_id in docs_to_ocr:
            if auto_ocr:
                try:
                    process_document_ocr(d_id, lang=lang, auto_sync_weknora=False)
                except Exception as ocr_err:
                    logger.warning("OCR processing error for doc %s during scan: %s", d_id, ocr_err)
            if sync_weknora and approved:
                try:
                    copy_to_weknora_vault(d_id, auto_ocr_if_missing=False, approved=True)
                except Exception as w_err:
                    logger.debug("WeKnora sync error for doc %s: %s", d_id, w_err)

        # Reconcile documents with WeKnora ONLY if explicitly approved and requested
        if sync_weknora and approved:
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
                        copy_to_weknora_vault(d_row["id"], auto_ocr_if_missing=True, approved=True)
                    else:
                        upload_document_to_weknora_kb(d_row["id"])
            except Exception as sync_all_err:
                logger.debug("WeKnora reconciliation error: %s", sync_all_err)



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
            scan_and_sync_vault(auto_ocr=False, sync_weknora=False, approved=False)
        except Exception as exc:
            logger.debug("Initial vault scan error: %s", exc)

    while not _watcher_stop_event.is_set():
        if _watcher_stop_event.wait(interval_sec):
            break
        try:
            scan_and_sync_vault(auto_ocr=False, sync_weknora=False, approved=False)
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

