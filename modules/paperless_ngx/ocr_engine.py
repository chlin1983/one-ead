"""Local offline OCR and multi-format conversion engine for One EAD Paperless-ngx & WeKnora.

Implements the Dual-Pipeline Architecture:
Pipeline A (Visual Preview):
- Converts PPTX, DOCX, XLSX, and Images into cached high-fidelity PDFs.
- Enables seamless slide-by-slide and page-by-page viewing in the right panel without downloads.

Pipeline B (Text & OCR Extraction):
- PNG / JPG: Direct high-speed Tesseract OCR.
- PDF: PyMuPDF (MuPDF/Pdfium) vector extraction + Tesseract OCR for raster/scanned pages.
- DOCX / PPTX: python-docx / python-pptx direct clean text + OCR on embedded diagrams/slides.
- XLS / XLSX: openpyxl / pandas tabular Markdown extraction.
"""

from __future__ import annotations

import io
import logging
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("one_ead.paperless.ocr")

COMMON_TESSERACT_PATHS = [
    Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe"),
    Path(r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"),
    Path.home() / "AppData" / "Local" / "Programs" / "Tesseract-OCR" / "tesseract.exe",
    Path.home() / ".gemini" / "antigravity" / "tesseract" / "tesseract.exe",
]

COMMON_TESSDATA_DIRS = [
    Path.home() / ".gemini" / "antigravity" / "tessdata",
    Path(r"C:\Program Files\Tesseract-OCR\tessdata"),
    Path(r"C:\Program Files (x86)\Tesseract-OCR\tessdata"),
    Path.home() / "AppData" / "Local" / "Programs" / "Tesseract-OCR" / "tessdata",
]


def get_tessdata_dir() -> Optional[Path]:
    """Finds available tessdata language directory (e.g. for PyMuPDF embedded OCR)."""
    env_dir = os.environ.get("TESSDATA_PREFIX")
    if env_dir:
        p = Path(env_dir)
        if p.is_dir() and any(p.glob("*.traineddata")):
            return p

    for candidate in COMMON_TESSDATA_DIRS:
        if candidate.is_dir() and any(candidate.glob("*.traineddata")):
            return candidate

    return None


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


def get_tesseract_info() -> Dict[str, Any]:
    """Returns status, version, and available OCR language dictionaries."""
    bin_path = find_tesseract_binary()
    tessdata_dir = get_tessdata_dir()

    if bin_path:
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
                languages = [l for l in lines if not l.lower().startswith("list of")]
        except Exception as exc:
            logger.warning("Could not list tesseract languages: %s", exc)

        return {
            "installed": True,
            "engine": "system_binary",
            "path": str(bin_path),
            "version": version_str,
            "languages": languages,
            "download_url": "https://github.com/UB-Mannheim/tesseract/wiki",
        }

    # Embedded Tesseract inside PyMuPDF with local traineddata
    if tessdata_dir and tessdata_dir.is_dir():
        langs = [f.stem for f in tessdata_dir.glob("*.traineddata")]
        if langs:
            import pymupdf
            return {
                "installed": True,
                "engine": "pymupdf_embedded",
                "path": str(tessdata_dir),
                "version": f"v5.x (PyMuPDF {pymupdf.__version__})",
                "languages": sorted(langs),
                "download_url": "https://github.com/UB-Mannheim/tesseract/wiki",
            }

    return {
        "installed": False,
        "engine": "none",
        "path": None,
        "version": None,
        "languages": [],
        "download_url": "https://github.com/UB-Mannheim/tesseract/wiki",
    }


def clean_technical_ocr_text(text: str) -> str:
    """Cleans up common OCR artifacts in technical/engineering documents."""
    if not text:
        return ""
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
    """Executes Tesseract OCR on raw image bytes.
    
    Supports both external system tesseract.exe and PyMuPDF's built-in Tesseract C++ engine.
    """
    bin_path = tesseract_bin or find_tesseract_binary()

    # 1. External tesseract.exe if present
    if bin_path:
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
            out_text = proc.stdout.decode("utf-8", errors="replace")
            return clean_technical_ocr_text(out_text)
        finally:
            if tmp_in_path.is_file():
                try:
                    tmp_in_path.unlink()
                except Exception:
                    pass

    # 2. PyMuPDF embedded Tesseract engine with tessdata
    tessdata_dir = get_tessdata_dir()
    try:
        import pymupdf
        img_doc = pymupdf.open(stream=image_bytes, filetype="png")
        pdf_bytes = img_doc.convert_to_pdf()
        img_doc.close()
        pdf = pymupdf.open("pdf", pdf_bytes)
        page = pdf[0]
        tp = page.get_textpage_ocr(
            language=lang,
            tessdata=str(tessdata_dir) if tessdata_dir else None,
            dpi=150,
        )
        text = tp.extractText()
        pdf.close()
        return clean_technical_ocr_text(text)
    except Exception as exc:
        logger.warning("Embedded OCR extraction error: %s", exc)
        return ""


# =============================================================================
# Pipeline A: Document to PDF Conversion (for Right-Panel Preview)
# =============================================================================

def convert_pptx_to_pdf(input_path: Path, output_pdf_path: Path) -> bool:
    """Converts PowerPoint presentation to PDF using COM automation or python-pptx fallback."""
    # 1. Native Windows PowerPoint COM automation
    try:
        import pythoncom
        import win32com.client
        pythoncom.CoInitialize()
        try:
            ppt = win32com.client.DispatchEx("PowerPoint.Application")
            deck = ppt.Presentations.Open(str(input_path.resolve()), WithWindow=False, ReadOnly=True)
            # ppSaveAsPDF = 32
            deck.SaveAs(str(output_pdf_path.resolve()), 32)
            deck.Close()
            ppt.Quit()
            if output_pdf_path.is_file() and output_pdf_path.stat().st_size > 0:
                return True
        finally:
            pythoncom.CoUninitialize()
    except Exception as exc:
        logger.warning("PowerPoint COM conversion failed, trying fallback: %s", exc)

    # 2. Fallback: python-pptx + PyMuPDF slide builder
    try:
        import pptx
        import pymupdf
        prs = pptx.Presentation(str(input_path))
        doc = pymupdf.open()
        for i, slide in enumerate(prs.slides):
            page = doc.new_page(width=960, height=540)  # 16:9 standard slide
            page.draw_rect(pymupdf.Rect(0, 0, 960, 540), fill=(0.98, 0.98, 0.99))
            page.draw_rect(pymupdf.Rect(40, 30, 920, 32), color=(0.1, 0.4, 0.3), width=2)
            y = 70
            for shape in slide.shapes:
                if shape.has_text_frame:
                    for p in shape.text_frame.paragraphs:
                        t = p.text.strip()
                        if t and y < 500:
                            page.insert_text(pymupdf.Point(50, y), t, fontsize=14, color=(0.1, 0.1, 0.1))
                            y += 24
            page.insert_text(pymupdf.Point(860, 520), f"Slide {i+1}", fontsize=11, color=(0.5, 0.5, 0.5))
        doc.save(str(output_pdf_path))
        doc.close()
        return output_pdf_path.is_file() and output_pdf_path.stat().st_size > 0
    except Exception as exc:
        logger.error("PPTX fallback conversion failed: %s", exc)
        return False


def convert_docx_to_pdf(input_path: Path, output_pdf_path: Path) -> bool:
    """Converts Word document to PDF using COM automation or python-docx fallback."""
    # 1. Native Windows Word COM automation
    try:
        import pythoncom
        import win32com.client
        pythoncom.CoInitialize()
        try:
            word = win32com.client.DispatchEx("Word.Application")
            word.Visible = False
            word.DisplayAlerts = 0  # wdAlertsNone
            wdoc = word.Documents.Open(str(input_path.resolve()), ReadOnly=True, Visible=False)
            # wdExportFormatPDF = 17
            wdoc.ExportAsFixedFormat(str(output_pdf_path.resolve()), 17)
            wdoc.Close(False)
            word.Quit()
            if output_pdf_path.is_file() and output_pdf_path.stat().st_size > 0:
                return True
        finally:
            pythoncom.CoUninitialize()
    except Exception as exc:
        logger.warning("Word COM conversion failed, trying fallback: %s", exc)

    # 2. Fallback: python-docx + PyMuPDF document builder
    try:
        import docx
        import pymupdf
        w_doc = docx.Document(str(input_path))
        pdf = pymupdf.open()
        page = pdf.new_page(width=595, height=842)  # A4 portrait
        y = 50
        for p in w_doc.paragraphs:
            text = p.text.strip()
            if not text:
                continue
            if y > 780:
                page = pdf.new_page(width=595, height=842)
                y = 50
            fsize = 14 if p.style.name.startswith("Heading") else 10
            page.insert_text(pymupdf.Point(50, y), text, fontsize=fsize, color=(0.1, 0.1, 0.1))
            y += fsize + 8
        pdf.save(str(output_pdf_path))
        pdf.close()
        return output_pdf_path.is_file() and output_pdf_path.stat().st_size > 0
    except Exception as exc:
        logger.error("DOCX fallback conversion failed: %s", exc)
        return False


def convert_xlsx_to_pdf(input_path: Path, output_pdf_path: Path) -> bool:
    """Converts Excel workbook to PDF using openpyxl + PyMuPDF table renderer with COM fallback."""
    # 1. Fast & reliable pure Python openpyxl table layout
    try:
        import openpyxl
        import pymupdf
        wb = openpyxl.load_workbook(str(input_path), data_only=True)
        pdf = pymupdf.open()
        for name in wb.sheetnames:
            ws = wb[name]
            page = pdf.new_page(width=842, height=595)  # A4 landscape
            page.draw_rect(pymupdf.Rect(0, 0, 842, 595), fill=(0.99, 0.99, 1.0))
            page.insert_text(pymupdf.Point(40, 40), f"Sheet: {name}", fontsize=14, color=(0.1, 0.4, 0.3))
            y = 70
            for row in ws.iter_rows(values_only=True):
                vals = [str(c).strip() if c is not None else "" for c in row]
                if any(vals):
                    if y > 560:
                        page = pdf.new_page(width=842, height=595)
                        y = 50
                    row_txt = "   |   ".join(vals[:8])
                    page.insert_text(pymupdf.Point(40, y), row_txt[:120], fontsize=10, color=(0.1, 0.1, 0.1))
                    y += 18
        pdf.save(str(output_pdf_path))
        pdf.close()
        if output_pdf_path.is_file() and output_pdf_path.stat().st_size > 0:
            return True
    except Exception as exc:
        logger.warning("openpyxl table rendering note: %s", exc)

    # 2. COM fallback if openpyxl fails
    try:
        import pythoncom
        import win32com.client
        pythoncom.CoInitialize()
        try:
            excel = win32com.client.DispatchEx("Excel.Application")
            excel.Visible = False
            excel.DisplayAlerts = False
            wb = excel.Workbooks.Open(str(input_path.resolve()), ReadOnly=True)
            wb.ExportAsFixedFormat(0, str(output_pdf_path.resolve()))
            wb.Close(False)
            excel.Quit()
            if output_pdf_path.is_file() and output_pdf_path.stat().st_size > 0:
                return True
        finally:
            pythoncom.CoUninitialize()
    except Exception as exc:
        logger.error("Excel COM conversion failed: %s", exc)

    return False


def convert_image_to_pdf(input_path: Path, output_pdf_path: Path) -> bool:
    """Converts PNG, JPG, or other image files to a 1-page high-res PDF via PyMuPDF."""
    try:
        import pymupdf
        img_doc = pymupdf.open(str(input_path))
        pdf_bytes = img_doc.convert_to_pdf()
        img_doc.close()
        pdf = pymupdf.open("pdf", pdf_bytes)
        pdf.save(str(output_pdf_path))
        pdf.close()
        return output_pdf_path.is_file() and output_pdf_path.stat().st_size > 0
    except Exception as exc:
        logger.error("Image to PDF conversion failed: %s", exc)
        return False


def convert_to_pdf(input_path: Path, output_pdf_path: Path) -> bool:
    """Converts any supported document or image into a preview PDF."""
    ext = input_path.suffix.lower()
    if ext == ".pdf":
        shutil.copy2(str(input_path), str(output_pdf_path))
        return True
    elif ext in (".pptx", ".ppt"):
        return convert_pptx_to_pdf(input_path, output_pdf_path)
    elif ext in (".docx", ".doc"):
        return convert_docx_to_pdf(input_path, output_pdf_path)
    elif ext in (".xlsx", ".xls", ".csv"):
        return convert_xlsx_to_pdf(input_path, output_pdf_path)
    elif ext in (".png", ".jpg", ".jpeg", ".tiff", ".tif", ".bmp", ".webp"):
        return convert_image_to_pdf(input_path, output_pdf_path)
    elif ext in (".txt", ".md"):
        try:
            import pymupdf
            content = input_path.read_text(encoding="utf-8", errors="replace")
            pdf = pymupdf.open()
            page = pdf.new_page(width=595, height=842)
            y = 50
            for line in content.splitlines():
                if y > 790:
                    page = pdf.new_page(width=595, height=842)
                    y = 50
                page.insert_text(pymupdf.Point(40, y), line[:100], fontsize=9)
                y += 14
            pdf.save(str(output_pdf_path))
            pdf.close()
            return True
        except Exception as exc:
            logger.error("Text to PDF conversion failed: %s", exc)
            return False
    return False


# =============================================================================
# Pipeline B: Multi-Format Text & OCR Extraction
# =============================================================================

def extract_and_ocr_pdf(
    pdf_path: Path,
    lang: str = "eng",
    min_digital_words: int = 25,
    dpi: int = 150,
) -> Tuple[str, int, int]:
    """Extracts text from a PDF, automatically performing OCR on scanned/image pages.
    
    Returns:
        tuple (markdown_content, total_pages, ocr_pages_count)
    """
    import pymupdf
    doc = pymupdf.open(str(pdf_path))
    total_pages = len(doc)
    ocr_pages_count = 0
    pages_output: List[str] = []

    tesseract_bin = find_tesseract_binary()
    tessdata_dir = get_tessdata_dir()
    ocr_available = bool(tesseract_bin or tessdata_dir)

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
            if ocr_available:
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
                if native_text:
                    page_blocks.append(native_text)
                else:
                    page_blocks.append("*(Scanned page — Install Tesseract OCR to extract text)*")
                pages_output.append(f"<!-- Page {page_num} [Unprocessed Scan] -->\n" + "\n\n".join(page_blocks))

    doc.close()
    return "\n\n".join(pages_output), total_pages, ocr_pages_count


def extract_and_ocr_document(
    doc_path: Path,
    preview_pdf_path: Optional[Path] = None,
    lang: str = "eng",
) -> Tuple[str, int, int]:
    """Dual-Pipeline text extraction & OCR dispatcher for any document type.
    
    - PNG/JPG: Direct Tesseract OCR (1 page).
    - PDF: Native vector text + Tesseract OCR on scanned pages.
    - PPTX/DOCX/XLSX: High-fidelity PDF pages + python-pptx/docx/openpyxl clean text.
    
    Returns:
        tuple (markdown_content, total_pages, ocr_pages_count)
    """
    ext = doc_path.suffix.lower()

    # 1. Direct Image OCR (PNG, JPG, etc.)
    if ext in (".png", ".jpg", ".jpeg", ".tiff", ".tif", ".bmp", ".webp"):
        img_bytes = doc_path.read_bytes()
        ocr_text = run_ocr_on_image(img_bytes, lang=lang)
        md = f"<!-- Page 1 [Image OCR] -->\n\n{ocr_text}" if ocr_text else f"# {doc_path.name}\n\n*(Image without detected text)*"
        return md, 1, 1 if ocr_text else 0

    # 2. PDF Document
    if ext == ".pdf":
        return extract_and_ocr_pdf(doc_path, lang=lang)

    # 3. Office Documents (PPTX, DOCX, XLSX)
    # Use converted preview PDF for page-by-page visual structure & scanned image OCR
    pdf_target = preview_pdf_path if (preview_pdf_path and preview_pdf_path.is_file()) else None
    
    pdf_md = ""
    total_pages = 1
    ocr_pages = 0

    if pdf_target:
        try:
            pdf_md, total_pages, ocr_pages = extract_and_ocr_pdf(pdf_target, lang=lang)
        except Exception as exc:
            logger.warning("PDF extraction failed on converted preview %s: %s", pdf_target, exc)

    # Direct clean text extraction from original Office files via WeKnora doc_extractor
    clean_text = ""
    try:
        from modules.weknora.scripts import doc_extractor
        if ext in (".pptx", ".ppt"):
            clean_text = doc_extractor.extract_pptx(str(doc_path))
        elif ext in (".docx", ".doc"):
            clean_text = doc_extractor.extract_docx(str(doc_path))
        elif ext in (".xlsx", ".xls"):
            clean_text = doc_extractor.extract_xlsx(str(doc_path))
    except Exception as exc:
        logger.debug("Native Office extraction note: %s", exc)

    # Combine PDF page structure with clean Office text
    combined_blocks = []
    if pdf_md:
        combined_blocks.append(pdf_md)
    if clean_text and clean_text.strip() not in pdf_md:
        combined_blocks.append(f"\n\n<!-- Native Office Digital Content -->\n{clean_text}")

    full_md = "\n\n".join(combined_blocks).strip() or clean_text or f"# {doc_path.name}"
    return full_md, max(1, total_pages), ocr_pages
