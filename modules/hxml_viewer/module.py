"""HXML Viewer module — load ``.hxml`` measurement files and plot their curves.

The parsing logic is reused unchanged from the eadtools desktop app; only the UI
moves to the browser. The backend parses uploaded files and returns an aggregated,
plot-ready JSON structure so the frontend just builds a tree and draws with Plotly.
"""

from __future__ import annotations

from typing import List

from fastapi import APIRouter, File, UploadFile

from modules.hxml_viewer.parser import HxmlDocument, parse_hxml_bytes, pick_x_curve
from server.module import PortalModule


def _kind(curve) -> str:
    if curve.is_series:
        return "series"
    if curve.is_scalar:
        return "scalar"
    return "nonnumeric"


def _build_payload(docs: List[HxmlDocument]) -> dict:
    """Aggregate curvedata blocks across all DUTs, preserving first-seen order."""
    block_order: List[str] = []
    block_curves: dict = {}
    seen_curve: dict = {}
    instances: dict = {}
    all_files: List[str] = []

    for doc in docs:
        for ds in doc.datasets:
            has_custom_title = bool(ds.working_title and ds.working_title.lower() != "workingtitle")
            for cd in ds.curve_data:
                if has_custom_title:
                    block_name = ds.working_title
                    dut_file = f"{cd.name}.hxml" if (cd.name and cd.name != block_name) else doc.name
                else:
                    block_name = cd.name
                    dut_file = doc.name

                if dut_file not in all_files:
                    all_files.append(dut_file)

                if block_name not in block_curves:
                    block_order.append(block_name)
                    block_curves[block_name] = []
                    seen_curve[block_name] = set()
                    instances[block_name] = []
                x = pick_x_curve(cd)
                inst = {
                    "file": dut_file,
                    "xName": x.name if x else None,
                    "attributes": cd.attributes,
                    "workingTitle": ds.working_title or "workingTitle",
                    "dataType": doc.data_type or "hiCurve",
                    "dataVersion": doc.data_version or "0.0.0.1",
                    "curves": {},
                }
                for c in cd.curves:
                    kind = _kind(c)
                    if c.name not in seen_curve[block_name]:
                        seen_curve[block_name].add(c.name)
                        block_curves[block_name].append({"name": c.name, "unit": c.unit, "kind": kind})
                    inst["curves"][c.name] = {
                        "unit": c.unit,
                        "kind": kind,
                        "values": c.values if c.is_numeric else [],
                        "raw": c.raw,
                    }
                instances[block_name].append(inst)

    if not all_files:
        all_files = [d.name for d in docs]

    blocks = [
        {
            "name": name,
            "dutCount": len(instances[name]),
            "curves": block_curves[name],
            "instances": instances[name],
        }
        for name in block_order
    ]
    return {"files": all_files, "blocks": blocks}


router = APIRouter()


@router.post("/parse")
async def parse(files: List[UploadFile] = File(...)) -> dict:
    docs: List[HxmlDocument] = []
    errors: List[str] = []
    for f in files:
        try:
            content = await f.read()
            docs.append(parse_hxml_bytes(content, f.filename or "unnamed.hxml"))
        except Exception as exc:  # surface per-file parse errors to the UI
            errors.append(f"{f.filename}: {exc}")
    payload = _build_payload(docs)
    payload["errors"] = errors
    return payload


ICON = (
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    '<path d="M3 3v18h18"/><path d="M7 14l3-4 3 3 4-6"/></svg>'
)

MODULE = PortalModule(
    id="hxml-viewer",
    title="HXML Viewer",
    subtitle="Inspect & plot .hxml measurement curves",
    icon=ICON,
    accent="#0ea5a5",
    order=10,
    router=router,
)
