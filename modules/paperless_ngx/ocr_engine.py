"""Local offline OCR engine for One EAD Paperless-ngx & WeKnora.

Provides Tesseract autodetection and hybrid PDF extraction:
- Uses PyMuPDF for native vector text and table extraction.
- Detects scanned/raster pages and seamlessly runs local Tesseract OCR.
- 100% offline: zero external network calls, zero Ghostscript dependency.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger("one_ead.paperless.ocr")

COMMON_TESSERACT_PATHS = [
    Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe"),
    Path(r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"),
    Path.home() / "AppData" / "Local" / "Programs" / "Tesseract-OCR" / "tesseract.exe",
]


def find_tesseract_binary() -> Optional[Path]:
    """Finds the local Tesseract OCR executable on the Windows host."""
    env_cmd = os.environ.get("TESSERACT_CMD")
    if env_cmd:
        p = Path(env_cmd)
        if p.is_file():
            return p

    which_cmd = shutil.which("tesseract") or shutil.which("tesseract.exe")
    if which_cmd:
        p = Path(which_cmd)
        if p.is_file():
            return p

    for candidate in COMMON_TESSERACT_PATHS:
        if candidate.is_file():
            return candidate

    return None


def get_tesseract_info() -> Dict[str, any]:
    """Returns status, version, and available OCR language dictionaries."""
    bin_path = find_tesseract_binary()
    if not bin_path:
        return {
            "installed": False,
            "path": None,
            "version": None,
            "languages": [],
            "download_url": "https://github.com/UB-Mannheim/tesseract/wiki",
        }

    version_str = "Unknown"
    languages: List[str] = []

    try:
        ver_proc = subprocess.run(
            [str(bin_path), "--version"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        if ver_proc.stdout:
            first_line = ver_proc.stdout.strip().splitlines()[0]
            version_str = first_line.replace("tesseract", "").strip()
    except Exception as exc:
        logger.warning("Could not read tesseract version: %s", exc)

    try:
        lang_proc = subprocess.run(
            [str(bin_path), "--list-langs"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        out = lang_proc.stdout or lang_proc.stderr
        if out:
            lines = [line.strip() for line in out.splitlines() if line.strip()]
            # Skip the header line ("List of available languages...")
            languages = [l for l in lines if not l.lower().startswith("list of")]
    except Exception as exc:
        logger.warning("Could not list tesseract languages: %s", exc)

    return {
        "installed": True,
        "path": str(bin_path),
        "version": version_str,
        "languages": languages,
        "download_url": "https://github.com/UB-Mannheim/tesseract/wiki",
    }


def clean_technical_ocr_text(text: str) -> str:
    """Cleans up common OCR artifacts in technical/engineering documents."""
    if not text:
        return ""
    # Normalize unicode quotes and dashes
    t = text.replace("\r\n", "\n").replace("\r", "\n")
    t = re.sub(r"[ \t]+", " ", t)
    # Common engineering unit fixes
    t = re.sub(r"\bOhm\b", "Ω", t, flags=re.IGNORECASE)
    t = re.sub(r"\b[uU][Ff]\b", "µF", t)
    t = re.sub(r"\b[uU][Hh]\b", "µH", t)
    t = re.sub(r"\b[uU][Vv]\b", "µV", t)
    t = re.sub(r"\b[uU][Aa]\b", "µA", t)
    t = re.sub(r"\b[dD][bB]\b", "dB", t)
    t = re.sub(r"\b[kK][hH][zZ]\b", "kHz", t)
    t = re.sub(r"\b[mM][hH][zZ]\b", "MHz", t)
    t = re.sub(r"\b[gG][hH][zZ]\b", "GHz", t)
    return t.strip()


def run_ocr_on_image(image_bytes: bytes, lang: str = "eng", tesseract_bin: Optional[Path] = None) -> str:
    """Executes local tesseract.exe on image bytes and returns raw extracted text."""
    bin_path = tesseract_bin or find_tesseract_binary()
    if not bin_path:
        raise RuntimeError("Tesseract OCR is not installed or not found on PATH.")

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp_in:
        tmp_in_path = Path(tmp_in.name)
        tmp_in.write(image_bytes)

    try:
        cmd = [str(bin_path), str(tmp_in_path), "stdout", "-l", lang]
        proc = subprocess.run(
            cmd,
            capture_output=True,
            timeout=90,
            check=False,
        )
        if proc.returncode != 0:
            err = proc.stderr.decode("utf-8", errors="replace")
            logger.warning("Tesseract process error: %s", err)
        out_text = proc.stdout.decode("utf-8", errors="replace")
        return clean_technical_ocr_text(out_text)
    finally:
        if tmp_in_path.is_file():
            try:
                tmp_in_path.unlink()
            except Exception:
                pass


def extract_and_ocr_pdf(
    pdf_path: Path,
    lang: str = "eng",
    min_digital_words: int = 30,
    dpi: int = 200,
) -> Tuple[str, int, int]:
    """Extracts text from a PDF, automatically performing OCR on scanned/image pages.
    
    Returns:
        tuple (markdown_content, total_pages, ocr_pages_count)
    """
    import fitz  # PyMuPDF

    doc = fitz.open(str(pdf_path))
    total_pages = len(doc)
    ocr_pages_count = 0
    pages_output: List[str] = []

    tesseract_bin = find_tesseract_binary()

    for page_idx in range(total_pages):
        page = doc[page_idx]
        page_num = page_idx + 1

        # Check native digital tables
        tabs = page.find_tables()
        table_mds = [t.to_markdown() for t in tabs.tables if t.to_markdown().strip()] if tabs else []

        # Check native digital text
        native_text = page.get_text("text").strip()
        word_count = len(native_text.split())

        page_blocks: List[str] = []

        if word_count >= min_digital_words:
            # Native digital page
            if table_mds:
                page_blocks.extend(table_mds)
            if native_text:
                page_blocks.append(native_text)
            pages_output.append(f"<!-- Page {page_num} [Digital] -->\n" + "\n\n".join(page_blocks))
        else:
            # Scanned / raster page: Needs OCR
            if tesseract_bin:
                try:
                    pix = page.get_pixmap(dpi=dpi)
                    img_bytes = pix.tobytes("png")
                    ocr_text = run_ocr_on_image(img_bytes, lang=lang, tesseract_bin=tesseract_bin)
                    ocr_pages_count += 1
                    if ocr_text:
                        page_blocks.append(ocr_text)
                    elif native_text:
                        page_blocks.append(native_text)
                    pages_output.append(f"<!-- Page {page_num} [OCR] -->\n" + "\n\n".join(page_blocks))
                except Exception as exc:
                    logger.error("Failed to OCR page %d of %s: %s", page_num, pdf_path.name, exc)
                    if native_text:
                        page_blocks.append(native_text)
                    pages_output.append(f"<!-- Page {page_num} [OCR Failed] -->\n" + "\n\n".join(page_blocks))
            else:
                # Tesseract not installed yet
                if native_text:
                    page_blocks.append(native_text)
                else:
                    page_blocks.append("*(Scanned page — Install Tesseract OCR to extract text)*")
                pages_output.append(f"<!-- Page {page_num} [Unprocessed Scan] -->\n" + "\n\n".join(page_blocks))

    doc.close()
    return "\n\n".join(pages_output), total_pages, ocr_pages_count
