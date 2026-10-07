import sys
sys.path.insert(0, '.')
from pathlib import Path
from modules.component_database.module import highlight_datasheet_pdf

pdf_dir = Path('modules/component_database/microphone')

tests = [
    {
        "filename": "D00343759_V2_DATA SHEET MIC MM60-63230-B66 KNOWLES.pdf",
        "page": 1,
        "key": "acoustic_port_dim",
        "label": "Acoustic Port Dimension",
        "raw_label": "Acoustic port dimension",
        "val": "0.30"
    },
    {
        "filename": "MM08-36139-B66 Rev 5 preliminary datasheet.pdf",
        "page": 1,
        "key": "acoustic_port_dim",
        "label": "Acoustic Port Dimension",
        "raw_label": "Acoustic port dimension",
        "val": "0.35"
    },
    {
        "filename": "D21027116_V1_DATA SHEET MIC MM07-62964-B66 KNOWLES.pdf",
        "page": 4,
        "key": "acoustic_port_dim",
        "label": "Acoustic Port Dimension",
        "raw_label": "Acoustic Port (AP)",
        "val": "0.325"
    }
]

for t in tests:
    pdf_path = pdf_dir / t["filename"]
    out_bytes, hl_info = highlight_datasheet_pdf(
        pdf_path,
        page_num=t["page"],
        param_label=t["label"],
        param_key=t["key"],
        raw_label=t["raw_label"],
        val=t["val"]
    )
    print(f"{t['filename']} (P{t['page']}): has_highlight={hl_info.get('has_highlight')}, y={hl_info.get('y')}, ratio={hl_info.get('ratio'):.3f}")
