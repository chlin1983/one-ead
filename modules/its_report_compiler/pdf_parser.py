"""PDF parsing for ITS test reports (reused from the report-compiler desktop app).

Each report has a two-column layout: chart images / run info on the left, and a
"No / TestParameter / Measured / Nominal / UpperLimit / LowerLimit / Result"
table on the right. Plain-text extraction interleaves both columns, so we locate
the table by the x-position of its header words and rebuild rows from word
coordinates instead.
"""

from __future__ import annotations

import os
import re
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import pdfplumber

TABLE_COLUMNS = ["No", "TestParameter", "Measured", "Nominal", "UpperLimit", "LowerLimit", "Result"]

METADATA_FIELDS = {
    "Model": r"Model:\s*(\S+)",
    "PartNo": r"PartNo:\s*(\S+)",
    "LotNo": r"LotNo:\s*(\S+)",
    "StripID": r"StripID:\s*(\S+)",
    "SerialNo": r"SerialNo\.:\s*(\S+)",
    "KitSerialNo": r"KitSerialNo\.:\s*(\S+)",
    "StartTime": r"StartTime:\s*(\S+)",
    "Duration_s": r"Duration\[s\]:\s*(\S+)",
    "Tester": r"Tester\[GID\]:\s*(\S+)",
    "Station": r"Station:\s*(\S+)",
    "WorkOrder": r"WorkOrder:\s*(\S+)",
    "UDN": r"UDN:\s*(\S+)",
    "TestPlan": r"TestPlan:\s*(\S+)",
}


@dataclass
class ParsedReport:
    file_path: str
    file_name: str
    metadata: Dict[str, str] = field(default_factory=dict)
    overall_result: str = ""
    parameters: "OrderedDict[tuple, dict]" = field(default_factory=OrderedDict)
    error: Optional[str] = None


def _cluster_rows(words: List[dict], tol: float = 3.0) -> List[dict]:
    rows: List[dict] = []
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        for row in rows:
            if abs(row["top"] - w["top"]) <= tol:
                row["words"].append(w)
                row["top"] = (row["top"] + w["top"]) / 2
                break
        else:
            rows.append({"top": w["top"], "words": [w]})
    rows.sort(key=lambda r: r["top"])
    return rows


def _find_table_bounds(words: List[dict]):
    header_words = {}
    for w in words:
        if w["text"] in TABLE_COLUMNS and w["text"] not in header_words:
            header_words[w["text"]] = w
    if not {"No", "TestParameter", "Result"} <= header_words.keys():
        return None

    cols = sorted(((name, header_words[name]["x0"]) for name in header_words), key=lambda c: c[1])
    boundaries = []
    for i, (name, x0) in enumerate(cols):
        left = x0 - 3 if i == 0 else (cols[i - 1][1] + x0) / 2
        boundaries.append((name, left))
    header_top = header_words["No"]["top"]
    return boundaries, header_top


def _assign_column(x0: float, boundaries: List[tuple]) -> str:
    col = boundaries[0][0]
    for name, left in boundaries:
        if x0 >= left:
            col = name
        else:
            break
    return col


def _parse_table(pdf: "pdfplumber.PDF") -> "OrderedDict[tuple, dict]":
    parameters: "OrderedDict[tuple, dict]" = OrderedDict()
    last_key = None

    for page in pdf.pages:
        words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
        bounds = _find_table_bounds(words)
        if not bounds:
            continue
        boundaries, header_top = bounds
        table_left = boundaries[0][1]

        table_words = [w for w in words if w["x0"] >= table_left and w["top"] > header_top + 9]
        for row in _cluster_rows(table_words):
            cells: Dict[str, List[str]] = {}
            for w in sorted(row["words"], key=lambda w: w["x0"]):
                col = _assign_column(w["x0"], boundaries)
                cells.setdefault(col, []).append(w["text"])
            cells = {k: " ".join(v) for k, v in cells.items()}

            no_text = cells.get("No", "")
            if re.fullmatch(r"\d+", no_text):
                key = (int(no_text), cells.get("TestParameter", ""))
                parameters[key] = {
                    "Measured": cells.get("Measured", ""),
                    "Nominal": cells.get("Nominal", ""),
                    "UpperLimit": cells.get("UpperLimit", ""),
                    "LowerLimit": cells.get("LowerLimit", ""),
                    "Result": cells.get("Result", ""),
                }
                last_key = key
            elif last_key is not None:
                prev = parameters[last_key]
                no, name = last_key
                if cells.get("TestParameter"):
                    name = name + cells["TestParameter"]
                    del parameters[last_key]
                    last_key = (no, name)
                    parameters[last_key] = prev
                for col in ("Measured", "Nominal", "UpperLimit", "LowerLimit", "Result"):
                    if cells.get(col):
                        prev[col] = prev.get(col, "") + cells[col]

    return parameters


def _parse_metadata(full_text: str) -> Dict[str, str]:
    metadata = {}
    for label, pattern in METADATA_FIELDS.items():
        m = re.search(pattern, full_text)
        if m:
            metadata[label] = m.group(1)

    lines = full_text.splitlines()
    for i, line in enumerate(lines):
        if line.strip() == "AdminMode" and i + 1 < len(lines):
            candidate = lines[i + 1].strip()
            if candidate in ("Pass", "Fail", "Warning"):
                metadata["OverallResult"] = candidate
            break
    return metadata


def parse_pdf(file_path: str) -> ParsedReport:
    report = ParsedReport(file_path=file_path, file_name=os.path.basename(file_path))
    try:
        with pdfplumber.open(file_path) as pdf:
            full_text = "\n".join(page.extract_text() or "" for page in pdf.pages)
            report.metadata = _parse_metadata(full_text)
            report.overall_result = report.metadata.pop("OverallResult", "")
            report.parameters = _parse_table(pdf)
    except Exception as exc:  # surface parse errors in the UI instead of crashing
        report.error = str(exc)
    return report


def parse_pdf_bytes(data: bytes, name: str) -> ParsedReport:
    """Parse an ITS report from raw bytes (as uploaded to the portal)."""
    import io

    report = ParsedReport(file_path=name, file_name=name)
    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            full_text = "\n".join(page.extract_text() or "" for page in pdf.pages)
            report.metadata = _parse_metadata(full_text)
            report.overall_result = report.metadata.pop("OverallResult", "")
            report.parameters = _parse_table(pdf)
    except Exception as exc:
        report.error = str(exc)
    return report
