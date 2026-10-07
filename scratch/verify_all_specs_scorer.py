import sys
sys.path.insert(0, '.')
import sqlite3
import fitz
import re
from pathlib import Path
from modules.component_database.config import DB_PATH, BASE_DIR, DATASHEETS_VAULT

def find_best_highlight_rects(page, param_key, param_label, raw_label, val, min_val, max_val):
    words = page.get_text("words")
    if not words:
        return None, None

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

    # Collect numeric and string target values
    target_numbers = []
    # Order: clicked val, nominal val, min, max
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

    # String target keywords if non-numeric
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

    raw_query = f"{raw_label or ''} {param_label or ''} {param_key or ''}".lower()
    raw_query = raw_query.replace("*", " ").replace("@", " ").replace("_", " ").replace("-", " ")
    stop_words = {"specifications", "spec", "parameter", "min", "nom", "max", "typ", "typical", "the", "and", "or", "to", "re", "at", "db", "hz", "khz"}
    q_tokens = [w for w in re.findall(r"[a-z0-9]+", raw_query) if len(w) > 1 and w not in stop_words and w not in forb_kw]

    best_score = -9999
    best_row = None
    best_val_w = None

    is_page1 = bool(page.number == 0)
    lbl_x_thresh = 450 if is_page1 else 210

    for r in rows_by_y:
        y_mid = r["y_mid"]
        if y_mid < 80:  # Skip headers
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
        # In sub-rows without left-column label, condition column (x >= 380) often holds frequency (e.g. @100 Hz, @10 kHz)
        cond_tokens = set(re.findall(r"[a-z0-9]+", " ".join(w[4].lower() for w in r_words if w[0] >= 380)))
        adj_tokens = set(re.findall(r"[a-z0-9]+", " ".join(w[4].lower() for w in adj_lbl_w)))
        all_lbl_tokens = row_tokens | adj_tokens

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
            # Only penalize if forbidden keywords appear in the LABEL column (never condition column!)
            if any(k in row_tokens for k in forb_kw):
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

    if not best_row:
        return None, None

    y_mid = best_row["y_mid"]
    # Label rect: prefer label words on this row if present; otherwise look at adjacent
    chosen_lbl_w = [w for w in best_row["words"] if w[0] < lbl_x_thresh and w[4].strip() not in ("-", "--", "*", "•")]
    if not chosen_lbl_w:
        chosen_lbl_w = [
            w for w in words
            if (w[0] < (450 if is_page1 else 210) and (w[0] >= 300 if is_page1 and "port" in raw_query else True))
            and abs((w[1] + w[3]) / 2 - y_mid) <= 18 and w[4].strip() not in ("-", "--", "*", "•")
        ]

    lbl_rect = None
    if chosen_lbl_w:
        lbl_rect = fitz.Rect(
            min(w[0] for w in chosen_lbl_w) - 2,
            min(w[1] for w in chosen_lbl_w) - 1,
            max(w[2] for w in chosen_lbl_w) + 2,
            max(w[3] for w in chosen_lbl_w) + 1,
        )

    val_rect = None
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

    return lbl_rect, val_rect


conn = sqlite3.connect(str(DB_PATH))
cur = conn.cursor()

# First, fix known corrupted database values:
# 1. MM60 & MM08 operating_temp
cur.execute("""
    UPDATE specs
    SET min_val='-17.0', nom_val='22.0', max_val='63.0'
    WHERE param_key='operating_temp' AND (nom_val='1722.0' OR min_val='-17.0')
""")
# 2. MM20 spec 256: Sensitivity matching at 1kHz on page 3
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
print(f"Total specs to test: {len(specs)}")

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

    lbl_rect, val_rect = find_best_highlight_rects(
        page,
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

    if not has_target and any(c.isalpha() for c in val_clean):
        v_tokens = [tok for tok in re.findall(r"[a-z0-9]+", val_clean.lower()) if len(tok) > 3]
        if v_tokens and all(tok in covered_str.lower() for tok in v_tokens):
            has_target = True

    if not has_target:
        failures.append((part_no, key, label, target_val, f"Target '{target_val}' not in '{covered_str}'"))
        print(f"[FAIL VAL] {part_no} P{page_num} {label} ({key}) target={target_val} | Covered={ascii(covered_str)}")
    else:
        lbl_s = ascii(" ".join(covered_lbl_words))
        val_s = ascii(" ".join(covered_val_words))
        print(f"[OK] {part_no} P{page_num} {label} ({key}) -> Lbl={lbl_s} | Val={val_s}")

print("\n" + "="*80)
print(f"VERIFICATION FINISHED: {len(failures)} FAILURES OUT OF {len(specs)} SPECS")
print("="*80)
for f in failures:
    print(f)

