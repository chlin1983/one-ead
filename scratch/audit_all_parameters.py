import sys
sys.path.insert(0, '.')
import sqlite3
import fitz
import re
from pathlib import Path
from modules.component_database.module import highlight_datasheet_pdf
from modules.component_database.config import DB_PATH, BASE_DIR, DATASHEETS_VAULT

conn = sqlite3.connect(str(DB_PATH))
cur = conn.cursor()

cur.execute("""
    SELECT c.id, c.part_number, c.datasheet_filename, c.datasheet_category,
           s.param_key, s.param_label, s.min_val, s.nom_val, s.max_val, s.unit, s.condition, s.source_page
    FROM specs s
    JOIN components c ON c.id = s.component_id
    ORDER BY c.part_number, s.source_page, s.id
""")
specs = cur.fetchall()
print(f"Total specs to audit: {len(specs)}")

issues = []

for r in specs:
    comp_id, part_no, filename, cat, key, label, min_v, nom_v, max_v, unit, cond, page_num = r
    cat = cat or "microphone"
    pdf_path = (DATASHEETS_VAULT / filename) if cat == "vault" else (BASE_DIR / cat / filename)
    if not pdf_path.exists():
        print(f"WARNING: File {pdf_path} not found")
        continue

    # Determine primary target value
    target_val = nom_v or min_v or max_v
    if not target_val or target_val in ("-", "--", "TBD", "N/A"):
        continue

    try:
        out_bytes, hl_info = highlight_datasheet_pdf(
            pdf_path,
            page_num=page_num,
            param_key=key,
            param_label=label,
            raw_label=label,
            val=nom_v,
            min_val=min_v,
            max_val=max_v,
            category=cat
        )
    except Exception as ex:
        issues.append({
            "part": part_no,
            "key": key,
            "label": label,
            "page": page_num,
            "error": f"Exception: {ex}"
        })
        continue

    doc = fitz.open(stream=out_bytes, filetype="pdf")
    page_idx = max(0, min(page_num - 1, len(doc) - 1))
    page = doc[page_idx]
    annots = list(page.annots())

    if not annots:
        issues.append({
            "part": part_no,
            "key": key,
            "label": label,
            "target": target_val,
            "page": page_num,
            "error": "No annotation created"
        })
        continue

    # Check words covered by annotations
    words = page.get_text("words")
    covered_words = []
    for a in annots:
        c_words = [w[4] for w in words if fitz.Rect(w[:4]).intersects(a.rect)]
        covered_words.extend(c_words)
    covered_str = " ".join(covered_words)

    # Check if target_val is in covered words
    val_clean = str(target_val).strip()
    val_clean_no_zero = val_clean.rstrip("0").rstrip(".") if "." in val_clean else val_clean
    has_target = (val_clean in covered_str) or (val_clean_no_zero in covered_str)
    
    # Also check if numeric match exists in covered words
    num_m = re.search(r"[-+]?\d*\.?\d+", val_clean)
    if num_m and not has_target:
        target_f = float(num_m.group(0))
        for cw in covered_words:
            c_num = re.search(r"[-+]?\d*\.?\d+", cw)
            if c_num:
                try:
                    if abs(float(c_num.group(0)) - target_f) < 1e-4:
                        has_target = True
                        break
                except Exception:
                    pass

    # Check if min or max matched instead
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

    status = "OK" if has_target else "WRONG_VALUE_HIGHLIGHTED"
    print(f"[{status}] {part_no} (P{page_num}) {label} ({key}): target={target_val} | Covered: {ascii(covered_str)}")
    if not has_target:
        issues.append({
            "part": part_no,
            "key": key,
            "label": label,
            "target": target_val,
            "page": page_num,
            "covered": covered_str,
            "error": f"Target value '{target_val}' NOT in highlighted text '{covered_str}'"
        })

print("\n" + "="*80)
print(f"AUDIT SUMMARY: {len(issues)} ISSUES FOUND OUT OF {len(specs)} SPECS")
print("="*80)
for iss in issues:
    print(iss)
