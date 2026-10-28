"""pdfplumber table extractor and geometry parser for component datasheets."""

import re
from pathlib import Path
from typing import List, Dict, Any, Optional
import pdfplumber

from .alias_matcher import match_parameter_alias
from .unit_normalizer import clean_text, normalize_value, parse_numeric


def extract_pdf_tables(pdf_path: Path, max_pages: int = 5) -> List[Dict[str, Any]]:
    """Extract raw tables from PDF pages with page numbers."""
    extracted = []
    if not pdf_path.exists():
        return extracted

    try:
        with pdfplumber.open(pdf_path) as pdf:
            total_pages = min(len(pdf.pages), max_pages)
            for page_idx in range(total_pages):
                page = pdf.pages[page_idx]
                page_num = page_idx + 1
                tables = page.extract_tables()
                for table_idx, table in enumerate(tables):
                    if not table or len(table) < 2:
                        continue
                    extracted.append({
                        "page_num": page_num,
                        "table_idx": table_idx,
                        "rows": table
                    })
    except Exception as exc:
        print(f"[table_extractor] Error extracting PDF {pdf_path}: {exc}")
    return extracted


def _repair_split_cells(row: list, min_idx: int, nom_idx: int, max_idx: int) -> list:
    """
    Repair cells where numeric text crossed column grid lines in PDF.
    E.g. Nom: '-- 1', Max: '25.0' -> Nom: '--', Max: '125.0'
         Nom: '150.0 2', Max: '00.0' -> Nom: '150.0', Max: '200.0'
         Nom: '-- 6', Max: '30.0' -> Nom: '--', Max: '630.0'
    """
    if not row or not any(row):
        return row
    fixed = list(row)
    indices = [idx for idx in [min_idx, nom_idx, max_idx] if 0 <= idx < len(fixed)]
    for i in range(len(indices) - 1):
        idx1 = indices[i]
        idx2 = indices[i + 1]
        c1 = str(fixed[idx1]).strip() if fixed[idx1] is not None else ""
        c2 = str(fixed[idx2]).strip() if fixed[idx2] is not None else ""
        
        # NOTE: do not add a lone "-" alternative here - it would also match the leading
        # minus sign of a genuine negative number (e.g. "-17"), wrongly merging it with the
        # next column's digits (observed corrupting Operating Temperature -17/22/63 into "1722").
        m1 = re.search(r"^(.*?)(?:\s+|--\s*)([0-9]+)$", c1)
        m2 = re.match(r"^([0-9]+\.?[0-9]*)(.*)$", c2)
        if m1 and m2:
            left_part = m1.group(1).strip()
            split_part = m1.group(2)
            if not left_part:
                left_part = "--"
            repaired_c2 = split_part + c2
            fixed[idx1] = left_part
            fixed[idx2] = repaired_c2
    return fixed


_MATCHING_VALUE_RE = re.compile(r"[\|I\[]\s*([0-9]+\.?[0-9]*)\s*[\|I\]]")


def _process_matching_criteria_table(rows: list, category_id: str, page_num: int) -> List[Dict[str, Any]]:
    """
    Dedicated extractor for Knowles "Matching Criteria/Specifications" tables (Phase/Sensitivity
    max-deviation-between-microphones). These tables use inconsistent column counts and header
    layouts across datasheet revisions (5/6/7 cols, header split across 1-2 physical rows, and
    PDF cell text that bleeds mid-word across adjacent columns e.g. "de"+"grees"), which defeats
    the generic Min/Nom/Max column-index heuristics - that previously produced garbage like the
    raw Condition sentence being shown as the cell's value/unit. Instead this reads each row's
    own cells directly: label forward-filled from col 0, sub-label frequency from col 1 (always
    "250 Hz"/"1k Hz" in these tables), and the bracket/pipe-wrapped deviation number (PDF renders
    "[ ]" as stray "|"/"I" glyphs, e.g. "| 1.5 |") found anywhere in the row. A vertically-merged
    PDF cell can carry TWO bracketed numbers meant for two consecutive rows (e.g. a cell literally
    containing "| 7.0 | de | 4.0 |"); any extra value found is queued and consumed by the next row
    that has its own sub-label but no value of its own.
    """
    staged = []
    current_label = ""
    pending_values: List[str] = []

    for row in rows[1:]:
        if not row or not any(row):
            continue
        col0 = clean_text(row[0]) if len(row) > 0 and row[0] else ""
        col1 = clean_text(row[1]) if len(row) > 1 and row[1] else ""
        if col0:
            current_label = col0

        if not current_label or not col1:
            continue

        row_cells = [clean_text(c) for c in row if c]
        row_text = " ".join(row_cells)
        pending_values.extend(_MATCHING_VALUE_RE.findall(row_text))
        if not pending_values:
            continue
        value = pending_values.pop(0)

        # Condition sentence: the longest cell beyond the label/freq/value/unit short tokens
        condition_candidates = [c for c in row_cells[2:] if len(c) > 15]
        condition = max(condition_candidates, key=len) if condition_candidates else ""

        label_lower = current_label.lower()
        unit = "°" if "phase" in label_lower else ("dB" if "sensitiv" in label_lower else "")
        full_label = f"{current_label} {col1}".strip()

        matched_param, confidence = match_parameter_alias(full_label, category_id, unit=unit)
        clean_full = re.sub(r"^[*\s•\-]+", "", full_label).strip()
        param_key = matched_param["key"] if matched_param else re.sub(r"[^a-z0-9]+", "_", clean_full.lower()).strip("_")
        canonical_label = matched_param["label"] if matched_param else clean_full
        unit = unit or (matched_param.get("unit") if matched_param else "")

        try:
            value_num: Any = float(value)
        except ValueError:
            value_num = value

        staged.append({
            "raw_label": full_label,
            "param_key": param_key,
            "canonical_label": canonical_label,
            "confidence": confidence,
            "status": "matched" if confidence >= 0.8 else ("fuzzy" if confidence >= 0.5 else "unmatched"),
            "min": None,
            "nom": None,
            "max": value_num,
            "unit": unit,
            "condition": condition or (matched_param.get("default_conditions", "") if matched_param else ""),
            "source_page": page_num,
        })

    return staged


def process_datasheet_pdf(pdf_path: Path, category_id: str = "microphone") -> List[Dict[str, Any]]:
    """
    Parse a datasheet PDF and map extracted table rows to canonical parameters.
    Returns a staging list ready for user review in the Ingestion Inspector.
    """
    raw_tables = extract_pdf_tables(pdf_path)
    staged_items = []
    seen_params = set()

    for table_info in raw_tables:
        page_num = table_info["page_num"]
        rows = table_info["rows"]
        if not rows:
            continue

        # Inspect header row to determine column indices
        header_row = [clean_text(c).lower() for c in rows[0] if c is not None]
        header_text = " ".join(header_row)

        # Dedicated handler: Knowles "Matching Criteria/Specifications" tables (Phase/Sensitivity
        # deviation-between-microphones) use column layouts that are inconsistent across datasheet
        # revisions (5/6/7 cols, header split across 1-2 rows) and defeat the generic Min/Nom/Max
        # column-index heuristics below - see _process_matching_criteria_table for details.
        if "matching" in header_text and ("deviation" in header_text or "criteria" in header_text):
            staged_items.extend(_process_matching_criteria_table(rows, category_id, page_num))
            continue

        # Look for standard spec table headers (Min / Nom / Max / Units / Condition)
        min_idx = -1
        nom_idx = -1
        max_idx = -1
        unit_idx = -1
        cond_idx = -1

        for c_idx, cell in enumerate(rows[0]):
            txt = clean_text(cell).lower()
            if txt in ("min", "minimum"):
                min_idx = c_idx
            elif txt in ("nom", "typ", "typical", "nominal"):
                nom_idx = c_idx
            elif txt in ("max", "maximum", "max deviation"):
                max_idx = c_idx
            elif txt in ("unit", "units"):
                unit_idx = c_idx
            elif txt in ("condition", "conditions", "test condition"):
                cond_idx = c_idx

        # If headers are in row 0, data starts at row 1; otherwise attempt default 6-col mapping
        start_row = 1
        if min_idx == -1 and nom_idx == -1 and max_idx == -1:
            # Check row 1 for header
            if len(rows) > 1:
                for c_idx, cell in enumerate(rows[1]):
                    txt = clean_text(cell).lower()
                    if txt in ("min", "minimum"): min_idx = c_idx
                    elif txt in ("nom", "typ", "typical", "nominal"): nom_idx = c_idx
                    elif txt in ("max", "maximum"): max_idx = c_idx
                    elif txt in ("unit", "units"): unit_idx = c_idx
                    elif txt in ("condition", "conditions"): cond_idx = c_idx
                if min_idx != -1 or nom_idx != -1:
                    start_row = 2

        # Fallback to standard Knowles column layout if header wasn't detected explicitly:
        # Col 0: Label, Col 1: Min, Col 2: Nom, Col 3: Max, Col 4: Units, Col 5: Condition
        if min_idx == -1 and nom_idx == -1 and max_idx == -1:
            num_cols = len(rows[0])
            if num_cols == 6:
                min_idx, nom_idx, max_idx, unit_idx, cond_idx = 1, 2, 3, 4, 5
            elif num_cols == 5:
                min_idx, nom_idx, max_idx, unit_idx = 1, 2, 3, 4
            elif num_cols == 7:
                # E.g. [Param, SubParam, Min, Nom, Max, Units, Condition]
                min_idx, nom_idx, max_idx, unit_idx, cond_idx = 2, 3, 4, 5, 6

        # Check if column values in data rows are shifted by -1 relative to header (common in sparse tables)
        data_rows = [r for r in rows[start_row:] if r and any(r)]
        if data_rows and min_idx > 0:
            count_at = sum(1 for r in data_rows if min_idx < len(r) and r[min_idx] and clean_text(r[min_idx]))
            count_prev = sum(1 for r in data_rows if (min_idx - 1) < len(r) and r[min_idx - 1] and clean_text(r[min_idx - 1]))
            if count_at == 0 and count_prev > 0:
                min_idx -= 1
                if nom_idx > 0: nom_idx -= 1
                if max_idx > 0: max_idx -= 1
                if unit_idx > 0: unit_idx -= 1

        # If condition column was not detected in header, find candidate column after unit_idx
        if cond_idx == -1 and unit_idx != -1 and data_rows:
            cand_cols = {}
            for r in data_rows:
                for c in range(unit_idx + 1, len(r)):
                    if r[c] and clean_text(r[c]):
                        cand_cols[c] = cand_cols.get(c, 0) + 1
            if cand_cols:
                cond_idx = max(cand_cols.items(), key=lambda x: x[1])[0]

        # Process each row
        parent_label = ""
        last_unit = ""
        for r_idx in range(start_row, len(rows)):
            row = rows[r_idx]
            if not row or not any(row):
                continue

            # Repair cell values where digits were split across grid lines into previous column
            row = _repair_split_cells(row, min_idx, nom_idx, max_idx)

            raw_label_0 = clean_text(row[0]) if len(row) > 0 and row[0] else ""
            
            # Detect sub-labels across any intermediate columns before the first real value
            # column (whichever of min/nom/max appears first - tables with only a single
            # "Max Deviation" value column have no min_idx, so min_idx alone can't be used here)
            value_col_indices = [i for i in (min_idx, nom_idx, max_idx) if i != -1]
            first_value_idx = min(value_col_indices) if value_col_indices else -1
            sub_labels = []
            if first_value_idx > 1:
                for c in range(1, first_value_idx):
                    if c < len(row) and row[c] and clean_text(row[c]):
                        sub_txt = clean_text(row[c])
                        if sub_txt not in ("-", "--", "TBD"):
                            sub_labels.append(sub_txt)
            raw_label_1 = " ".join(sub_labels) if sub_labels else ""

            # Detect section headers (e.g. "Electrical Specifications", "Acoustic Specifications")
            if raw_label_0 and not any(row[1:]):
                parent_label = raw_label_0
                continue

            # Extract condition column text early to check for sub-parameters (e.g. "@100 Hz", "@1 kHz")
            raw_cond_early = row[cond_idx] if 0 <= cond_idx < len(row) else None
            clean_cond_early = clean_text(raw_cond_early) if raw_cond_early else ""
            if not raw_label_1 and clean_cond_early:
                m_freq = re.search(r"@\s*([0-9]+\.?\s*(?:k?hz|g?hz))\b", clean_cond_early, re.IGNORECASE)
                if m_freq:
                    raw_label_1 = m_freq.group(1).strip()

            # Determine composite label (e.g., "Sensitivity" + "1 kHz" or "Input-Referred Noise" + "100 Hz")
            main_label = raw_label_0 if raw_label_0 else parent_label
            clean_main = re.sub(r"^[*\s•\-]+", "", main_label).strip()
            clean_sub = re.sub(r"^[*\s•\-]+", "", raw_label_1).strip() if raw_label_1 else ""

            if clean_sub:
                full_label = f"{clean_main} {clean_sub}".strip()
            else:
                full_label = clean_main

            if raw_label_0:
                parent_label = raw_label_0

            if not full_label:
                continue

            # Extract cell values safely
            raw_min = row[min_idx] if 0 <= min_idx < len(row) else None
            raw_nom = row[nom_idx] if 0 <= nom_idx < len(row) else None
            raw_max = row[max_idx] if 0 <= max_idx < len(row) else None
            raw_unit = row[unit_idx] if 0 <= unit_idx < len(row) else None
            raw_cond = row[cond_idx] if 0 <= cond_idx < len(row) else None

            # Carry forward the unit from the group's first row when a vertically-merged
            # unit cell leaves sub-rows (e.g. per-axis Vibration Z/Y/X axis rows) blank
            if not raw_label_0 and not clean_text(raw_unit) and last_unit:
                raw_unit = last_unit
            if clean_text(raw_unit):
                last_unit = raw_unit

            # Skip empty value rows
            if not any([raw_min, raw_nom, raw_max, raw_unit]):
                parent_label = full_label
                continue

            # Perform alias matching with unit dimension verification
            matched_param, confidence = match_parameter_alias(full_label, category_id, unit=raw_unit)

            # Smart normalization for Input-Referred EMI Noise frequency bands
            lbl_lower = full_label.lower()
            if "emi" in lbl_lower or "emi" in clean_main.lower():
                check_str = f"{full_label} {clean_cond_early} {clean_text(raw_cond) or ''}".lower()
                if "0.7" in check_str and "0.96" in check_str:
                    param_key = "input_referred_emi_0_7_0_96_ghz"
                    canonical_label = "Input-Referred EMI Noise 0.7-0.96 GHz"
                    matched_param = {"key": param_key, "label": canonical_label, "unit": "dB SPL", "default_conditions": "@ 90 V/m"}
                    confidence = 1.0
                elif "1.4" in check_str and "2.0" in check_str:
                    param_key = "input_referred_emi_1_4_2_0_ghz"
                    canonical_label = "Input-Referred EMI Noise 1.4-2.0 GHz"
                    matched_param = {"key": param_key, "label": canonical_label, "unit": "dB SPL", "default_conditions": "@ 50 V/m"}
                    confidence = 1.0
                elif "2.0" in check_str and "2.7" in check_str:
                    param_key = "input_referred_emi_2_0_2_7_ghz"
                    canonical_label = "Input-Referred EMI Noise 2.0-2.7 GHz"
                    matched_param = {"key": param_key, "label": canonical_label, "unit": "dB SPL", "default_conditions": "@ 35 V/m"}
                    confidence = 1.0

            # Smart normalization for Input-Referred Vibration: per-axis (Z/Y/X) rows take
            # priority over the open/blocked-port single-row format, otherwise the axis
            # sub-label (e.g. "Z axis") gets clobbered by the generic port-variant label.
            if "vibration" in lbl_lower or "vibration" in clean_main.lower():
                check_str = f"{full_label} {clean_cond_early} {clean_text(raw_cond) or ''}".lower()
                axis_match = re.search(r"\b([xyz])\s*axis\b", clean_sub.lower()) if clean_sub else None
                if axis_match:
                    axis = axis_match.group(1)
                    param_key = f"input_referred_vibration_{axis}_axis"
                    canonical_label = f"Input Referred Vibration {axis.upper()} Axis"
                    matched_param = {"key": param_key, "label": canonical_label, "unit": "dB SPL/g", "default_conditions": "1 g acceleration (Open Port), @ 1 kHz"}
                    confidence = 1.0
                elif "open" in check_str and "port" in check_str:
                    param_key = "input_referred_vibration_1_khz_open_port"
                    canonical_label = "Input Referred Vibration 1 kHz (Open Port)"
                    matched_param = {"key": param_key, "label": canonical_label, "unit": "dB SPL", "default_conditions": "open port, 1g acceleration, sensitivity @ 1kHz"}
                    confidence = 1.0
                elif "blocked" in check_str and "port" in check_str:
                    param_key = "input_referred_vibration_1_khz_blocked_port"
                    canonical_label = "Input Referred Vibration 1 kHz (Blocked Port)"
                    matched_param = {"key": param_key, "label": canonical_label, "unit": "dB SPL", "default_conditions": "blocked port, 1g acceleration, sensitivity @ 1kHz"}
                    confidence = 1.0

            # Normalize min/nom/max values
            normalized = normalize_value(raw_min, raw_nom, raw_max, raw_unit)

            clean_full = re.sub(r"^[*\s•\-]+", "", full_label).strip()
            param_key = matched_param["key"] if matched_param else re.sub(r"[^a-z0-9]+", "_", clean_full.lower()).strip("_")
            canonical_label = matched_param["label"] if matched_param else clean_full
            unit = normalized["unit"] or (matched_param.get("unit") if matched_param else "")

            # Prevent duplicate identical parameter rows from dominating
            dedup_key = f"{param_key}_{normalized['nom']}_{unit}"
            if dedup_key in seen_params:
                continue
            seen_params.add(dedup_key)

            staged_items.append({
                "raw_label": full_label,
                "param_key": param_key,
                "canonical_label": canonical_label,
                "confidence": confidence,
                "status": "matched" if confidence >= 0.8 else ("fuzzy" if confidence >= 0.5 else "unmatched"),
                "min": normalized["min"],
                "nom": normalized["nom"],
                "max": normalized["max"],
                "unit": unit,
                "condition": clean_text(raw_cond) or (matched_param.get("default_conditions", "") if matched_param else ""),
                "source_page": page_num,
            })

    # For microphones, ensure acoustic port dimension is extracted if present
    if category_id == "microphone":
        has_port_dim = any(item.get("param_key") == "acoustic_port_dim" for item in staged_items)
        if not has_port_dim:
            port_spec = extract_acoustic_port_spec(pdf_path)
            if port_spec:
                staged_items.append(port_spec)

    return staged_items


def extract_acoustic_port_spec(pdf_path: Path) -> Optional[Dict[str, Any]]:
    """
    Extract Acoustic Port Dimension from datasheet PDF.
    Scans:
    1. Page 1-2 product feature bullet points (e.g. "Acoustic port dimension : Ø 0.35 mm")
    2. Page 2-6 mechanical specification tables (e.g. "Acoustic Port (AP) Ø0.325 ±0.05 mm")
    """
    if not pdf_path.exists():
        return None
    try:
        import pymupdf as fitz
        doc = fitz.open(str(pdf_path))
    except Exception:
        return None

    try:
        # 1. Scan page 1-2 for product feature bullets: "Acoustic port dimension : Ø 0.35 mm"
        for p_idx in range(min(2, len(doc))):
            page = doc[p_idx]
            text = page.get_text()
            for line in text.splitlines():
                m = re.search(r"acoustic\s*port\s*dimension\s*:\s*(?:[Ø\u00d8\u2300\u00f8O\s]*)?([0-9]+\.?[0-9]*)\s*(mm)?", line, re.IGNORECASE)
                if m:
                    val = m.group(1).strip()
                    unit = m.group(2) or "mm"
                    return {
                        "raw_label": "Acoustic port dimension",
                        "param_key": "acoustic_port_dim",
                        "canonical_label": "Acoustic Port Dimension",
                        "confidence": 1.0,
                        "status": "matched",
                        "min": None,
                        "nom": val,
                        "max": None,
                        "unit": unit,
                        "condition": f"Ø {val} mm",
                        "source_page": p_idx + 1
                    }

        # 2. Scan pages 2-6 for mechanical specification tables: "Acoustic Port (AP)"
        for p_idx in range(1, min(6, len(doc))):
            page = doc[p_idx]
            text = page.get_text()
            lines = [l.strip() for l in text.splitlines() if l.strip()]
            for i, l in enumerate(lines):
                if re.search(r"acoustic\s*port\s*(?:\(\s*ap\s*\))?", l, re.IGNORECASE):
                    for next_l in lines[i+1:min(i+6, len(lines))]:
                        m_num = re.search(r"[Ø\u00d8\u2300\u00f8]?\s*([0-9]+\.[0-9]+)", next_l)
                        if m_num:
                            val = m_num.group(1).strip()
                            tol_str = ""
                            if i+2 < len(lines):
                                m_tol = re.search(r"[±]\s*([0-9]+\.[0-9]+)", lines[i+2])
                                if m_tol:
                                    tol_str = f" ±{m_tol.group(1)}"
                            return {
                                "raw_label": "Acoustic Port (AP)",
                                "param_key": "acoustic_port_dim",
                                "canonical_label": "Acoustic Port Dimension",
                                "confidence": 1.0,
                                "status": "matched",
                                "min": None,
                                "nom": val,
                                "max": None,
                                "unit": "mm",
                                "condition": f"Ø {val}{tol_str} mm".strip(),
                                "source_page": p_idx + 1
                            }

        return None
    finally:
        doc.close()

