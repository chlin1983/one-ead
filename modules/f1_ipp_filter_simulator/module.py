"""F1 IPP Filter Simulator module — the IIR filter design pipeline in the browser.

The numpy/scipy compute (``compute.run_pipeline_core``) is reused unchanged from
the desktop app. This backend validates parameters, runs the pipeline, and
serialises the numpy result into JSON the frontend plots with Plotly.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import List, Optional

import numpy as np
from fastapi import APIRouter, File, Request, UploadFile
from pydantic import BaseModel
from scipy.signal import sos2tf

from modules.f1_ipp_filter_simulator import compute
from server.module import PortalModule


class PipelineParams(BaseModel):
    shape: str = "bumpy"
    amp: float = 1.0
    fnorm: int = 1000
    floor_hz: int = 100
    smooth_method: int = 2
    smooth_n: int = 3
    fir_taps: int = 1025
    force_order: int = 0
    tol_db: float = 0.25
    quantize: bool = True
    # Optional real mic-input measurement (drives the pipeline instead of a shape).
    hxml_freq: Optional[List[float]] = None
    hxml_tf: Optional[List[float]] = None


def _f(arr) -> List[float]:
    return [float(x) for x in np.asarray(arr, dtype=float)]


def _cplx(arr) -> List[dict]:
    return [{"re": float(z.real), "im": float(z.imag)} for z in np.asarray(arr)]


def _finite(x):
    return float(x) if (x is not None and math.isfinite(x)) else None


router = APIRouter()


@router.post("/run")
def run(params: PipelineParams) -> dict:
    p = params.model_dump()
    if p.get("hxml_freq") and p.get("hxml_tf"):
        p["hxml_freq"] = np.asarray(p["hxml_freq"], dtype=float)
        p["hxml_tf"] = np.asarray(p["hxml_tf"], dtype=float)
    else:
        p["hxml_freq"] = None
        p["hxml_tf"] = None

    r = compute.run_pipeline_core(p)
    if "error" in r:
        return {"error": r["error"]}

    zeros = np.roots(r["chosen_b"])
    poles = np.roots(r["chosen_a"])
    bq, aq = sos2tf(r["sos_q"])
    zeros_q = np.roots(bq)
    poles_q = np.roots(aq)

    orders = []
    for ordv in (12, 10, 8, 6):
        info = r["order_data"].get(ordv, {})
        if "H_db" not in info:
            orders.append({"order": ordv, "status": "failed"})
        else:
            orders.append({
                "order": ordv,
                "H_db": _f(info["H_db"]),
                "stable": bool(info["stable"]),
                "min_ph": bool(info["min_ph"]),
                "max_dev": _finite(info["max_dev"]),
                "within_tol": bool(info["within_tol"]),
                "selected": bool(info["selected"]),
                "biquads": ordv // 2,
            })

    H_iir = _f(r["H_iir_db"])
    H_q = _f(r["H_q_db"])
    error = [q - i for q, i in zip(H_q, H_iir)]

    return {
        "freq": _f(r["freq"]),
        "freq_eval": _f(r["freq_eval"]),
        "stages": {
            "tf_norm": _f(r["tf_norm"]),
            "tf_inv": _f(r["tf_inv"]),
            "tf_floor": _f(r["tf_floor"]),
            "tf_smooth": _f(r["tf_smooth"]),
        },
        "responses": {
            "H_fir_db": _f(r["H_fir_db"]),
            "H_mp_correct_db": _f(r["H_mp_correct_db"]),
            "H_iir_db": H_iir,
            "H_q_db": H_q,
            "residual": _f(r["residual"]),
            "tf_norm_ev": _f(r["tf_norm_ev"]),
        },
        "beforeAfter": {
            "tf_abs": _f(r["tf_raw_ev_abs"]),
            "level_corrected_db": _f(r["level_corrected_db"]),
            "level_float_db": _f(r["level_float_db"]),
            "is_real_hxml": bool(r["is_real_hxml"]),
        },
        "orders": orders,
        "quant": {"on": bool(r["quantize_on"]), "H_iir_db": H_iir, "H_q_db": H_q, "error": error},
        "pz": {
            "zeros": _cplx(zeros), "poles": _cplx(poles),
            "zeros_q": _cplx(zeros_q), "poles_q": _cplx(poles_q),
        },
        "sos": [[float(v) for v in row] for row in np.asarray(r["sos"])],
        "sos_q": [[float(v) for v in row] for row in np.asarray(r["sos_q"])],
        "chosen_ord": int(r["chosen_ord"]),
        "stable": bool(r["stable"]),
        "min_ph": bool(r["min_ph"]),
        "fnorm": params.fnorm,
    }


@router.post("/run-smoothing-compare")
def run_smoothing_compare(params: PipelineParams) -> dict:
    """Run the pipeline for several smoothing configs so the frontend can overlay them.

    Compares fractional-octave (SmoothSelect=1) at SmoothFactor 1/3/6/12 against
    the 16-band band-combine (SmoothSelect=2).
    """
    base = params.model_dump()
    if base.get("hxml_freq") and base.get("hxml_tf"):
        base["hxml_freq"] = np.asarray(base["hxml_freq"], dtype=float)
        base["hxml_tf"] = np.asarray(base["hxml_tf"], dtype=float)
    else:
        base["hxml_freq"] = None
        base["hxml_tf"] = None

    configs = [
        ("Frac oct 1/1 (SF=1)", 1, 1),
        ("Frac oct 1/3 (SF=3)", 1, 3),
        ("Frac oct 1/6 (SF=6)", 1, 6),
        ("Frac oct 1/9 (SF=9)", 1, 9),
        ("Frac oct 1/12 (SF=12)", 1, 12),
        ("16-band (SS=2)", 2, 3),
    ]

    curves = []
    freq_eval = None
    freq_grid = None
    for label, method, n in configs:
        p = dict(base)
        p["smooth_method"] = method
        p["smooth_n"] = n
        r = compute.run_pipeline_core(p)
        if "error" in r:
            curves.append({"label": label, "smooth_method": method, "smooth_n": n, "error": r["error"]})
            continue
        if freq_eval is None:
            freq_eval = _f(r["freq_eval"])
            freq_grid = _f(r["freq"])
        curves.append({
            "label": label,
            "smooth_method": method,
            "smooth_n": n,
            "chosen_ord": int(r["chosen_ord"]),
            "H_iir_db": _f(r["H_iir_db"]),
            "tf_smooth": _f(r["tf_smooth"]),
        })

    return {"freq_eval": freq_eval or [], "freq": freq_grid or [], "curves": curves}


_DATA_DIR = Path(__file__).resolve().parent / "data"


@router.get("/data-files")
def list_data_files() -> dict:
    """List .hxml files stored in the module's data/ folder."""
    if not _DATA_DIR.is_dir():
        return {"files": []}
    files = sorted([f.name for f in _DATA_DIR.glob("*.hxml")])
    return {"files": files}


@router.post("/load-hxml")
async def load_hxml(request: Request, file: Optional[UploadFile] = None) -> dict:
    """Parse an HA_input_sine HXML upload or data/ file into freq + deviation arrays."""
    content = b""
    fname = ""
    content_type = request.headers.get("content-type", "")

    # 1. Standard multipart file upload if UploadFile is present
    if file is not None:
        try:
            content = await file.read()
            fname = file.filename or ""
        except Exception:
            pass

    # 2. If no content yet and content_type is multipart, attempt request.form()
    if not content and "multipart/form-data" in content_type:
        try:
            form = await request.form()
            form_file = form.get("file")
            if form_file and hasattr(form_file, "read"):
                content = await form_file.read()
                fname = getattr(form_file, "filename", "") or fname
        except Exception:
            pass

    # 3. JSON body (e.g. { "filename": "no_ipp_correction.hxml" } to load from data/)
    if not content and "application/json" in content_type:
        try:
            body = await request.json()
            fname = body.get("filename") or body.get("name") or ""
            if fname and _DATA_DIR.is_dir():
                target = _DATA_DIR / Path(fname).name
                if target.is_file():
                    content = target.read_bytes()
                    fname = target.name
        except Exception:
            pass

    # 4. Query param fallback (?filename=no_ipp_correction.hxml)
    if not content:
        query_fname = request.query_params.get("filename")
        if query_fname and _DATA_DIR.is_dir():
            target = _DATA_DIR / Path(query_fname).name
            if target.is_file():
                content = target.read_bytes()
                fname = target.name

    # 5. Raw XML/bytes body fallback
    if not content:
        raw = await request.body()
        if raw and (b"<hxml" in raw or b"<?xml" in raw):
            content = raw
            fname = request.headers.get("x-filename", fname)

    if not content:
        return {"error": "No HXML content received or file not found in data/."}

    try:
        freq, tf, sn, label = compute.load_hxml_bytes(content)
    except Exception as exc:
        return {"error": str(exc)}

    return {
        "freq": _f(freq),
        "tf": _f(tf),
        "serial": sn,
        "label": label or (fname or "measurement.hxml"),
    }


@router.post("/load-filter-hxml")
async def load_filter_hxml(request: Request, file: Optional[UploadFile] = None) -> dict:
    """Parse a device IIR filter HXML (f + magnitude, e.g. SF3_SS2_*) for overlay."""
    content = b""
    fname = ""
    content_type = request.headers.get("content-type", "")

    if file is not None:
        try:
            content = await file.read()
            fname = file.filename or ""
        except Exception:
            pass

    if not content and "multipart/form-data" in content_type:
        try:
            form = await request.form()
            form_file = form.get("file")
            if form_file and hasattr(form_file, "read"):
                content = await form_file.read()
                fname = getattr(form_file, "filename", "") or fname
        except Exception:
            pass

    if not content:
        raw = await request.body()
        if raw and (b"<hxml" in raw or b"<?xml" in raw):
            content = raw
            fname = request.headers.get("x-filename", fname)

    if not content:
        return {"error": "No HXML content received."}

    try:
        freq, mag, sn, label = compute.load_filter_hxml_bytes(content)
    except Exception as exc:
        return {"error": str(exc)}

    return {
        "freq": _f(freq),
        "mag": _f(mag),
        "serial": sn,
        "label": label or (fname or "filter.hxml"),
    }


# Equalizer/sliders icon - reads as "filter design" at a glance, unlike the previous
# waveform glyph (which was visually identical to Balanced Armature Simulator's icon).
ICON = (
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/>'
    '<line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/>'
    '<line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>'
    '<line x1="1" y1="14" x2="7" y2="14"/>'
    '<line x1="9" y1="8" x2="15" y2="8"/>'
    '<line x1="17" y1="16" x2="23" y2="16"/>'
    '</svg>'
)

MODULE = PortalModule(
    id="f1-ipp-filter-simulator",
    title="F1 IPP Filter Simulator",
    subtitle="IIR filter design pipeline (IPP)",
    icon=ICON,
    accent="#8b5cf6",
    order=40,
    router=router,
)
