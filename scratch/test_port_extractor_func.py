import re
import fitz
from pathlib import Path

def extract_acoustic_port_spec(pdf_path: Path):
    if not pdf_path.exists():
        return None
    try:
        doc = fitz.open(str(pdf_path))
    except Exception:
        return None

    # 1. Scan page 1-2 for product feature bullets: "Acoustic port dimension : Ø 0.35 mm"
    for p_idx in range(min(2, len(doc))):
        page = doc[p_idx]
        text = page.get_text()
        for line in text.splitlines():
            m = re.search(r"acoustic\s*port\s*dimension\s*:\s*(?:[Ø\u00d8\u2300\u00f8O\s]*)?([0-9]+\.?[0-9]*)\s*(mm)?", line, re.IGNORECASE)
            if m:
                val = m.group(1).strip()
                unit = m.group(2) or "mm"
                # Extract clean condition or display value
                raw_txt = line.strip().replace("", "Ø")
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
                # Search next few lines for numeric diameter & tolerance
                for next_l in lines[i+1:min(i+6, len(lines))]:
                    m_num = re.search(r"[Ø\u00d8\u2300\u00f8]?\s*([0-9]+\.[0-9]+)", next_l)
                    if m_num:
                        val = m_num.group(1).strip()
                        # check if next line has tolerance
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

pdf_dir = Path('modules/component_database/microphone')
for p in sorted(pdf_dir.glob('*.pdf')):
    spec = extract_acoustic_port_spec(p)
    print(f"{p.name} -> {spec}")
