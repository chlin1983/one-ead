import sys
sys.path.insert(0, '.')
import sqlite3
import fitz
import re
from pathlib import Path
from modules.component_database.config import DB_PATH, BASE_DIR, DATASHEETS_VAULT

conn = sqlite3.connect(str(DB_PATH))
cur = conn.cursor()

failed_specs = [
    ('MM07-62964-B66', 'sensitivity_1k', 2, '-35.0'),
    ('MM07-62964-B66', 'resonance_amp', 2, '13.0'),
    ('MM07-62964-B66', 'storage_temp', 2, '-40.0'),
    ('MM07-62964-B66', 'operating_temp', 2, '-17.0'),
    ('MM08-36139-B66', 'sensitivity_1k', 2, '-37.5'),
    ('MM08-36139-B66', 'storage_temp', 2, '-40.0'),
    ('MM08-36139-B66', 'operating_temp', 2, '1722.0'),
    ('MM20-62249-B66', 'sensitivity_1k', 2, '-56.5'),
    ('MM20-62249-B66', 'input_referred_vibration', 2, '54.0'),
    ('MM20-62249-B66', 'input_referred_vibration', 2, '65.0'),
    ('MM20-62249-B66', 'storage_temp', 2, '-40.0'),
    ('MM20-62249-B66', 'operating_temp', 2, '-17.0'),
    ('MM20-62249-B66', 'phase_250_hz', 3, '4.0'),
    ('MM60-63230-B66', 'sensitivity_1k', 2, '-35.5'),
    ('MM60-63230-B66', 'storage_temp', 2, '-40.0'),
    ('MM60-63230-B66', 'operating_temp', 2, '1722.0'),
]

for part_no, key, page_num, target in failed_specs:
    cur.execute("""
        SELECT c.datasheet_filename, c.datasheet_category, s.param_label, s.min_val, s.nom_val, s.max_val, s.condition
        FROM specs s
        JOIN components c ON c.id = s.component_id
        WHERE c.part_number = ? AND s.param_key = ? AND s.source_page = ?
    """, (part_no, key, page_num))
    rows = cur.fetchall()
    print(f"\n--- {part_no} | {key} | Page {page_num} | target: {target} ---")
    for r in rows:
        fn, cat, lbl, min_v, nom_v, max_v, cond = r
        print(f"  DB: lbl='{lbl}', min='{min_v}', nom='{nom_v}', max='{max_v}', cond='{cond}'")
        pdf_path = (DATASHEETS_VAULT / fn) if cat == "vault" else (BASE_DIR / (cat or "microphone") / fn)
        doc = fitz.open(pdf_path)
        page = doc[page_num - 1]
        words = page.get_text("words")
        matching_words = []
        for w in words:
            if target in w[4]:
                matching_words.append(w)
            elif re.search(r"[-+]?\d*\.?\d+", target):
                t_val = float(re.search(r"[-+]?\d*\.?\d+", target).group(0))
                m = re.search(r"[-+]?\d*\.?\d+", w[4])
                if m and abs(float(m.group(0)) - t_val) < 1e-4:
                    matching_words.append(w)
        for mw in matching_words[:3]:
            y_mid = (mw[1] + mw[3]) / 2
            row = [w[4] for w in words if abs((w[1] + w[3]) / 2 - y_mid) < 7]
            print(f"  PDF match at y={y_mid:.1f}, x={mw[0]:.1f}: {' '.join(row)}")
