#!/usr/bin/env python3
"""
Local Standalone Document Extractor for WeKnora Lite.
Extracts clean Markdown / text from PDF, DOCX, XLSX, PPTX, and EPUB files
without needing Docker or any external cloud services.
"""

import sys
import os
import io

import unicodedata

def normalize_math_unicode(text: str) -> str:
    """Normalizes Mathematical Alphanumeric Symbols (U+1D400 to U+1D7FF) to standard ASCII equivalents."""
    result = []
    for ch in text:
        code = ord(ch)
        if 0x1D400 <= code <= 0x1D419 or 0x1D434 <= code <= 0x1D44D:
            offset = 0x1D434 if code >= 0x1D434 else 0x1D400
            result.append(chr(ord('A') + (code - offset)))
        elif 0x1D41A <= code <= 0x1D433 or 0x1D44E <= code <= 0x1D467:
            offset = 0x1D44E if code >= 0x1D44E else 0x1D41A
            result.append(chr(ord('a') + (code - offset)))
        elif ch in ['\u2212', '−']:
            result.append('-')
        elif ch in ['\u2217', '∗', '×']:
            result.append('*')
        else:
            decomp = unicodedata.normalize('NFKD', ch)
            result.append(decomp if decomp else ch)
    return "".join(result)

def extract_pdf(path: str) -> str:
    import fitz  # PyMuPDF
    doc = fitz.open(path)
    pages = []

    for i, page in enumerate(doc):
        # Normalize page rotation if landscape/rotated (e.g. standards with Rotate=270/90)
        orig_rot = page.rotation
        if orig_rot != 0:
            tabs_orig = page.find_tables()
            page.set_rotation(0)
            tabs_0 = page.find_tables()
            # If rotation 0 yields valid tables or cleaner orientation, keep 0; else restore
            if len(tabs_0.tables) >= len(tabs_orig.tables):
                tabs = tabs_0
            else:
                page.set_rotation(orig_rot)
                tabs = tabs_orig
        else:
            tabs = page.find_tables()

        table_bboxes = []
        table_dict = {}

        if tabs.tables:
            for t in tabs.tables:
                tb = tuple(t.bbox)
                table_bboxes.append(tb)
                table_dict[tb] = t.to_markdown()

        # 2. Extract drawings for radicals and horizontal rules
        drawings = page.get_drawings()
        sqrt_rects = []
        for dr in drawings:
            r = dr.get("rect")
            items = dr.get("items", [])
            if not r:
                continue
            w = r[2] - r[0]
            h = r[3] - r[1]
            if len(items) >= 2 and w > 15 and h > 8:
                sqrt_rects.append(r)

        # 2b. Extract vector drawing fraction lines and assemble LaTeX equations outside tables
        words = page.get_text("words")
        frac_lines = []
        for d in drawings:
            r = d.get("rect")
            if not r or r.height > 3.0 or r.width < 8.0:
                continue
            if any(r.x0 >= tb[0] - 5 and r.x1 <= tb[2] + 5 and r.y0 >= tb[1] - 5 and r.y1 <= tb[3] + 5 for tb in table_bboxes):
                continue
            # Exclude header/footer metadata
            if r.y0 < 110 or r.y1 > 750:
                continue
            frac_lines.append(r)

        # Group into equation rows
        frac_rows = {}
        for fl in frac_lines:
            y_key = round(fl.y0 / 12.0) * 12.0
            frac_rows.setdefault(y_key, []).append(fl)

        combined_items = []
        equation_suppress_rects = []

        # Add tables to page items
        for tb, md in table_dict.items():
            if md.strip():
                combined_items.append((tb[1], "table", md))

        for y_key, lines in frac_rows.items():
            avg_y = sum((l.y0 + l.y1) / 2.0 for l in lines) / len(lines)
            row_words = [w for w in words if abs((w[1] + w[3]) / 2.0 - avg_y) <= 22.0]
            if not row_words:
                continue

            frac_map = {}
            used_words = set()
            for fl in lines:
                above = []
                below = []
                for w in row_words:
                    cx = (w[0] + w[2]) / 2.0
                    cy = (w[1] + w[3]) / 2.0
                    if (fl.x0 - 3.0 <= cx <= fl.x1 + 3.0 or
                        (w[0] >= fl.x0 - 2.0 and w[2] <= fl.x1 + 2.0) or
                        (w[2] > fl.x0 and w[0] < fl.x1 and (w[2] - max(w[0], fl.x0)) >= 0.5 * (w[2] - w[0]))):
                        if cy < avg_y:
                            above.append(w)
                        elif cy > avg_y:
                            below.append(w)
                if not above or not below:
                    continue
                num_str = " ".join(normalize_math_unicode(w[4]) for w in sorted(above, key=lambda x: x[0])).strip()
                den_str = " ".join(normalize_math_unicode(w[4]) for w in sorted(below, key=lambda x: x[0])).strip()
                if not num_str or not den_str:
                    continue

                prefix = ""
                if num_str.startswith("(") and not num_str.endswith(")"):
                    prefix = "("
                    num_str = num_str[1:].strip()

                frac_latex = f"{prefix}\\frac{{{num_str}}}{{{den_str}}}"
                frac_map[fl.x0] = frac_latex
                for w in above + below:
                    used_words.add(id(w))

            if not frac_map:
                continue

            elements = []
            for fl in lines:
                if fl.x0 in frac_map:
                    elements.append((fl.x0, frac_map[fl.x0]))
            for w in row_words:
                if id(w) not in used_words:
                    cy = (w[1] + w[3]) / 2.0
                    if abs(cy - avg_y) <= 8.0:
                        txt = normalize_math_unicode(w[4])
                        elements.append((w[0], txt))

            elements.sort(key=lambda x: x[0])
            eq_text = " ".join(e[1] for e in elements)
            if eq_text:
                combined_items.append((avg_y, "formula", f"$$\n{eq_text}\n$$"))
                min_x = min(w[0] for w in row_words)
                max_x = max(w[2] for w in row_words)
                min_y = min(w[1] for w in row_words)
                max_y = max(w[3] for w in row_words)
                equation_suppress_rects.append((min_x - 5, min_y - 5, max_x + 5, max_y + 5))

        # 3. Extract text blocks
        d = page.get_text("dict")
        blocks = d.get("blocks", [])

        for b in blocks:
            if b.get("type") != 0:
                continue
            lines = b.get("lines", [])
            if not lines:
                continue

            b_bbox = b.get("bbox", (0, 0, 0, 0))

            # Exclude text that is already captured inside a table bounding box
            if any(b_bbox[0] >= tb[0] - 5 and b_bbox[2] <= tb[2] + 5 and b_bbox[1] >= tb[1] - 5 and b_bbox[3] <= tb[3] + 5 for tb in table_bboxes):
                continue

            # Exclude text that is already captured inside an equation row
            if any(b_bbox[0] >= sr[0] and b_bbox[2] <= sr[2] and b_bbox[1] >= sr[1] and b_bbox[3] <= sr[3] for sr in equation_suppress_rects):
                continue

            bh = b_bbox[3] - b_bbox[1]
            raw_block_text = "".join(s.get("text", "") for l in lines for s in l.get("spans", []))

            # Single-row math formula with sub/superscripts or radical
            is_formula = (bh <= 35 and len(lines) >= 2 and ("=" in raw_block_text or "THD" in raw_block_text or any(
                abs(r[1] - b_bbox[1]) < 15 and r[0] >= b_bbox[0] - 10 and r[2] <= b_bbox[2] + 15 for r in sqrt_rects
            )))

            if is_formula:
                spans = [s for l in lines for s in l.get("spans", []) if s.get("text")]
                if spans:
                    spans.sort(key=lambda s: s["bbox"][0])
                    base_size = max(s["size"] for s in spans)

                    has_sqrt = any(
                        abs(r[1] - b_bbox[1]) < 15 and r[0] >= b_bbox[0] - 10 and r[2] <= b_bbox[2] + 15
                        for r in sqrt_rects
                    )

                    tokens = []
                    for s in spans:
                        txt = s["text"]
                        sz = s["size"]
                        y0 = s["bbox"][1]
                        if sz < base_size * 0.82:
                            if y0 > b_bbox[1] + bh * 0.45:
                                tokens.append(f"_{txt}")
                            else:
                                tokens.append(f"^{txt}")
                        else:
                            tokens.append(txt)

                    assembled = "".join(tokens).strip()
                    assembled = assembled.replace("[ %]", "[%]").replace("( ", "(").replace(" )", ")")

                    if has_sqrt and "=" in assembled:
                        parts = assembled.split("=", 1)
                        left = parts[0].strip()
                        right = parts[1].strip()
                        if right.startswith("100"):
                            expr = right[3:].strip()
                            if "/" in expr:
                                num, den = expr.split("/", 1)
                                num = num.strip().lstrip("(").rstrip(")")
                                den = den.strip()
                                formula_latex = f"{left} = 100 \\sqrt{{\\frac{{{num}}}{{{den}}}}}"
                            else:
                                formula_latex = f"{left} = 100 \\sqrt{{{expr}}}"
                        else:
                            if "/" in right:
                                num, den = right.split("/", 1)
                                num = num.strip().lstrip("(").rstrip(")")
                                den = den.strip()
                                formula_latex = f"{left} = \\sqrt{{\\frac{{{num}}}{{{den}}}}}"
                            else:
                                formula_latex = f"{left} = \\sqrt{{{right}}}"
                        assembled = f"$$\n{formula_latex}\n$$"
                    elif "=" in assembled and ("^" in assembled or "_" in assembled):
                        assembled = f"$$\n{assembled}\n$$"

                    combined_items.append((b_bbox[1], "formula", assembled))
            else:
                # Group multi-line text by vertical baseline y-coordinate (e.g. definition lists)
                rows = {}
                for l in lines:
                    y = round(l["bbox"][1], 1)
                    found = False
                    for r_y in rows:
                        if abs(r_y - y) < 4:
                            rows[r_y].extend(l.get("spans", []))
                            found = True
                            break
                    if not found:
                        rows[y] = list(l.get("spans", []))

                sorted_rows = sorted(rows.items(), key=lambda x: x[0])
                block_text_lines = []
                for r_y, row_spans in sorted_rows:
                    row_spans.sort(key=lambda s: s["bbox"][0])
                    row_txt = "".join(normalize_math_unicode(s["text"]) for s in row_spans).strip()
                    if row_txt:
                        block_text_lines.append(row_txt)
                if block_text_lines:
                    combined_items.append((b_bbox[1], "text", "\n".join(block_text_lines)))

        # Sort all items (tables and text) by vertical y0 coordinate
        combined_items.sort(key=lambda x: x[0])
        page_text = "\n\n".join(item[2] for item in combined_items).strip()
        if page_text:
            pages.append(f"<!-- Page {i+1} -->\n{page_text}")

    doc.close()
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
