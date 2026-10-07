import sys
sys.path.insert(0, '.')
from modules.component_database.module import highlight_datasheet_pdf, BASE_DIR

mic_dir = BASE_DIR / 'microphone'

# MM07 Sensitivity @ 30 Hz
pdf_path_mm07 = mic_dir / 'D21027116_V1_DATA SHEET MIC MM07-62964-B66 KNOWLES.pdf'
_, hl_07 = highlight_datasheet_pdf(pdf_path_mm07, page_num=2, param_key='sensitivity_30hz', param_label='Sensitivity @ 30 Hz', raw_label='Sensitivity @ 30 Hz', val='-3.0')
print(f"MM07 sensitivity_30hz -> ok: {hl_07['has_highlight']}, y: {hl_07['y']:.1f}, ratio: {hl_07['ratio']:.4f}")

# MM20 Sensitivity Peak 1 kHz
pdf_path_mm20 = mic_dir / 'D00186943_V3_DATA SHEET MIC MM20-62249-B66 KNOWLES.pdf'
_, hl_20 = highlight_datasheet_pdf(pdf_path_mm20, page_num=2, param_key='sensitivity_peak', param_label='Sensitivity Peak 1 kHz', raw_label='Sensitivity Peak 1 kHz', val='8.0')
print(f"MM20 sensitivity_peak -> ok: {hl_20['has_highlight']}, y: {hl_20['y']:.1f}, ratio: {hl_20['ratio']:.4f}")
