#!/usr/bin/env python3
"""
Local Standalone Document Extractor for WeKnora Lite.
Extracts clean Markdown / text from PDF, DOCX, XLSX, PPTX, and EPUB files
without needing Docker or any external cloud services.
"""

import sys
import os
import io

def extract_pdf(path: str) -> str:
    import fitz  # PyMuPDF
    doc = fitz.open(path)
    pages = []
    for i, page in enumerate(doc):
        text = page.get_text("text").strip()
        if text:
            pages.append(f"<!-- Page {i+1} -->\n{text}")
    return "\n\n".join(pages)

def extract_docx(path: str) -> str:
    import docx
    doc = docx.Document(path)
    lines = []
    for p in doc.paragraphs:
        text = p.text.strip()
        if not text:
            continue
        style_name = getattr(p.style, "name", "")
        if style_name.startswith("Heading 1"):
            lines.append(f"# {text}")
        elif style_name.startswith("Heading 2"):
            lines.append(f"## {text}")
        elif style_name.startswith("Heading 3"):
            lines.append(f"### {text}")
        else:
            lines.append(text)
    for table in doc.tables:
        for row in table.rows:
            row_vals = [c.text.strip().replace("\n", " ") for c in row.cells]
            if any(row_vals):
                lines.append(" | ".join(row_vals))
    return "\n\n".join(lines)

def extract_xlsx(path: str) -> str:
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True)
    lines = []
    for name in wb.sheetnames:
        ws = wb[name]
        lines.append(f"## Sheet: {name}")
        for row in ws.iter_rows(values_only=True):
            if any(c is not None and str(c).strip() for c in row):
                lines.append(" | ".join(str(c).strip().replace("\n", " ") if c is not None else "" for c in row))
    return "\n\n".join(lines)

def extract_pptx(path: str) -> str:
    import pptx
    prs = pptx.Presentation(path)
    slides = []
    for i, slide in enumerate(prs.slides):
        s_text = []
        for shape in slide.shapes:
            if shape.has_text_frame:
                for p in shape.text_frame.paragraphs:
                    t = p.text.strip()
                    if t:
                        s_text.append(t)
        if s_text:
            slides.append(f"## Slide {i+1}\n" + "\n".join(s_text))
    return "\n\n".join(slides)

def extract_epub(path: str) -> str:
    import fitz
    doc = fitz.open(path)
    pages = []
    for page in doc:
        t = page.get_text("text").strip()
        if t:
            pages.append(t)
    return "\n\n".join(pages)

def main():
    if len(sys.argv) < 3:
        print("Usage: python doc_extractor.py <file_path> <file_type>", file=sys.stderr)
        sys.exit(1)

    file_path = sys.argv[1]
    file_type = sys.argv[2].lower().lstrip(".")

    if not os.path.exists(file_path):
        print(f"File not found: {file_path}", file=sys.stderr)
        sys.exit(1)

    try:
        if file_type == "pdf":
            content = extract_pdf(file_path)
        elif file_type in ("docx", "doc"):
            content = extract_docx(file_path)
        elif file_type in ("xlsx", "xls"):
            content = extract_xlsx(file_path)
        elif file_type in ("pptx", "ppt"):
            content = extract_pptx(file_path)
        elif file_type == "epub":
            content = extract_epub(file_path)
        else:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()

        sys.stdout.buffer.write(content.encode("utf-8"))
    except Exception as e:
        print(f"Extraction error for {file_type}: {e}", file=sys.stderr)
        sys.exit(2)

if __name__ == "__main__":
    main()
