"""Component Database portal module — FastAPI router and PortalModule contract."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

import pymupdf as fitz
from fastapi import APIRouter, Body, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from server.module import PortalModule

from .config import BASE_DIR, DATASHEETS_VAULT, SCHEMAS_DIR, resolve_pdf_path
from .db import (
    delete_component,
    get_component,
    guess_part_and_manufacturer,
    init_db,
    list_components,
    save_component,
    set_verified,
)
from .parsers import process_datasheet_pdf

router = APIRouter()

# Initialize DB on load
init_db()


@router.get("/schemas")
def get_schemas() -> Dict[str, Any]:
    """Retrieve canonical parameter schemas for all supported component categories."""
    schemas = {}
    for schema_file in SCHEMAS_DIR.glob("*.json"):
        try:
            with open(schema_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                schemas[data.get("category_id", schema_file.stem)] = data
        except Exception as exc:
            print(f"[component_database] Error loading schema {schema_file}: {exc}")
    return schemas


@router.get("/components")
def get_components_list(
    category: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
) -> List[Dict[str, Any]]:
    """List components with optional category filtering and search query."""
    return list_components(category_id=category, query=q)


@router.get("/components/{component_id}")
def get_component_detail(component_id: str) -> Dict[str, Any]:
    """Get single component details and full parametric specs."""
    comp = get_component(component_id)
    if not comp:
        raise HTTPException(status_code=404, detail="Component not found")
    return comp


@router.post("/components")
def save_component_endpoint(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Create a new component or update an existing one — mode must be explicit to avoid accidental duplicates."""
    comp_data = payload.get("component", {})
    specs_data = payload.get("specs", [])
    mode = payload.get("mode", "create")
    if not comp_data or not comp_data.get("part_number"):
        raise HTTPException(status_code=400, detail="Missing part_number in component data")

    if mode == "update":
        target_id = comp_data.get("id")
        if not target_id:
            raise HTTPException(status_code=400, detail="Updating requires an explicit component id")
        if not get_component(target_id):
            raise HTTPException(status_code=404, detail="Component to update was not found")
    else:
        # Creating a new component must never silently overwrite an existing one.
        comp_data = {k: v for k, v in comp_data.items() if k != "id"}

    comp_id = save_component(comp_data, specs_data, mode=mode)
    return {"status": "ok", "id": comp_id, "mode": mode}


@router.delete("/components/{component_id}")
def delete_component_endpoint(component_id: str) -> Dict[str, Any]:
    """Delete a component, its specs, and its underlying datasheet PDF file."""
    result = delete_component(component_id)
    if not result["deleted"]:
        raise HTTPException(status_code=404, detail="Component not found")
    return {"status": "ok", **result}


@router.patch("/components/{component_id}/verified")
def set_verified_endpoint(component_id: str, payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Flip a component's verified flag in place, without touching its specs."""
    verified = bool(payload.get("verified", True))
    if not set_verified(component_id, verified):
        raise HTTPException(status_code=404, detail="Component not found")
    return {"status": "ok", "id": component_id, "verified": verified}


@router.get("/available-datasheets")
def list_available_datasheets() -> List[Dict[str, Any]]:
    """List local PDF datasheets discovered in the module directory."""
    datasheets = []
    # Check category directories (e.g. microphone/, receiver/, telecoil/)
    for cat in ["microphone", "receiver", "telecoil"]:
        cat_dir = BASE_DIR / cat
        if cat_dir.is_dir():
            for pdf_file in cat_dir.glob("*.pdf"):
                datasheets.append({
                    "category": cat,
                    "filename": pdf_file.name,
                    "size_bytes": pdf_file.stat().st_size,
                    "relative_url": f"/api/component_database/datasheet-file/{cat}/{pdf_file.name}"
                })

        # Uploaded files are filed into a per-category vault subfolder
        vault_cat_dir = DATASHEETS_VAULT / cat
        if vault_cat_dir.is_dir():
            for pdf_file in vault_cat_dir.glob("*.pdf"):
                datasheets.append({
                    "category": cat,
                    "filename": pdf_file.name,
                    "size_bytes": pdf_file.stat().st_size,
                    "relative_url": f"/api/component_database/datasheet-file/{cat}/{pdf_file.name}"
                })

    # Legacy flat vault: uploads made before per-category subfolders existed
    if DATASHEETS_VAULT.is_dir():
        for pdf_file in DATASHEETS_VAULT.glob("*.pdf"):
            datasheets.append({
                "category": "vault",
                "filename": pdf_file.name,
                "size_bytes": pdf_file.stat().st_size,
                "relative_url": f"/api/component_database/datasheet-file/vault/{pdf_file.name}"
            })
    return datasheets


def _get_param_aliases(param_key: str, category: str = "microphone") -> List[str]:
    """Retrieve schema labels and aliases for a parameter."""
    schema_file = SCHEMAS_DIR / f"{category}.json"
    if schema_file.exists():
        try:
            with open(schema_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            for g in data.get("groups", []):
                for p in g.get("parameters", []):
                    if p.get("key") == param_key:
                        return [p.get("label")] + p.get("aliases", [])
        except Exception:
            pass
    return []


def highlight_datasheet_pdf(
    pdf_path: Path,
    page_num: int = 1,
    param_key: Optional[str] = None,
    param_label: Optional[str] = None,
    raw_label: Optional[str] = None,
    val: Optional[str] = None,
    min_val: Optional[str] = None,
    max_val: Optional[str] = None,
    category: str = "microphone",
) -> bytes:
    """
    Open PDF using PyMuPDF and apply bright yellow highlights over the target parameter
    and its corresponding numerical value on the requested page.
    """
    import pymupdf as fitz

    doc = fitz.open(str(pdf_path))
    target_idx = max(0, min(page_num - 1, len(doc) - 1))
    page = doc[target_idx]

    special_aliases = {
        "acoustic_port_dim": [
            "Acoustic port dimension",
            "Acoustic port dimension :",
            "Acoustic Port (AP)",
            "Acoustic Port",
            "Port dimension",
            "port dimension",
            "0.35 mm",
            "0.30 mm",
            "0.325",
        ],
        "sensitivity_30hz": ["@30Hz", "@ 30Hz", "@ 30 Hz", "30Hz", "30 Hz", "Sensitivity @ 30 Hz", "Sensitivity @30Hz"],
        "sensitivity_peak": ["Peak", "Sensitivity Peak", "Sensitivity Peak 1 kHz", "Sensitivity Peak 1kHz", "Peak Sensitivity"],
        "sensitivity_100hz": ["Sensitivity @ 100 Hz", "Sensitivity 100 Hz", "Sensitivity @ 100Hz", "Relative Sensitivity 100Hz", "100 Hz"],
        "sensitivity_10k": ["Sensitivity @ 10 kHz", "Sensitivity 10 kHz", "Sensitivity @ 10kHz", "Relative Sensitivity 10kHz", "10 kHz"],
        "sensitivity_1k": ["Sensitivity @ 1 kHz", "Sensitivity 1 kHz", "Sensitivity @ 1kHz", "1 kHz"],
        "resonance_freq": ["Resonance Peak Frequency", "Resonance Frequency", "Peak Frequency", "Frequency"],
        "resonance_amp": ["Resonance Peak Amplitude", "Resonance Peak", "Peak Amplitude", "Amplitude"],
        "startup_time": ["Startup Time @ 94dB SPL", "*Startup Time @ 94dB SPL", "Startup Time", "*Startup Time", "Start-up Time"],
        "startup_peak_current": ["Startup Peak Battery Drain", "*Startup Peak Battery Drain", "Peak Battery Drain", "Ipk"],
        "supply_ramp_time": ["Supply Ramp time", "*Supply Ramp time", "Supply Ramp Time", "Ramp Time"],
        "output_dc_bias": ["Output Load Voltage (VL)", "Output Load Voltage", "Output Load Voltage (V )", "VL", "Output DC Bias"],
        "current_consumption": ["Supply Current (Drain)", "Current Consumption (Drain)", "Supply Current", "Current Consumption", "Current Drain"],
        "weight": ["*Weight", "Weight", "Mass"],
        "operating_temp": ["*Operating Temperature", "Operating Temperature", "Operating Temp"],
        "psrr": ["Power Supply Rejection Ratio (PSRR)", "Power Supply Rejection", "PSRR", "Power supply rejection"],
        "snr": ["Signal to Noise Ratio (SNR)", "Signal to Noise Ratio, A-Weighted", "Signal to Noise Ratio", "SNR", "SNR, A-Weighted", "Signal-to-Noise Ratio"],
        "ein": ["Input-Referred Noise, A-Weighted", "Equivalent Input Noise (EIN)", "Equivalent Input Noise", "EIN", "Self-Noise"],
        "thd_point": ["Input SPL amplitude @ distortion", "Input SPL @ Distortion", "THD 5% Point", "Distortion Limit"],
        "input_referred_emi_0_7_0_96_ghz": ["0.70-0.96 GHz", "0.7-0.96 GHz", "0.70-0.96", "0.7-0.96", "0.70 - 0.96", "0.7 - 0.96", "0.70", "0.7"],
        "input_referred_emi_1_4_2_0_ghz": ["1.4-2.0 GHz", "1.4-2.0", "1.4 - 2.0 GHz", "1.4 - 2.0"],
        "input_referred_emi_2_0_2_7_ghz": ["2.0-2.7 GHz", "2.0-2.7", "2.0 - 2.7 GHz", "2.0 - 2.7"],
        "input_referred_noise_1_3rd_octave_100_hz": ["Input-Referred Noise, 1/3rd Octave 100 Hz", "100 Hz", "@100 Hz", "100Hz"],
        "input_referred_noise_1_3rd_octave_1_khz": ["Input-Referred Noise, 1/3rd Octave 1 kHz", "1 kHz", "@1 kHz", "1kHz"],
        "input_referred_noise_1_3rd_octave_10_khz": ["Input-Referred Noise, 1/3rd Octave 10 kHz", "10 kHz", "@10 kHz", "10kHz"],
        "input_referred_vibration_1_khz_open_port": ["Input Referred Vibration", "Input Referred Vibration (Open Port)", "Open Port", "open port"],
        "input_referred_vibration_1_khz_blocked_port": ["Input Referred Vibration", "Input Referred Vibration (Blocked Port)", "Blocked Port", "blocked port"],
        "input_referred_vibration": ["Input Referred Vibration"],
    }

    # 1. Tier 1 Candidates: Direct from raw_label (the actual text in the table row clicked)
    tier1_candidates: List[str] = []
    if raw_label:
        s = raw_label
        split_fixes = [
            ("ti me", "time"), ("Ti me", "Time"),
            ("Dr ain", "Drain"), ("dr ain", "drain"),
            ("Fre quency", "Frequency"), ("fre quency", "frequency"),
            ("Am plitude", "Amplitude"), ("am plitude", "amplitude"),
            ("Im pedance", "Impedance"), ("im pedance", "impedance"),
            ("Sen sitivity", "Sensitivity"), ("sen sitivity", "sensitivity"),
            ("Tem perature", "Temperature"), ("tem perature", "temperature"),
            ("Speci fications", "Specifications"), ("speci fications", "specifications"),
            ("Thres hold", "Threshold"), ("thres hold", "threshold"),
            ("Volt age", "Voltage"), ("volt age", "voltage"),
        ]
        for a, b in split_fixes:
            s = s.replace(a, b)

        # Detect specific frequency ranges (e.g. 0.70-0.96 GHz, 1.4-2.0 GHz, 2.0-2.7 GHz)
        m_band = re.search(r"\b(\d+\.?\d*[-–]\d+\.?\d*(?:\s*g?hz)?)\b", s, re.IGNORECASE)
        if m_band:
            band_str = m_band.group(1).strip()
            tier1_candidates.append(band_str)
            tier1_candidates.append(re.sub(r"\s*g?hz\b", "", band_str, flags=re.IGNORECASE).strip())

        base = s.split(" - ")[0].split(" (")[0].split(" [")[0].strip()
        tier1_candidates.append(base)
        unstarred = base.lstrip("*•- ").strip()
        if unstarred:
            tier1_candidates.append(unstarred)

        words = base.split()
        if len(words) > 1 and words[-1].lower() in ("tr", "toff", "tld", "vt", "ipk", "tpw", "vl", "idd", "zout", "fs"):
            shorter = " ".join(words[:-1])
            tier1_candidates.append(shorter)
            tier1_candidates.append(shorter.lstrip("*•- ").strip())

    tier1_candidates = sorted(list(dict.fromkeys(tier1_candidates)), key=lambda x: len(x), reverse=True)

    # 2. Tier 2 Candidates: Canonical label and general aliases
    tier2_candidates: List[str] = []
    if param_label:
        tier2_candidates.append(param_label)
        tier2_candidates.append(param_label.lstrip("*•- ").strip())
        if "@" in param_label:
            tier2_candidates.append(param_label.replace("@", "").replace("  ", " ").strip())
    if param_key:
        tier2_candidates.extend(special_aliases.get(param_key, []))
        tier2_candidates.extend(_get_param_aliases(param_key, category))

    tier2_candidates = sorted(list(dict.fromkeys(tier2_candidates)), key=lambda x: len(x), reverse=True)

    words = page.get_text("words")
    if not words:
        empty_bytes = doc.tobytes()
        doc.close()
        return empty_bytes, {"has_highlight": False, "ratio": 0.0, "y": 0.0, "page_height": 792.0}

    # Group words into horizontal rows
    rows_by_y = []
    sorted_words = sorted(words, key=lambda w: ((w[1] + w[3]) / 2, w[0]))
    for w in sorted_words:
        y_mid = (w[1] + w[3]) / 2
        found_row = None
        for r in rows_by_y:
            if abs(r["y_mid"] - y_mid) < 6:
                found_row = r
                break
        if found_row is not None:
            found_row["words"].append(w)
            found_row["y_mid"] = sum((x[1] + x[3]) / 2 for x in found_row["words"]) / len(found_row["words"])
        else:
            rows_by_y.append({"y_mid": y_mid, "words": [w]})

    # Collect numeric target values (clicked val first, then min, then max)
    target_numbers = []
    for candidate, prio in [(val, "val"), (min_val, "min"), (max_val, "max")]:
        if candidate is not None:
            c_str = str(candidate).strip()
            if c_str and c_str not in ("-", "--", "TBD", "N/A", "None", "n/a"):
                num_m = re.search(r"[-+]?\d*\.?\d+", c_str)
                if num_m:
                    try:
                        target_numbers.append((float(num_m.group(0)), c_str, prio))
                    except Exception:
                        pass

    # String target keywords if non-numeric (e.g. Polarity, Directivity)
    val_text_tokens = set()
    if val and any(c.isalpha() for c in str(val)):
        val_text_tokens = {w.lower() for w in re.findall(r"[a-z0-9]+", str(val)) if len(w) > 3}

    key_constraints = {
        "sensitivity_1k": ({"1", "1k", "1khz"}, {"100", "100hz", "10", "10khz", "30", "30hz", "peak"}),
        "sensitivity_100hz": ({"100", "100hz"}, {"1", "1k", "1khz", "10", "10khz", "30", "30hz", "peak"}),
        "sensitivity_10k": ({"10", "10khz"}, {"100", "100hz", "1", "1k", "1khz", "30", "30hz", "peak"}),
        "sensitivity_30hz": ({"30", "30hz"}, {"100", "100hz", "1", "1k", "1khz", "10", "10khz", "peak"}),
        "sensitivity_peak": ({"peak"}, {"100", "100hz", "1", "1k", "1khz", "10", "10khz", "30", "30hz"}),
        "resonance_amp": ({"amplitude", "amp"}, {"frequency", "freq"}),
        "resonance_freq": ({"frequency", "freq"}, {"amplitude", "amp"}),
        "storage_temp": ({"storage"}, {"operating"}),
        "operating_temp": ({"operating"}, {"storage"}),
        "input_referred_noise_1_3rd_octave_100_hz": ({"100", "100hz"}, {"1", "1k", "1khz", "10", "10khz"}),
        "input_referred_noise_1_3rd_octave_1_khz": ({"1", "1k", "1khz"}, {"100", "100hz", "10", "10khz"}),
        "input_referred_noise_1_3rd_octave_10_khz": ({"10", "10khz"}, {"100", "100hz", "1", "1k", "1khz"}),
    }

    req_kw, forb_kw = key_constraints.get(param_key or "", (set(), set()))
    lbl_lower = f"{param_label or ''} {raw_label or ''}".lower()
    if "open" in lbl_lower and "port" in lbl_lower:
        req_kw = req_kw | {"open"}
        forb_kw = forb_kw | {"blocked"}
    elif "blocked" in lbl_lower and "port" in lbl_lower:
        req_kw = req_kw | {"blocked"}
        forb_kw = forb_kw | {"open"}

    raw_query = f"{raw_label or ''} {param_label or ''} {param_key or ''}".lower()
    raw_query = raw_query.replace("*", " ").replace("@", " ").replace("_", " ").replace("-", " ")
    stop_words = {"specifications", "spec", "parameter", "min", "nom", "max", "typ", "typical", "the", "and", "or", "to", "re", "at", "db", "hz", "khz"}
    q_tokens = [w for w in re.findall(r"[a-z0-9]+", raw_query) if len(w) > 1 and w not in stop_words and w not in forb_kw]

    best_score = -9999
    best_row = None
    best_val_w = None
    best_val_words = []

    is_page1 = bool(page.number == 0)
    lbl_x_thresh = 450 if is_page1 else 210

    for r in rows_by_y:
        y_mid = r["y_mid"]
        if y_mid < 80:  # Skip page headers
            continue

        r_words = sorted(r["words"], key=lambda w: w[0])
        val_w = [w for w in r_words if (w[0] >= 440 if is_page1 else 200 <= w[0] <= 380)]

        # Label words on this row
        row_lbl_w = [w for w in r_words if w[0] < lbl_x_thresh and w[4].strip() not in ("-", "--", "*", "•")]
        # Also check adjacent label words (within +/- 17 pt) for multi-line headers / shared labels
        adj_lbl_w = [
            w for w in words
            if (w[0] < (450 if is_page1 else 210) and (w[0] >= 300 if is_page1 and "port" in raw_query else True))
            and abs((w[1] + w[3]) / 2 - y_mid) <= 17 and w[4].strip() not in ("-", "--", "*", "•")
        ]

        row_tokens = set(re.findall(r"[a-z0-9]+", " ".join(w[4].lower() for w in row_lbl_w)))
        cond_tokens = set(re.findall(r"[a-z0-9]+", " ".join(w[4].lower() for w in r_words if w[0] >= 380)))
        adj_tokens = set(re.findall(r"[a-z0-9]+", " ".join(w[4].lower() for w in adj_lbl_w)))

        score = 0
        matched_val = None
        matched_val_words = []

        # 1. Target Value Match
        if target_numbers:
            row_has_target = False
            for target_f, target_s, prio in target_numbers:
                for w in val_w:
                    num_m = re.search(r"[-+]?\d*\.?\d+", w[4])
                    if num_m:
                        try:
                            if abs(float(num_m.group(0)) - target_f) < 1e-4:
                                bonus = 90 if prio == "val" else 70
                                score += bonus
                                row_has_target = True
                                if matched_val is None or prio == "val":
                                    matched_val = w
                                break
                        except Exception:
                            pass
                if row_has_target and prio == "val":
                    break
            if not row_has_target:
                score -= 35

        # 1b. Text target match (for non-numerics like Polarity, Directivity)
        if val_text_tokens:
            for w in val_w:
                w_clean = re.sub(r"[^a-z0-9]", "", w[4].lower())
                if w_clean in val_text_tokens:
                    score += 50
                    matched_val_words.append(w)
            if matched_val_words:
                matched_val = matched_val_words[0]

        # 2. Key constraints: row label or condition can satisfy required frequency
        if req_kw:
            if any(k in row_tokens for k in req_kw) or any(k in cond_tokens for k in req_kw) or any(k in adj_tokens for k in req_kw):
                score += 60
            else:
                score -= 50
        if forb_kw:
            # Only penalize if forbidden keywords appear in the LABEL column (unless open/blocked port)
            if any(k in row_tokens for k in forb_kw):
                score -= 120
            elif any(k in ("open", "blocked") for k in forb_kw) and any(k in cond_tokens for k in forb_kw):
                score -= 120

        # 3. Label token overlap
        for q in q_tokens:
            if q in row_tokens:
                score += 20
            elif q in adj_tokens:
                score += 10

        if score > best_score:
            best_score = score
            best_row = r
            best_val_w = matched_val
            best_val_words = matched_val_words

    lbl_rect = None
    val_rect = None

    if best_row:
        y_mid = best_row["y_mid"]

        # Dynamically determine where measurement/value columns start on this row
        # (first numeric value, dash, or table placeholder at x >= 180)
        val_col_words = [
            w for w in best_row["words"]
            if w[0] >= 180 and (re.match(r"^[-+]?\d*\.?\d+$", w[4].strip()) or w[4].strip() in ("-", "--", "TBD", "N/A"))
        ]
        first_val_col_x = min(w[0] for w in val_col_words) if val_col_words else (450 if is_page1 else 190)

        # Label rect: prefer label words on this row if present; strictly to the left of value columns
        chosen_lbl_w = [
            w for w in best_row["words"]
            if w[0] < first_val_col_x - 1 and w[4].strip() not in ("-", "--", "*", "•")
        ]
        if not chosen_lbl_w:
            nearby_w = [
                w for w in words
                if (w[0] < (450 if is_page1 else 185) and (w[0] >= 300 if is_page1 and "port" in raw_query else True))
                and abs((w[1] + w[3]) / 2 - y_mid) <= 22 and w[4].strip() not in ("-", "--", "*", "•")
                and not re.match(r"^[-+]?\d*\.?\d+$", w[4].strip())
            ]
            matching_w = [w for w in nearby_w if re.sub(r"[^a-z0-9]", "", w[4].lower()) in q_tokens]
            if matching_w:
                target_line_y = sum((w[1] + w[3]) / 2 for w in matching_w) / len(matching_w)
                chosen_lbl_w = [w for w in nearby_w if abs((w[1] + w[3]) / 2 - target_line_y) <= 8]
            elif nearby_w:
                closest_w = min(nearby_w, key=lambda w: abs((w[1] + w[3]) / 2 - y_mid))
                line_y = (closest_w[1] + closest_w[3]) / 2
                chosen_lbl_w = [w for w in nearby_w if abs((w[1] + w[3]) / 2 - line_y) <= 8]

        if chosen_lbl_w:
            lbl_rect = fitz.Rect(
                min(w[0] for w in chosen_lbl_w) - 2,
                min(w[1] for w in chosen_lbl_w) - 1,
                max(w[2] for w in chosen_lbl_w) + 2,
                max(w[3] for w in chosen_lbl_w) + 1,
            )

        if best_val_words:
            val_rect = fitz.Rect(
                min(w[0] for w in best_val_words) - 2,
                min(w[1] for w in best_val_words) - 1,
                max(w[2] for w in best_val_words) + 2,
                max(w[3] for w in best_val_words) + 1,
            )
        elif best_val_w:
            val_rect = fitz.Rect(best_val_w[0] - 2, best_val_w[1] - 1, best_val_w[2] + 2, best_val_w[3] + 1)
        else:
            # Fallback: highlight value column on this row
            r_val_w = [w for w in best_row["words"] if (w[0] >= 440 if is_page1 else 200 <= w[0] <= 370) and w[4].strip() not in ("-", "--")]
            if r_val_w:
                val_rect = fitz.Rect(
                    min(w[0] for w in r_val_w) - 2,
                    min(w[1] for w in r_val_w) - 1,
                    max(w[2] for w in r_val_w) + 2,
                    max(w[3] for w in r_val_w) + 1,
                )

    if lbl_rect:
        annot1 = page.add_highlight_annot(lbl_rect)
        annot1.set_colors(stroke=(1.0, 0.90, 0.0))
        annot1.set_opacity(0.42)
        annot1.update()

    if val_rect:
        annot2 = page.add_highlight_annot(val_rect)
        annot2.set_colors(stroke=(1.0, 0.90, 0.0))
        annot2.set_opacity(0.48)
        annot2.update()

    # Calculate exact vertical midpoint for scroll targeting
    highlight_y = 0.0
    if val_rect and lbl_rect:
        highlight_y = (val_rect.y0 + val_rect.y1 + lbl_rect.y0 + lbl_rect.y1) / 4
    elif val_rect:
        highlight_y = (val_rect.y0 + val_rect.y1) / 2
    elif lbl_rect:
        highlight_y = (lbl_rect.y0 + lbl_rect.y1) / 2

    page_h = float(page.rect.height or 792.0)
    hl_info = {
        "has_highlight": bool(lbl_rect or val_rect),
        "y": float(highlight_y),
        "page_height": page_h,
        "ratio": float(highlight_y / page_h) if page_h > 0 else 0.0,
    }

    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes, hl_info


@router.get("/datasheet-file/{category}/{filename}")
def serve_datasheet_file(
    category: str,
    filename: str,
    param: Optional[str] = Query(None),
    label: Optional[str] = Query(None),
    raw: Optional[str] = Query(None),
    val: Optional[str] = Query(None),
    min_val: Optional[str] = Query(None, alias="min"),
    max_val: Optional[str] = Query(None, alias="max"),
    page: Optional[int] = Query(None),
):
    """Serve a local datasheet PDF for inline browser viewing with optional yellow parameter highlighting."""
    from fastapi.responses import Response

    target = resolve_pdf_path(category, filename)

    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="Datasheet file not found")

    param_s = param if isinstance(param, str) and param else None
    label_s = label if isinstance(label, str) and label else None
    raw_s = raw if isinstance(raw, str) and raw else None
    val_s = val if isinstance(val, str) and val else None
    min_s = min_val if isinstance(min_val, str) and min_val else None
    max_s = max_val if isinstance(max_val, str) and max_val else None
    page_i = page if isinstance(page, int) else 1

    if param_s or label_s or raw_s or val_s or min_s or max_s:
        try:
            pdf_bytes, hl_info = highlight_datasheet_pdf(
                target,
                page_num=page_i,
                param_key=param_s,
                param_label=label_s,
                raw_label=raw_s,
                val=val_s,
                min_val=min_s,
                max_val=max_s,
                category=category,
            )
            return Response(
                content=pdf_bytes,
                media_type="application/pdf",
                headers={
                    "Content-Disposition": f'inline; filename="{filename}"',
                    "X-Highlight-Ratio": str(round(hl_info.get("ratio", 0.0), 4)),
                    "X-Highlight-Y": str(round(hl_info.get("y", 0.0), 1)),
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                },
            )
        except Exception as exc:
            print(f"[serve_datasheet_file] Highlighting error: {exc}")

    return FileResponse(
        str(target),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.get("/datasheet-page/{category}/{filename}")
def serve_datasheet_page_svg(
    category: str,
    filename: str,
    page: int = Query(1),
    highlight_page: Optional[int] = Query(None),
    param: Optional[str] = Query(None),
    label: Optional[str] = Query(None),
    raw: Optional[str] = Query(None),
    val: Optional[str] = Query(None),
    min_val: Optional[str] = Query(None, alias="min"),
    max_val: Optional[str] = Query(None, alias="max"),
):
    """Serve a single datasheet page as high-definition vector SVG with translucent yellow highlighting."""
    from fastapi.responses import Response

    target = resolve_pdf_path(category, filename)

    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="Datasheet file not found")

    param_s = param if isinstance(param, str) and param else None
    label_s = label if isinstance(label, str) and label else None
    raw_s = raw if isinstance(raw, str) and raw else None
    val_s = val if isinstance(val, str) and val else None
    min_s = min_val if isinstance(min_val, str) and min_val else None
    max_s = max_val if isinstance(max_val, str) and max_val else None
    page_i = page if isinstance(page, int) else 1
    hl_page_i = highlight_page if isinstance(highlight_page, int) else None

    hl_info = {"has_highlight": False, "ratio": 0.0, "y": 0.0, "page_height": 792.0}
    try:
        should_highlight = bool(param_s or label_s or raw_s or val_s or min_s or max_s) and (
            hl_page_i is None or hl_page_i == page_i
        )
        if should_highlight:
            pdf_bytes, hl_info = highlight_datasheet_pdf(
                target,
                page_num=page_i,
                param_key=param_s,
                param_label=label_s,
                raw_label=raw_s,
                val=val_s,
                min_val=min_s,
                max_val=max_s,
                category=category,
            )
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        else:
            doc = fitz.open(str(target))
    except Exception as exc:
        print(f"[serve_datasheet_page_svg] Highlighting fallback: {exc}")
        doc = fitz.open(str(target))

    total_pages = len(doc)
    target_idx = max(0, min(page_i - 1, total_pages - 1))
    try:
        p = doc[target_idx]
        svg_str = p.get_svg_image()
    finally:
        doc.close()

    # Scope all SVG IDs, clipPaths, masks, and href references with page-specific prefix
    # to prevent ID collision across pages when multiple pages exist simultaneously in DOM.
    import re
    page_prefix = f"pg{target_idx + 1}_"
    svg_str = re.sub(r'\bid="([^"]+)"', rf'id="{page_prefix}\1"', svg_str)
    svg_str = re.sub(r'url\(#([^)]+)\)', rf'url(#{page_prefix}\1)', svg_str)
    svg_str = re.sub(r"url\('#([^']+)'\)", rf"url('#{page_prefix}\1')", svg_str)
    svg_str = re.sub(r'url\("#([^"]+)"\)', rf'url("#{page_prefix}\1")', svg_str)
    svg_str = re.sub(r'href="#([^"]+)"', rf'href="#{page_prefix}\1"', svg_str)

    # Embed data-highlight-ratio attribute onto the root <svg> tag for precise scroll auto-centering
    if hl_info.get("has_highlight"):
        ratio_str = str(round(hl_info["ratio"], 4))
        y_str = str(round(hl_info["y"], 1))
        svg_str = re.sub(r'<svg\b', f'<svg data-highlight-ratio="{ratio_str}" data-highlight-y="{y_str}"', svg_str, count=1)

    return Response(
        content=svg_str,
        media_type="image/svg+xml",
        headers={
            "X-Total-Pages": str(total_pages),
            "X-Current-Page": str(target_idx + 1),
            "X-Highlight-Ratio": str(round(hl_info.get("ratio", 0.0), 4)),
            "X-Highlight-Y": str(round(hl_info.get("y", 0.0), 1)),
            "X-Page-Height": str(round(hl_info.get("page_height", 792.0), 1)),
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    )


@router.post("/parse-datasheet")
def parse_datasheet_endpoint(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """
    Run the pdfplumber extraction engine on a chosen datasheet.
    Returns parsed staging specifications for split-screen review.
    """
    category = payload.get("category", "microphone")
    filename = payload.get("filename", "")

    pdf_path = resolve_pdf_path(category, filename)

    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail=f"Datasheet not found: {filename}")

    staged_items = process_datasheet_pdf(pdf_path, category)
    return {
        "filename": filename,
        "category": category,
        "total_extracted": len(staged_items),
        "items": staged_items
    }


@router.post("/upload-datasheet")
async def upload_datasheet_endpoint(
    category: str = Query("microphone"),
    file: UploadFile = File(...)
) -> Dict[str, Any]:
    """Upload a new datasheet PDF, extract its specs, and auto-create its catalog entry."""
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    vault_category_dir = DATASHEETS_VAULT / category
    vault_category_dir.mkdir(parents=True, exist_ok=True)
    save_path = vault_category_dir / file.filename
    content = await file.read()
    with open(save_path, "wb") as f:
        f.write(content)

    staged_items = process_datasheet_pdf(save_path, category)

    part_number, manufacturer = guess_part_and_manufacturer(file.filename)
    comp_data = {
        "part_number": part_number,
        "manufacturer": manufacturer,
        "category_id": category,
        "package_type": "",
        "description": f"Auto-extracted from uploaded datasheet {file.filename}",
        "datasheet_filename": file.filename,
        "datasheet_category": category,
        "verified": False,
        "tags": "Auto-Discovered,PDF",
    }
    comp_id = save_component(comp_data, staged_items, mode="create")

    return {
        "filename": file.filename,
        "category": category,
        "total_extracted": len(staged_items),
        "items": staged_items,
        "component_id": comp_id,
        "part_number": part_number,
        "manufacturer": manufacturer,
    }


# Professional microchip / database icon for sidebar
ICON = (
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    '<ellipse cx="12" cy="5" rx="9" ry="3"/>'
    '<path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>'
    '<path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>'
    '</svg>'
)

MODULE = PortalModule(
    id="component_database",
    title="Component Database",
    subtitle="Datasheet management, extraction & comparison",
    icon=ICON,
    accent="#0ea5e9",
    order=45,
    router=router,
)
