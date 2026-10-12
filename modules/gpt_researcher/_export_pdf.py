"""Renders a finished report to PDF inside the private venv.

Usage: ``python _export_pdf.py <report_dir>``; reads ``report.md`` (+ ``meta.json``) and writes ``report.pdf``.
Raw HTML in the Markdown is escaped and nothing is fetched from the network.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

import mistune
import pymupdf

CSS = """
body { font-family: sans-serif; font-size: 10pt; line-height: 1.4; color: #1b232d; }
h1 { font-size: 18pt; margin: 0 0 8pt 0; color: #0f4c5c; }
h2 { font-size: 13.5pt; margin: 14pt 0 4pt 0; color: #0f4c5c; border-bottom: 0.6pt solid #9fb3bd; }
h3 { font-size: 11.5pt; margin: 10pt 0 3pt 0; }
h4, h5, h6 { font-size: 10.5pt; margin: 8pt 0 2pt 0; }
p { margin: 0 0 6pt 0; }
ul, ol { margin: 0 0 6pt 0; }
li { margin: 0 0 2pt 0; }
code { font-family: monospace; font-size: 9pt; background-color: #eef2f5; }
pre { font-family: monospace; font-size: 8.5pt; background-color: #eef2f5; padding: 4pt; }
blockquote { margin: 0 0 6pt 12pt; color: #44525f; }
table { border-collapse: collapse; margin: 0 0 8pt 0; }
th, td { border: 0.5pt solid #8a99a6; padding: 3pt; font-size: 9pt; }
th { background-color: #e3eaf0; }
a { color: #0b6a88; }
"""

PAGE = pymupdf.paper_rect("a4")
MARGINS = (54, 56, -54, -64)  # left, top, right, bottom (bottom leaves room for the footer)


def main() -> int:
    folder = Path(sys.argv[1])
    markdown = (folder / "report.md").read_text(encoding="utf-8-sig", errors="replace")
    meta = {}
    try:
        meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
    except Exception:
        pass

    render = mistune.create_markdown(escape=True, plugins=["table", "strikethrough", "url"])
    story = pymupdf.Story(html=render(markdown), user_css=CSS, em=10)

    draft = folder / "report.draft.pdf"
    writer = pymupdf.DocumentWriter(str(draft))
    where = PAGE + MARGINS
    links = []  # (page index, rect, uri); Story drawing does not keep hyperlinks, so they are re-added below
    pages = 0
    more = True
    while more:
        device = writer.begin_page(PAGE)
        more, _ = story.place(where)

        def record(pos):
            if pos.href and str(pos.href).lower().startswith(("http://", "https://")):
                links.append((pages, pymupdf.Rect(pos.rect), pos.href))

        story.element_positions(record)
        story.draw(device)
        writer.end_page()
        pages += 1
    writer.close()
    del writer, device, story  # Windows keeps the draft locked until these are released

    doc = pymupdf.open(str(draft))
    for index, rect, uri in links:
        rect = rect & PAGE
        if index < doc.page_count and rect.width > 1 and rect.height > 1:
            doc[index].insert_link({"kind": pymupdf.LINK_URI, "from": rect, "uri": str(uri)})
    created = meta.get("created_at", "")
    try:
        created = datetime.fromisoformat(created).astimezone().strftime("%Y-%m-%d")
    except ValueError:
        created = ""
    footer = " | ".join(p for p in ("GPT Researcher (local AI)", meta.get("model", ""), created) if p)
    total = doc.page_count
    for number, page in enumerate(doc, 1):
        y = PAGE.height - 34
        page.insert_text((MARGINS[0], y), footer, fontsize=7.5, fontname="helv", color=(0.45, 0.5, 0.55))
        label = f"{number} / {total}"
        width = pymupdf.get_text_length(label, fontname="helv", fontsize=7.5)
        page.insert_text((PAGE.width + MARGINS[2] - width, y), label, fontsize=7.5, fontname="helv",
                         color=(0.45, 0.5, 0.55))
    doc.set_metadata({"title": meta.get("query", "Research report")[:200], "producer": "One EAD / GPT Researcher",
                      "creator": "GPT Researcher"})
    doc.save(str(folder / "report.pdf"), garbage=3, deflate=True)
    doc.close()
    draft.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
