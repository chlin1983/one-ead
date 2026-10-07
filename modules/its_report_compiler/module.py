"""ITS Report Compiler module — import ITS PDF reports and compare parameters.

Reuses the desktop PDF parser unchanged. The backend parses uploaded PDFs and
returns rows (one per report/DUT) plus the ordered union of parameter keys, so
the frontend can render a comparison table with a checkbox column selector.
"""

from __future__ import annotations

from typing import List

from fastapi import APIRouter, File, UploadFile

from modules.its_report_compiler.pdf_parser import ParsedReport, parse_pdf_bytes
from server.module import PortalModule


def _column_keys(report: ParsedReport):
    """Yield (key, name, step) per parameter, keyed by name so the same parameter
    consolidates across reports even when its step number differs. A name that
    repeats within one report is disambiguated by occurrence index."""
    occ: dict = {}
    for (step, name), v in report.parameters.items():
        n = occ.get(name, 0) + 1
        occ[name] = n
        key = name if n == 1 else f"{name} ({n})"
        display = name if n == 1 else f"{name} ({n})"
        yield key, display, step, v


def _build_payload(reports: List[ParsedReport]) -> dict:
    param_order: List[str] = []
    meta: dict = {}
    has_value: set = set()
    for r in reports:
        for key, display, step, v in _column_keys(r):
            if key not in meta:
                meta[key] = {"name": display, "step": step}
                param_order.append(key)
            measured = v.get("Measured", "")
            if measured is not None and str(measured).strip() != "":
                has_value.add(key)

    # Drop parameters that have no measured value in any report.
    param_order = [key for key in param_order if key in has_value]

    rows = []
    for r in reports:
        params = {}
        for key, display, step, v in _column_keys(r):
            params[key] = {
                "measured": v.get("Measured", ""),
                "result": v.get("Result", ""),
                "nominal": v.get("Nominal", ""),
                "upper": v.get("UpperLimit", ""),
                "lower": v.get("LowerLimit", ""),
            }
        rows.append({
            "file": r.file_name,
            "serial": r.metadata.get("SerialNo", r.file_name),
            "result": r.overall_result,
            "startTime": r.metadata.get("StartTime", ""),
            "model": r.metadata.get("Model", ""),
            "error": r.error or "",
            "params": params,
        })

    param_keys = [{"key": key, "step": meta[key]["step"], "name": meta[key]["name"]} for key in param_order]
    return {"rows": rows, "paramKeys": param_keys}


router = APIRouter()


@router.post("/parse")
async def parse(files: List[UploadFile] = File(...)) -> dict:
    reports: List[ParsedReport] = []
    for f in files:
        content = await f.read()
        reports.append(parse_pdf_bytes(content, f.filename or "report.pdf"))
    return _build_payload(reports)


ICON = (
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    '<path d="M9 17V7h4a2.5 2.5 0 0 1 0 5H9m3 0 4 5"/><rect x="3" y="3" width="18" height="18" rx="2"/></svg>'
)

MODULE = PortalModule(
    id="its-report-compiler",
    title="ITS Report Compiler",
    subtitle="Compare parameters across ITS PDF reports",
    icon=ICON,
    accent="#f59e0b",
    order=30,
    router=router,
)
