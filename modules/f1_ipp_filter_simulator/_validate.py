"""Temporary validation harness: compare the pipeline's designed IIR filter
against the real device measurement (no_ipp -> SF3_SS2 filter FR -> after-IPP)."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from modules.f1_ipp_filter_simulator import compute  # noqa: E402

DATA = Path(__file__).parent / "realmeasurementdata"


def parse_curves(path: Path, names):
    import xml.etree.ElementTree as ET
    root = ET.fromstring(path.read_bytes().lstrip(b"\xef\xbb\xbf"))
    out = {}
    for curve in root.iter("curve"):
        n = curve.get("name", "")
        if n in names and n not in out:
            txt = (curve.text or "").strip().strip("[]")
            out[n] = np.array([float(v) for v in txt.split()])
    return out


def rms(x):
    return float(np.sqrt(np.mean(np.square(x))))


def find(folder: Path, prefix: str):
    for p in folder.glob("*.hxml"):
        if p.name.lower().startswith(prefix):
            return p
    return None


def validate_dut(folder: Path):
    f_no = find(folder, "no_ipp_correction")
    f_filt = find(folder, "sf3_ss2")
    f_after = find(folder, "ipp_filter_correction")
    if not (f_no and f_filt):
        return None

    no_ipp = parse_curves(f_no, {"f", "level"})
    filt = parse_curves(f_filt, {"f", "magnitude"})
    f_in, lvl_in = no_ipp["f"], no_ipp["level"]
    f_filt_hz, mag_filt = filt["f"], filt["magnitude"]

    params = dict(
        shape="bumpy", amp=1.0, fnorm=1000, floor_hz=100,
        smooth_method=2, smooth_n=3, fir_taps=1025, force_order=0,
        tol_db=0.25, quantize=True,
        hxml_freq=np.asarray(f_in, float), hxml_tf=np.asarray(lvl_in, float) - 70.0,
    )
    r = compute.run_pipeline_core(params)
    if "error" in r:
        return {"name": folder.name, "error": r["error"]}

    fe, Hq = r["freq_eval"], r["H_q_db"]
    grid = f_filt_hz[(f_filt_hz >= fe.min()) & (f_filt_hz <= fe.max())]
    ref = np.interp(grid, f_filt_hz, mag_filt)
    sim_q = np.interp(grid, fe, Hq)
    i1k = int(np.argmin(np.abs(grid - 1000)))
    z = lambda a: a - a[i1k]
    dq = z(sim_q) - z(ref)

    res = {"name": folder.name, "order": r["chosen_ord"],
           "filt_rms": rms(dq), "filt_max": float(np.max(np.abs(dq)))}

    if f_after:
        after = parse_curves(f_after, {"f", "level"})
        fa_all, la_all = after["f"], after["level"]
        fa = fa_all[(fa_all >= fe.min()) & (fa_all <= fe.max())]
        lvl_after_i = np.interp(fa, fa_all, la_all)
        pred = np.interp(fa, fe, r["level_corrected_db"])
        j1k = int(np.argmin(np.abs(fa - 1000)))
        zz = lambda a: a - a[j1k]
        da = zz(pred) - zz(lvl_after_i)
        res["after_rms"] = rms(da)
        res["after_max"] = float(np.max(np.abs(da)))
    return res


def main():
    rows = []
    for folder in sorted(DATA.iterdir()):
        if folder.is_dir():
            r = validate_dut(folder)
            if r:
                rows.append(r)

    print(f"{'DUT':<12} {'ord':>3} | {'filtRMS':>7} {'filtMax':>7} | {'aftRMS':>7} {'aftMax':>7}")
    print("-" * 58)
    for r in rows:
        if "error" in r:
            print(f"{r['name']:<12}  ERROR: {r['error']}")
            continue
        ar, am = r.get("after_rms"), r.get("after_max")
        astr = f"{ar:7.3f} {am:7.3f}" if ar is not None else f"{'--':>7} {'--':>7}"
        print(f"{r['name']:<12} {r['order']:>3} | {r['filt_rms']:7.3f} {r['filt_max']:7.3f} | {astr}")

    ok = [r for r in rows if "error" not in r]
    if ok:
        print("-" * 58)
        fr = np.array([r["filt_rms"] for r in ok])
        fm = np.array([r["filt_max"] for r in ok])
        print(f"{'MEAN':<12} {'':>3} | {fr.mean():7.3f} {fm.mean():7.3f}")
        print(f"{'WORST':<12} {'':>3} | {fr.max():7.3f} {fm.max():7.3f}")


if __name__ == "__main__":
    main()
