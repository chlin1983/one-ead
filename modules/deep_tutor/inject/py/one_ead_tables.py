"""One EAD: keep PDF tables readable in DeepTutor's extracted text.

DeepTutor's built-in PDF extraction flattens a table into one cell per line, so a model can no
longer tell which value sits under which column header. This post-processes the extracted
Markdown (``--- Page N ---`` sections): the flattened cell lines of each ruled table are replaced
by a Markdown grid plus one self-contained "row fact" line per data row.

Runs in a short-lived worker process (see sitecustomize.py); any failure leaves the text as is.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

VERSION = "10"

_PAGE_RE = re.compile(r"(?m)^--- Page (\d+) ---[ \t]*$")
_CAPTION_RE = re.compile(r"^\s*(Table|TABLE)\s+[A-Z]?\.?\d+[\s.\u2013\u2014-]")
_DATA_RE = re.compile(
    r"^(?:[<>\u2264\u2265\u00b1~+\-\u2013]?\s*\d[\d.,\s]*(?:to\s*[\d.,]+)?\s*[^\s\d]{0,6}|"
    r"not\s+relevant|n/?a|[-\u2013\u2014]+)$",
    re.IGNORECASE,
)
_NULL_RE = re.compile(r"^(not\s+relevant|n/?a|not\s+applicable|[-\u2013\u2014]+)$", re.IGNORECASE)
_HEADER_KW = re.compile(
    r"(parameter|minimum|nominal|maximum|units|conditions|frequency|mode|specification|limits|test level)",
    re.IGNORECASE,
)
_GENERIC_KEY = re.compile(r"^(parameter|parameters|item|items|specification|specifications)$", re.IGNORECASE)
_MIN_DRAWINGS = 6  # ruled tables are drawn with lines/rects; skip pages that have none
_MAX_AVG_CELL_CHARS = 120  # long cells mean a text box, not a table


def _clean(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().replace("|", "/")


def _is_data(cell: str) -> bool:
    return bool(_DATA_RE.match(cell))


def _dataness(row: list) -> float:
    filled = [c for c in row if c]
    return sum(_is_data(c) for c in filled) / len(filled) if filled else 1.0


def _grid(table):
    """Cleaned rows with merged-cell gaps filled, column alignment, and footnotes split off."""
    raw = table.extract()
    if not raw:
        return None
    width = max(len(r) for r in raw)
    rows = [list(r) + [None] * (width - len(r)) for r in raw]

    # Split off genuine footnote cells from the last column only (e.g. footnote 'a If provided.')
    notes: list[str] = []
    if len(rows) > 3 and width > 2:
        last_c = width - 1
        texts = [_clean(r[last_c]) for r in rows if _clean(r[last_c])]
        if len(texts) == 1:
            t = texts[0]
            if len(t) < 80 and (
                t.startswith(("*", "a ", "1 ", "2 ", "Note", "note"))
                or "if provided" in t.lower()
                or "provided" in t.lower()
            ):
                notes.append(t)
                for r in rows:
                    r[last_c] = None

    # Align columns where row 0 (or bottom row) has header text that was split into an adjacent sub-column
    for h_idx in (0, -1):
        other_range = range(1, len(rows)) if h_idx == 0 else range(len(rows) - 1)
        for c in range(1, width):
            has_h = bool(rows[h_idx][c])
            has_b = any(rows[r][c] for r in other_range)
            prev_has_h = bool(rows[h_idx][c - 1])
            prev_has_b = any(rows[r][c - 1] for r in other_range)
            if has_h and not has_b and not prev_has_h and prev_has_b:
                rows[h_idx][c - 1] = rows[h_idx][c]
                rows[h_idx][c] = None

    # Vertically merged group labels in the first column repeat for the rows they span.
    last = ""
    for r in rows:
        c0 = _clean(r[0])
        if not c0 and last:
            r[0] = last
        elif c0:
            last = c0

    grid = [[_clean(c) for c in r] for r in rows]
    keep = [c for c in range(width) if any(r[c] for r in grid)]
    grid = [[r[c] for c in keep] for r in grid if any(r[col] for col in keep)]
    if len(grid) < 2 or (grid and len(grid[0]) < 2):
        return None
    cells = [c for r in grid for c in r if c]
    if not cells or sum(map(len, cells)) / len(cells) > _MAX_AVG_CELL_CHARS:
        return None
    return grid, notes


def _split_header(grid):
    """(header, data rows); prioritize standard header words, then dataness."""
    # Find row with the highest concentration of header keywords (supports multi-section tables)
    best_idx = -1
    best_kw_count = 0
    for idx, r in enumerate(grid):
        kw_count = sum(1 for c in r if _HEADER_KW.search(c))
        if kw_count > best_kw_count:
            best_kw_count = kw_count
            best_idx = idx

    if best_kw_count >= 2:
        header = list(grid[best_idx])
        if not header[0] or _HEADER_KW.search(header[0]):
            header[0] = "Parameter"
        if len(header) > 1 and not header[1] and any(len(r) > 1 and r[1] for r in grid):
            header[1] = "Condition / Frequency"
        data_rows = [
            r for i, r in enumerate(grid)
            if i != best_idx and sum(1 for c in r if _HEADER_KW.search(c)) < 2
        ]
        return header, data_rows

    h0 = sum(1 for c in grid[0] if _HEADER_KW.search(c))
    h1 = sum(1 for c in grid[-1] if _HEADER_KW.search(c))
    if h0 > 0 and h0 >= h1:
        return grid[0], grid[1:]
    if h1 > 0 and h1 > h0:
        return grid[-1], grid[:-1]
    first, last = _dataness(grid[0]), _dataness(grid[-1])
    if first < last:
        return grid[0], grid[1:]
    if last < first:
        return grid[-1], grid[:-1]
    return None, grid


_TAG_RE = re.compile(r"^(?:Table|TABLE)\s+[A-Z]*\.?\d+")


def _facts(header, row):
    """(key header, key value, text) for a row; columns with equal values are merged.

    text is "" when every value is empty or "Not relevant" (the caller summarises those rows).
    """
    pairs = [(h, v) for h, v in zip(header, row) if h and v]
    if not pairs:
        return None
    (key, key_value), rest = pairs[0], pairs[1:]
    non_null = [(h, v) for h, v in rest if not _NULL_RE.match(v)]
    if not non_null:
        return key, key_value, ""
    merged: dict = {}
    for h, v in non_null:
        merged.setdefault(v, []).append(h)
    return key, key_value, "; ".join(f"{', '.join(hs)} = {v}" for v, hs in merged.items())


def _render(grid, notes, caption: str) -> str:
    title = caption or "Table"
    tag = (_TAG_RE.match(title) or ["Table"])[0]
    header, data = _split_header(grid)
    if not header:
        width = len(grid[0])
        out = [f"[{title}]", "| " + " | ".join(f"col {i + 1}" for i in range(width)) + " |", "|" + "---|" * width]
        out += ["| " + " | ".join(row) + " |" for row in data]
        out += [f"Note: {n}" for n in notes]
        return "\n".join(out)

    lines = [title]
    labels = list(dict.fromkeys(", ".join(v for h, v in zip(header, r) if v and not h) for r in data))
    named = [h for h in header if h]
    if len(named) >= 2:
        named_str = ", ".join(named[1:])
        lines.append(
            f"{tag} lists the values, test levels, limits and requirements for {named_str}"
            f" by {named[0]}" + (f", for {'; '.join(filter(None, labels))}" if any(labels) else "") + "."
        )
    skipped: dict = {}  # row group -> (key header, key values) of rows with nothing but "Not relevant"
    for row in data:
        label = ", ".join(v for h, v in zip(header, row) if v and not h and v != "-")
        fact = _facts(header, row)
        if not fact:
            continue
        key, key_value, text = fact
        subj = key_value if _GENERIC_KEY.match(key) else f"{key} {key_value}"
        if text:
            parts = [p for p in (tag, label, f"{subj}: {text}") if p and p != "-"]
            lines.append(", ".join(parts) + ".")
        else:
            skipped.setdefault(label, (key, []))[1].append(key_value)
    for label, (key, values) in skipped.items():
        val_str = "; ".join(values)
        subj = val_str if _GENERIC_KEY.match(key) else f"{key} {val_str}"
        parts = [p for p in (tag, label, f"{subj}: Not relevant") if p and p != "-"]
        lines.append(", ".join(parts) + ".")
    for n in notes:
        lines.append(f"{tag}, note: {n}")
    return "\n".join(lines)


def _captions(lines: list) -> list:
    found = []
    for i, line in enumerate(lines):
        if _CAPTION_RE.match(line):
            extra = lines[i + 1].strip() if i + 1 < len(lines) else ""
            found.append(_clean(line + (" " + extra if extra and len(extra) < 120 else "")))
    return found


def _replace_cells(lines: list, table_words: set, cell_count: int):
    """Drop the flattened cell lines of one table; return (index to insert at, remaining lines)."""
    hits = [i for i, ln in enumerate(lines) if ln.strip() and set(ln.split()) <= table_words and len(ln.split()) <= 12]
    clusters, cur = [], []
    for i in hits:
        if cur and i - cur[-1] > 3:
            clusters.append(cur)
            cur = []
        cur.append(i)
    if cur:
        clusters.append(cur)
    if not clusters:
        return None
    best = max(clusters, key=len)
    if len(best) < max(4, 0.6 * cell_count):
        return None
    drop = set(best)
    return best[0], [ln for i, ln in enumerate(lines) if i not in drop]


def _process_page(page, text: str) -> str:
    if len(page.get_drawings()) < _MIN_DRAWINGS:
        return text
    found = page.find_tables()
    parsed = [g for g in (_grid(t) for t in found.tables) if g]
    if not parsed:
        return text
    lines = text.split("\n")
    captions = _captions(lines)
    for n, (grid, notes) in enumerate(parsed):
        caption = captions[n] if len(captions) == len(parsed) else (captions[0] if len(parsed) == 1 and captions else "")
        block = _render(grid, notes, caption)
        words = {w for r in grid for c in r for w in c.split()} | {w for nt in notes for w in nt.split()}
        count = sum(1 for r in grid for c in r if c)
        replaced = _replace_cells(lines, words, count)
        if replaced:
            at, kept = replaced
            lines = kept[:at] + [block] + kept[at:]
        else:
            lines.append(block)
    return "\n".join(lines)


def restructure_text(pdf_path: str, md_text: str) -> str:
    import pymupdf

    parts = _PAGE_RE.split(md_text)
    # parts = [preamble, num, body, num, body, ...]
    with pymupdf.open(pdf_path) as doc:
        for i in range(1, len(parts) - 1, 2):
            number = int(parts[i])
            if not 1 <= number <= len(doc):
                continue
            try:
                page = doc[number - 1]
                sorted_text = page.get_text("text", sort=True)
                base = sorted_text if sorted_text and sorted_text.strip() else parts[i + 1]
                if base:
                    base = base.replace("\u2212", "-")
                parts[i + 1] = _process_page(page, base)
            except Exception:
                continue
    out = [parts[0]]
    for i in range(1, len(parts) - 1, 2):
        out.append(f"--- Page {parts[i]} ---")
        out.append(parts[i + 1])
    return "".join(out)


def restructure_file(pdf_path: str, md_path: str) -> bool:
    """Rewrite ``md_path`` in place; True if anything changed."""
    path = Path(md_path)
    original = path.read_text(encoding="utf-8")
    updated = restructure_text(pdf_path, original)
    if updated == original:
        return False
    staged = path.with_name(path.name + ".tmp")
    staged.write_text(updated, encoding="utf-8")
    os.replace(staged, path)
    return True
