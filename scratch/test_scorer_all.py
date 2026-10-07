import sys
sys.path.insert(0, '.')
import sqlite3
import fitz
import re
from pathlib import Path
from modules.component_database.config import DB_PATH, BASE_DIR, DATASHEETS_VAULT

def score_and_find_row(words, param_key, param_label, raw_label, val, min_val, max_val):
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

    target_numbers = []
    for candidate in [val, min_val, max_val]:
        if candidate is not None:
            c_str = str(candidate).strip()
            num_m = re.search(r"[-+]?\d*\.?\d+", c_str)
            if num_m:
                try:
                    target_numbers.append((float(num_m.group(0)), c_str))
                except Exception:
                    pass

    key_sublabel_map = {
        "sensitivity_1k": (["1", "1k"], ["100", "10", "30", "peak"]),
        "sensitivity_100hz": (["100"], ["1", "10", "30", "peak"]),
        "sensitivity_10k": (["10"], ["100", "1", "30", "peak"]),
        "sensitivity_30hz": (["30"], ["100", "1", "10", "peak"]),
        "sensitivity_peak": (["peak"], ["100", "1", "10", "30"]),
    }

    req_kw, forb_kw = key_sublabel_map.get(param_key, ([], []))

    best_score = -999
    best_row = None
    best_val_w = None

    for r in rows_by_y:
        r_words = sorted(r["words"], key=lambda w: w[0])
        y_mid = r["y_mid"]
        if y_mid < 80:
            continue

        label_w = [w for w in r_words if w[0] < 260]
        val_w = [w for w in r_words if 160 <= w[0] <= 420]

        lbl_text = " ".join(w[4].lower() for w in label_w)
        lbl_tokens = re.findall(r"[a-z0-9]+", lbl_text)

        score = 0
        matched_val_word = None

        if target_numbers:
            row_has_target = False
            for target_f, target_s in target_numbers:
                for w in val_w:
                    num_m = re.search(r"[-+]?\d*\.?\d+", w[4])
                    if num_m:
                        try:
                            if abs(float(num_m.group(0)) - target_f) < 1e-4:
                                score += 80
                                row_has_target = True
                                if matched_val_word is None:
                                    matched_val_word = w
                                break
                        except Exception:
                            pass
                if row_has_target:
                    break
            if not row_has_target:
                score -= 30

        if req_kw:
            has_req = any(kw in lbl_tokens for kw in req_kw)
            has_forb = any(kw in lbl_tokens for kw in forb_kw)
            if has_req:
                score += 50
            if has_forb:
                score -= 60

        q_words = re.findall(r"[a-z0-9]+", f"{param_label or ''} {param_key or ''}".lower())
        stop_words = {"specifications", "spec", "parameter", "min", "nom", "max", "typ", "typical", "the", "and", "or", "to", "re", "at"}
        q_tokens = [q for q in q_words if len(q) > 1 and q not in stop_words and q not in forb_kw]
        for q in q_tokens:
            if q in lbl_tokens:
                score += 15

        if score > best_score:
            best_score = score
            best_row = r_words
            best_val_w = matched_val_word

    return best_score, best_row, best_val_w

conn = sqlite3.connect(str(DB_PATH))
cur = conn.cursor()

test_cases = [
    ('MM07-62964-B66', 'sensitivity_1k', 2, '-35.0'),
    ('MM07-62964-B66', 'resonance_amp', 2, '13.0'),
    ('MM07-62964-B66', 'storage_temp', 2, '-40.0'),
    ('MM07-62964-B66', 'operating_temp', 2, '-17.0'),
    ('MM08-36139-B66', 'sensitivity_1k', 2, '-37.5'),
    ('MM08-36139-B66', 'storage_temp', 2, '-40.0'),
    ('MM20-62249-B66', 'sensitivity_1k', 2, '-56.5'),
    ('MM20-62249-B66', 'input_referred_vibration', 2, '54.0'),
    ('MM20-62249-B66', 'input_referred_vibration', 2, '65.0'),
    ('MM20-62249-B66', 'storage_temp', 2, '-40.0'),
    ('MM20-62249-B66', 'operating_temp', 2, '-17.0'),
    ('MM60-63230-B66', 'sensitivity_1k', 2, '-35.5'),
    ('MM60-63230-B66', 'storage_temp', 2, '-40.0'),
]

for part_no, key, page_num, target in test_cases:
    cur.execute("""
        SELECT c.datasheet_filename, c.datasheet_category, s.param_label, s.min_val, s.nom_val, s.max_val
        FROM specs s
        JOIN components c ON c.id = s.component_id
        WHERE c.part_number = ? AND s.param_key = ? AND s.source_page = ?
    """, (part_no, key, page_num))
    fn, cat, lbl, min_v, nom_v, max_v = cur.fetchone()
    pdf_path = (DATASHEETS_VAULT / fn) if cat == "vault" else (BASE_DIR / (cat or "microphone") / fn)
    doc = fitz.open(pdf_path)
    page = doc[page_num - 1]
    words = page.get_text('words')

    score, row, val_w = score_and_find_row(
        words,
        param_key=key,
        param_label=lbl,
        raw_label=lbl,
        val=nom_v or target,
        min_val=min_v,
        max_val=max_v
    )

    row_text = ' '.join(w[4] for w in row) if row else 'NONE'
    val_text = val_w[4] if val_w else 'NONE'
    print(f"[{'OK' if val_w else 'FAIL'}] {part_no} | {key}: target={target} -> matched val={val_text} on row: '{row_text}'")
