import sys
sys.path.insert(0, '.')
import fitz
from pathlib import Path
from modules.component_database.module import BASE_DIR

mic_dir = BASE_DIR / 'microphone'

def test_highlight(fname, key, raw, val):
    pdf_path = mic_dir / fname
    doc = fitz.open(str(pdf_path))
    page = doc[1]
    words = page.get_text("words")

    special = {
        "input_referred_emi_0_7_0_96_ghz": ["0.70-0.96 GHz", "0.7-0.96 GHz", "0.70-0.96", "0.7-0.96", "0.70 - 0.96", "0.7 - 0.96"],
        "input_referred_emi_1_4_2_0_ghz": ["1.4-2.0 GHz", "1.4-2.0", "1.4 - 2.0 GHz", "1.4 - 2.0"],
        "input_referred_emi_2_0_2_7_ghz": ["2.0-2.7 GHz", "2.0-2.7", "2.0 - 2.7 GHz", "2.0 - 2.7"],
    }

    candidates = special.get(key, [])
    found_rect = None
    target_values = [(str(val), str(val).rstrip('0').rstrip('.'))] if val else []

    for a in candidates:
        rects = page.search_for(a)
        if not rects:
            continue
        if target_values:
            for r in rects:
                y_mid = (r.y0 + r.y1) / 2
                row_words = [w[4].strip() for w in words if abs((w[1] + w[3]) / 2 - y_mid) < 8]
                for v_str, v_clean in target_values:
                    for w in row_words:
                        w_clean = w.rstrip("0").rstrip(".") if "." in w else w
                        if v_clean == w_clean or v_str == w:
                            found_rect = r
                            break
                    if found_rect:
                        break
                if found_rect:
                    break
        if not found_rect:
            found_rect = rects[0]
        if found_rect:
            break

    # Now find value rect on same row
    val_rect = None
    if found_rect and target_values:
        y_mid = (found_rect.y0 + found_rect.y1) / 2
        for w in words:
            if abs((w[1] + w[3]) / 2 - y_mid) < 8:
                w_str = w[4].strip()
                w_clean = w_str.rstrip("0").rstrip(".") if "." in w_str else w_str
                for v_str, v_clean in target_values:
                    if w_clean == v_clean or w_str == v_str:
                        val_rect = fitz.Rect(w[0], w[1], w[2], w[3])
                        break
                if val_rect:
                    break

    y_pos = (found_rect.y0 + (val_rect.y0 if val_rect else found_rect.y0)) / 2 if found_rect else 0
    ratio = y_pos / page.rect.height if page.rect.height else 0
    return bool(found_rect and (val_rect or not val or val == 'TBD')), y_pos, ratio, found_rect, val_rect

tests = [
    # MM60
    ('D00343759_V2_DATA SHEET MIC MM60-63230-B66 KNOWLES.pdf', 'input_referred_emi_0_7_0_96_ghz', 'Input-Referred EMI Noise 0.7-0.96 GHz', '7.0'),
    ('D00343759_V2_DATA SHEET MIC MM60-63230-B66 KNOWLES.pdf', 'input_referred_emi_1_4_2_0_ghz', 'Input-Referred EMI Noise 1.4-2.0 GHz', '1.0'),
    ('D00343759_V2_DATA SHEET MIC MM60-63230-B66 KNOWLES.pdf', 'input_referred_emi_2_0_2_7_ghz', 'Input-Referred EMI Noise 2.0-2.7 GHz', '1.0'),

    # MM08
    ('MM08-36139-B66 Rev 5 preliminary datasheet.pdf', 'input_referred_emi_0_7_0_96_ghz', 'Input-Referred EMI Noise 0.7-0.96 GHz', 'TBD'),
    ('MM08-36139-B66 Rev 5 preliminary datasheet.pdf', 'input_referred_emi_1_4_2_0_ghz', 'Input-Referred EMI Noise 1.4-2.0 GHz', 'TBD'),
    ('MM08-36139-B66 Rev 5 preliminary datasheet.pdf', 'input_referred_emi_2_0_2_7_ghz', 'Input-Referred EMI Noise 2.0-2.7 GHz', 'TBD'),

    # MM20
    ('D00186943_V3_DATA SHEET MIC MM20-62249-B66 KNOWLES.pdf', 'input_referred_emi_0_7_0_96_ghz', 'Input-Referred EMI 0.70-0.96 GHz 90 V/m', '25.0'),
    ('D00186943_V3_DATA SHEET MIC MM20-62249-B66 KNOWLES.pdf', 'input_referred_emi_1_4_2_0_ghz', 'Input-Referred EMI 1.4-2.0 GHz 50 V/m', '15.0'),
    ('D00186943_V3_DATA SHEET MIC MM20-62249-B66 KNOWLES.pdf', 'input_referred_emi_2_0_2_7_ghz', 'Input-Referred EMI 2.0-2.7 GHz 35V/m', '15.0'),
]

for fname, key, raw, val in tests:
    ok, y, r, f_rect, v_rect = test_highlight(fname, key, raw, val)
    print(f'{fname[:12]} [{key[-11:]}] val={val} -> ok: {ok}, y: {y:.1f}, ratio: {r:.4f}, lbl={f_rect}, val={v_rect}')
