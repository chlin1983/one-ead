import fitz
import re
from pathlib import Path

pdf_path = Path('modules/component_database/microphone/D00186943_V3_DATA SHEET MIC MM20-62249-B66 KNOWLES.pdf')
doc = fitz.open(pdf_path)
page = doc[1]
words = page.get_text('words')

def score_and_find_row(words, param_key, param_label, raw_label, val, min_val, max_val):
    # Group words into rows
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

    # Prepare target numbers
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

    # Specific sub-label keywords
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
        if y_mid < 80:  # Skip page headers
            continue

        label_w = [w for w in r_words if w[0] < 260]
        val_w = [w for w in r_words if 180 <= w[0] <= 420]
        cond_w = [w for w in r_words if w[0] > 400]

        lbl_text = " ".join(w[4].lower() for w in label_w)
        lbl_tokens = re.findall(r"[a-z0-9]+", lbl_text)

        score = 0
        matched_val_word = None

        # 1. Target Value Match
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
                score -= 30  # penalty if values don't match

        # 2. Sub-label match in label words
        if req_kw:
            has_req = any(kw in lbl_tokens for kw in req_kw)
            has_forb = any(kw in lbl_tokens for kw in forb_kw)
            if has_req:
                score += 50
            if has_forb:
                score -= 60

        # 3. Parameter query words in label words
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

score, row, val_w = score_and_find_row(
    words,
    param_key="sensitivity_1k",
    param_label="Sensitivity @ 1 kHz",
    raw_label="Sensitivity @ 1 kHz",
    val="-56.5",
    min_val="-59.5",
    max_val="-53.5"
)

print(f"Best score: {score}")
print(f"Best row text: {' '.join(w[4] for w in row)}")
print(f"Matched value word: {val_w}")
