import sys
sys.path.insert(0, '.')
import sqlite3
import fitz
import re
from pathlib import Path
from modules.component_database.config import DB_PATH, BASE_DIR, DATASHEETS_VAULT

def find_confirmed_highlight(page, page_num, param_key, param_label, raw_label, val, min_val, max_val):
    words = page.get_text("words")
    if not words:
        return None, None

    # Collect target values (clicked/nominal val first, then min, then max)
    target_values = []
    for candidate, prio in [(val, "val"), (min_val, "min"), (max_val, "max")]:
        if candidate is not None:
            c_str = str(candidate).strip()
            if c_str and c_str not in ("-", "--", "TBD", "N/A", "None", "n/a"):
                c_clean = c_str.rstrip("0").rstrip(".") if "." in c_str else c_str
                num_m = re.search(r"[-+]?\d*\.?\d+", c_str)
                num_f = float(num_m.group(0)) if num_m else None
                target_values.append((c_str, c_clean, num_f, prio))

    # Candidate label strings in prioritized order
    candidates = []
    
    # Specific sub-label overrides (most specific first!)
    specific_aliases = {
        "sensitivity_1k": ["1 kHz", "1kHz", "Sensitivity 1 kHz", "Sensitivity @ 1 kHz", "Sensitivity @1kHz"],
        "sensitivity_100hz": ["100 Hz", "100Hz", "Sensitivity @ 100 Hz", "Sensitivity @100Hz", "Sensitivity 100 Hz"],
        "sensitivity_10k": ["10 kHz", "10kHz", "Sensitivity @ 10 kHz", "Sensitivity @10kHz", "Sensitivity 10 kHz"],
        "sensitivity_30hz": ["30 Hz", "30Hz", "Sensitivity @ 30 Hz", "@ 30 Hz", "@ 30Hz", "@30Hz"],
        "sensitivity_peak": ["Peak", "Sensitivity Peak"],
        "resonance_amp": ["Amplitude", "Resonance Peak Amplitude", "Resonance Peak", "*Resonance Peak"],
        "resonance_freq": ["Peak Frequency", "Resonance Peak Frequency", "Frequency"],
        "input_referred_noise_1_3rd_octave_100_hz": ["100 Hz", "100Hz", "1/3rd Octave 100 Hz"],
        "input_referred_noise_1_3rd_octave_1_khz": ["1 kHz", "1kHz", "1/3rd Octave 1 kHz"],
        "input_referred_noise_1_3rd_octave_10_khz": ["10 kHz", "10kHz", "1/3rd Octave 10 kHz"],
        "acoustic_port_dim": ["Acoustic port dimension", "Acoustic Port", "Port dimension", "port dimension"],
        "storage_temp": ["*Storage Temperature", "Storage Temperature", "Storage Temp"],
        "operating_temp": ["*Operating Temperature", "Operating Temperature", "Operating Temp"],
        "polarity": ["Polarity", "*Polarity"],
        "weight": ["*Weight", "Weight"],
    }

    if param_key in specific_aliases:
        candidates.extend(specific_aliases[param_key])

    if raw_label:
        clean_raw = raw_label.replace("*", "").strip()
        candidates.extend([raw_label, clean_raw])

    if param_label:
        clean_param = param_label.replace("*", "").strip()
        candidates.extend([param_label, clean_param])
        if "@" in param_label:
            candidates.append(param_label.replace("@", "").replace("  ", " ").strip())

    # Deduplicate candidates while preserving order
    seen = set()
    uniq_candidates = []
    for c in candidates:
        if c and c not in seen:
            seen.add(c)
            uniq_candidates.append(c)

    best_match = None
    best_val_rect = None
    best_lbl_rect = None

    # Step 1: Search candidates that have VALUE CONFIRMATION on their line
    for cand in uniq_candidates:
        rects = page.search_for(cand)
        if not rects:
            continue

        for r in rects:
            # Must not be in header (y < 60)
            if r.y0 < 60:
                continue
            # In multi-column table pages (page > 1), label must not be in the condition column (x > 360)
            # Exception: page 1 where port dimension is at x ~ 336
            if page_num > 1 and r.x0 > 360:
                continue

            r_ymid = (r.y0 + r.y1) / 2
            # Words on this row (allow +/- 10 pt vertical tolerance)
            row_words = [w for w in words if abs((w[1] + w[3]) / 2 - r_ymid) <= 10]

            # Check if any target value is on this line
            matched_val_word = None
            if target_values:
                for v_str, v_clean, v_num, prio in target_values:
                    for w in row_words:
                        # Must be in value area (to the right of the candidate label)
                        if w[0] < r.x0 + 5:
                            continue
                        w_text = w[4].strip()
                        w_clean = w_text.rstrip("0").rstrip(".") if "." in w_text else w_text
                        if v_clean == w_clean or v_str == w_text:
                            matched_val_word = w
                            break
                        if v_num is not None:
                            num_m = re.search(r"[-+]?\d*\.?\d+", w_text)
                            if num_m:
                                try:
                                    if abs(float(num_m.group(0)) - v_num) < 1e-4:
                                        matched_val_word = w
                                        break
                                except Exception:
                                    pass
                    if matched_val_word:
                        break

            # If string match (e.g. Polarity: "Increasing output voltage")
            if not matched_val_word and val and any(char.isalpha() for char in str(val)):
                v_words = str(val).lower().split()
                row_text = " ".join(w[4].lower() for w in row_words if w[0] > r.x0 + 5)
                if any(vw in row_text for vw in v_words if len(vw) > 3):
                    # Match words in row that correspond to val
                    matching_ws = [w for w in row_words if w[0] > r.x0 + 5 and any(vw in w[4].lower() for vw in v_words if len(vw) > 3)]
                    if matching_ws:
                        matched_val_word = matching_ws[0]

            if matched_val_word:
                # CONFIRMED VALUE MATCH!
                best_lbl_rect = r
                best_val_rect = fitz.Rect(matched_val_word[0] - 2, matched_val_word[1] - 1, matched_val_word[2] + 2, matched_val_word[3] + 1)
                
                # Check if label is a sub-label (like "1 kHz" or "Amplitude") and has a parent label directly above
                # e.g. "Sensitivity" above "1 kHz", or "Resonance Peak" above "Amplitude"
                parent_lbl_words = [
                    w for w in words
                    if w[0] < 220 and abs((w[1] + w[3]) / 2 - (r_ymid - 12)) <= 7 and w[4].strip() not in ("-", "--", "*", "•")
                ]
                if parent_lbl_words and cand in ["1 kHz", "100 Hz", "10 kHz", "Amplitude", "Peak"]:
                    # Expand label rect to include parent label if relevant
                    p_text = " ".join(w[4].lower() for w in parent_lbl_words)
                    if any(k in p_text for k in ["sensitivity", "resonance", "noise"]):
                        p_rect = fitz.Rect(min(w[0] for w in parent_lbl_words), min(w[1] for w in parent_lbl_words), max(w[2] for w in parent_lbl_words), max(w[3] for w in parent_lbl_words))
                        best_lbl_rect = best_lbl_rect | p_rect

                return best_lbl_rect, best_val_rect

    # Step 2: If no value-confirmed match was found, fall back to best candidate label (left column only)
    for cand in uniq_candidates:
        rects = page.search_for(cand)
        if not rects:
            continue
        valid_rects = [r for r in rects if r.y0 > 60 and (page_num == 1 or r.x0 <= 360)]
        if valid_rects:
            best_lbl_rect = valid_rects[0]
            # Try to find value on this line
            r_ymid = (best_lbl_rect.y0 + best_lbl_rect.y1) / 2
            row_words = [w for w in words if abs((w[1] + w[3]) / 2 - r_ymid) <= 10 and w[0] > best_lbl_rect.x0 + 5]
            val_candidates = [w for w in row_words if 200 <= w[0] <= 360 and w[4].strip() not in ("-", "--")]
            if val_candidates:
                best_val_rect = fitz.Rect(val_candidates[0][0] - 2, val_candidates[0][1] - 1, val_candidates[0][2] + 2, val_candidates[0][3] + 1)
            return best_lbl_rect, best_val_rect

    return None, None


# Test harness
conn = sqlite3.connect(str(DB_PATH))
cur = conn.cursor()

# Ensure DB fixes
cur.execute("""
    UPDATE specs
    SET min_val='-17.0', nom_val='22.0', max_val='63.0'
    WHERE param_key='operating_temp' AND (nom_val='1722.0' OR min_val='-17.0')
""")
cur.execute("""
    UPDATE specs
    SET param_key='sensitivity_1k', param_label='Sensitivity @ 1 kHz', min_val=NULL, nom_val='4.0', unit='dB'
    WHERE id=256
""")
conn.commit()

cur.execute("""
    SELECT c.id, c.part_number, c.datasheet_filename, c.datasheet_category,
           s.param_key, s.param_label, s.min_val, s.nom_val, s.max_val, s.unit, s.condition, s.source_page
    FROM specs s
    JOIN components c ON c.id = s.component_id
    ORDER BY c.part_number, s.source_page, s.id
""")
specs = cur.fetchall()

failures = []

for r in specs:
    comp_id, part_no, filename, cat, key, label, min_v, nom_v, max_v, unit, cond, page_num = r
    cat = cat or "microphone"
    pdf_path = (DATASHEETS_VAULT / filename) if cat == "vault" else (BASE_DIR / cat / filename)
    if not pdf_path.exists():
        continue

    target_val = nom_v or min_v or max_v
    if not target_val or target_val in ("-", "--", "TBD", "N/A"):
        continue

    doc = fitz.open(pdf_path)
    page_idx = max(0, min(page_num - 1, len(doc) - 1))
    page = doc[page_idx]

    lbl_rect, val_rect = find_confirmed_highlight(
        page,
        page_num=page_num,
        param_key=key,
        param_label=label,
        raw_label=label,
        val=nom_v,
        min_val=min_v,
        max_val=max_v,
    )

    if not lbl_rect:
        failures.append((part_no, key, label, target_val, "No lbl_rect"))
        print(f"[FAIL NO LBL] {part_no} P{page_num} {label} ({key})")
        continue

    words = page.get_text("words")
    covered_val_words = [w[4] for w in words if val_rect and fitz.Rect(w[:4]).intersects(val_rect)] if val_rect else []
    covered_lbl_words = [w[4] for w in words if fitz.Rect(w[:4]).intersects(lbl_rect)]
    covered_all = covered_lbl_words + covered_val_words
    covered_str = " ".join(covered_all)

    # Check if target_val is found
    val_clean = str(target_val).strip()
    val_clean_no_zero = val_clean.rstrip("0").rstrip(".") if "." in val_clean else val_clean
    has_target = (val_clean in covered_str) or (val_clean_no_zero in covered_str)

    num_m = re.search(r"[-+]?\d*\.?\d+", val_clean)
    if num_m and not has_target:
        target_f = float(num_m.group(0))
        for cw in covered_all:
            c_num = re.search(r"[-+]?\d*\.?\d+", cw)
            if c_num:
                try:
                    if abs(float(c_num.group(0)) - target_f) < 1e-4:
                        has_target = True
                        break
                except Exception:
                    pass

    if not has_target and min_v:
        m_clean = str(min_v).strip().rstrip("0").rstrip(".")
        if m_clean in covered_str:
            has_target = True
    if not has_target and max_v:
        m_clean = str(max_v).strip().rstrip("0").rstrip(".")
        if m_clean in covered_str:
            has_target = True

    if not has_target and any(char.isalpha() for char in val_clean):
        # Text match
        if any(w.lower() in covered_str.lower() for w in val_clean.split() if len(w) > 3):
            has_target = True

    if not has_target:
        failures.append((part_no, key, label, target_val, f"Target '{target_val}' not in '{covered_str}'"))
        print(f"[FAIL VAL] {part_no} P{page_num} {label} ({key}) target={target_val} | Covered='{covered_str}'")
    else:
        print(f"[OK] {part_no} P{page_num} {label} ({key}) -> Lbl='{' '.join(covered_lbl_words)}' | Val='{' '.join(covered_val_words)}'")

print("\n" + "="*80)
print(f"VERIFICATION FINISHED: {len(failures)} FAILURES OUT OF {len(specs)} SPECS")
print("="*80)
for f in failures:
    print(f)
