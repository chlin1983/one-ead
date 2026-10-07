import sys, os
sys.path.insert(0, os.path.abspath('.'))
import fitz
from modules.component_database.config import BASE_DIR
from modules.component_database.module import highlight_datasheet_pdf

pdf_path = BASE_DIR / 'microphone' / 'D00186943_V3_DATA SHEET MIC MM20-62249-B66 KNOWLES.pdf'

print("=== 1. TEST OPEN PORT (val=65.0) ===")
pdf_bytes_open, hl_open = highlight_datasheet_pdf(
    pdf_path=pdf_path,
    page_num=2,
    param_key='input_referred_vibration_1_khz_open_port',
    param_label='Input Referred Vibration 1 kHz (Open Port)',
    raw_label='Input Referred Vibration',
    val='65.0',
    min_val=None,
    max_val=None,
    category='microphone'
)
print("hl_open:", hl_open)
doc_open = fitz.open(stream=pdf_bytes_open, filetype="pdf")
for i, a in enumerate(doc_open[1].annots()):
    words = [w[4] for w in doc_open[1].get_text("words") if fitz.Rect(w[:4]).intersects(a.rect)]
    print(f"  Annot {i}: rect={a.rect}, words={' '.join(words)}")

print("\n=== 2. TEST BLOCKED PORT (val=54.0) ===")
pdf_bytes_blocked, hl_blocked = highlight_datasheet_pdf(
    pdf_path=pdf_path,
    page_num=2,
    param_key='input_referred_vibration_1_khz_blocked_port',
    param_label='Input Referred Vibration 1 kHz (Blocked Port)',
    raw_label='Input Referred Vibration',
    val='54.0',
    min_val=None,
    max_val=None,
    category='microphone'
)
print("hl_blocked:", hl_blocked)
doc_blocked = fitz.open(stream=pdf_bytes_blocked, filetype="pdf")
for i, a in enumerate(doc_blocked[1].annots()):
    words = [w[4] for w in doc_blocked[1].get_text("words") if fitz.Rect(w[:4]).intersects(a.rect)]
    print(f"  Annot {i}: rect={a.rect}, words={' '.join(words)}")
