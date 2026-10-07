import sys, os
sys.path.insert(0, os.path.abspath('.'))
import fitz
from modules.component_database.config import DATASHEETS_VAULT, BASE_DIR
from modules.component_database.module import highlight_datasheet_pdf

pdf_path = BASE_DIR / 'microphone' / 'D00186943_V3_DATA SHEET MIC MM20-62249-B66 KNOWLES.pdf'

print("--- Testing Open Port (val=65.0) ---")
pdf_bytes, hl_info = highlight_datasheet_pdf(
    pdf_path=pdf_path,
    page_num=2,
    param_key='input_referred_vibration',
    param_label='Input Referred Vibration 1 kHz (Open Port)',
    raw_label='Input Referred Vibration',
    val='65.0',
    min_val=None,
    max_val=None,
    category='microphone'
)
print("Open Port hl_info:", hl_info)

# Check what text is inside the highlighted rects
doc = fitz.open(stream=pdf_bytes, filetype="pdf")
page = doc[1]
annots = list(page.annots())
print(f"Number of annots: {len(annots)}")
for i, a in enumerate(annots):
    r = a.rect
    words_in_r = [w[4] for w in page.get_text("words") if fitz.Rect(w[:4]).intersects(r)]
    print(f"  Annot {i}: rect={r}, words={' '.join(words_in_r)}")

print("\n--- Testing Blocked Port (val=54.0) ---")
pdf_bytes2, hl_info2 = highlight_datasheet_pdf(
    pdf_path=pdf_path,
    page_num=2,
    param_key='input_referred_vibration',
    param_label='Input Referred Vibration 1 kHz (Blocked Port)',
    raw_label='Input Referred Vibration',
    val='54.0',
    min_val=None,
    max_val=None,
    category='microphone'
)
print("Blocked Port hl_info:", hl_info2)
doc2 = fitz.open(stream=pdf_bytes2, filetype="pdf")
page2 = doc2[1]
annots2 = list(page2.annots())
print(f"Number of annots: {len(annots2)}")
for i, a in enumerate(annots2):
    r = a.rect
    words_in_r = [w[4] for w in page2.get_text("words") if fitz.Rect(w[:4]).intersects(r)]
    print(f"  Annot {i}: rect={r}, words={' '.join(words_in_r)}")
