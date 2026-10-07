import sys
sys.path.insert(0, '.')
import fitz
import re
from pathlib import Path

mic_dir = Path('modules/component_database/microphone')

def extract_port_dim_from_pdf(pdf_path):
    doc = fitz.open(pdf_path)
    # Check page 1 text features
    for p_idx in range(min(2, len(doc))):
        page = doc[p_idx]
        text = page.get_text()
        for line in text.splitlines():
            m = re.search(r"acoustic\s*port\s*dimension\s*:\s*(?:[Ø\u00d8\u2300\u00f8O\s]*)?([0-9]+\.?[0-9]*)\s*(mm)?", line, re.IGNORECASE)
            if m:
                val = m.group(1)
                unit = m.group(2) or "mm"
                return {
                    "param_key": "acoustic_port_dim",
                    "canonical_label": "Acoustic Port Dimension",
                    "raw_label": line.strip(),
                    "nom": val,
                    "unit": unit,
                    "source_page": p_idx + 1
                }
    # Check mechanical tables on page 3-5
    for p_idx in range(2, min(5, len(doc))):
        page = doc[p_idx]
        text = page.get_text()
        lines = [l.strip() for l in text.splitlines() if l.strip()]
        for i, l in enumerate(lines):
            if re.search(r"acoustic\s*port\s*\(\s*ap\s*\)", l, re.IGNORECASE):
                # Search next few lines for numeric diameter
                for next_l in lines[i+1:i+5]:
                    m = re.search(r"[Ø\u00d8\u2300\u00f8]?\s*([0-9]+\.[0-9]+)", next_l)
                    if m:
                        return {
                            "param_key": "acoustic_port_dim",
                            "canonical_label": "Acoustic Port Dimension",
                            "raw_label": f"{l} {next_l}",
                            "nom": m.group(1),
                            "unit": "mm",
                            "source_page": p_idx + 1
                        }
    return None

for pdf_file in sorted(mic_dir.glob('*.pdf')):
    res = extract_port_dim_from_pdf(pdf_file)
    print(f"{pdf_file.name}: {res}")
