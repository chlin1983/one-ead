import sys
sys.path.insert(0, '.')
import fitz
from pathlib import Path
from modules.component_database.module import highlight_datasheet_pdf

pdf_path = Path('modules/component_database/microphone/D00186943_V3_DATA SHEET MIC MM20-62249-B66 KNOWLES.pdf')

out_bytes, hl_info = highlight_datasheet_pdf(
    pdf_path,
    page_num=2,
    param_key="sensitivity_1k",
    param_label="Sensitivity @ 1 kHz",
    raw_label="Sensitivity @ 1 kHz",
    val="-56.5",
    min_val="-59.5",
    max_val="-53.5"
)

doc = fitz.open(stream=out_bytes, filetype="pdf")
page = doc[1]
annots = list(page.annots())
print(f"Annotations count: {len(annots)}")
words = page.get_text("words")
for a in annots:
    covered = [w[4] for w in words if fitz.Rect(w[:4]).intersects(a.rect)]
    print(f"  Annot rect: {a.rect} -> Text: {' '.join(covered)}")
