import sys
sys.path.insert(0, '.')
from modules.component_database.module import highlight_datasheet_pdf, BASE_DIR

mic_dir = BASE_DIR / 'microphone'

tests = [
    # MM60
    ('knowles_mm60_63230', 'D00343759_V2_DATA SHEET MIC MM60-63230-B66 KNOWLES.pdf', 2, 'input_referred_emi_0_7_0_96_ghz', 'Input-Referred EMI Noise 0.7-0.96 GHz', 'Input-Referred EMI Noise 0.7-0.96 GHz', '7.0'),
    ('knowles_mm60_63230', 'D00343759_V2_DATA SHEET MIC MM60-63230-B66 KNOWLES.pdf', 2, 'input_referred_emi_1_4_2_0_ghz', 'Input-Referred EMI Noise 1.4-2.0 GHz', 'Input-Referred EMI Noise 1.4-2.0 GHz', '1.0'),
    ('knowles_mm60_63230', 'D00343759_V2_DATA SHEET MIC MM60-63230-B66 KNOWLES.pdf', 2, 'input_referred_emi_2_0_2_7_ghz', 'Input-Referred EMI Noise 2.0-2.7 GHz', 'Input-Referred EMI Noise 2.0-2.7 GHz', '1.0'),

    # MM08
    ('knowles_mm08_36139', 'MM08-36139-B66 Rev 5 preliminary datasheet.pdf', 2, 'input_referred_emi_0_7_0_96_ghz', 'Input-Referred EMI Noise 0.7-0.96 GHz', 'Input-Referred EMI Noise 0.7-0.96 GHz', 'TBD'),
    ('knowles_mm08_36139', 'MM08-36139-B66 Rev 5 preliminary datasheet.pdf', 2, 'input_referred_emi_1_4_2_0_ghz', 'Input-Referred EMI Noise 1.4-2.0 GHz', 'Input-Referred EMI Noise 1.4-2.0 GHz', 'TBD'),
    ('knowles_mm08_36139', 'MM08-36139-B66 Rev 5 preliminary datasheet.pdf', 2, 'input_referred_emi_2_0_2_7_ghz', 'Input-Referred EMI Noise 2.0-2.7 GHz', 'Input-Referred EMI Noise 2.0-2.7 GHz', 'TBD'),

    # MM20
    ('knowles_mm20_62249', 'D00186943_V3_DATA SHEET MIC MM20-62249-B66 KNOWLES.pdf', 2, 'input_referred_emi_0_7_0_96_ghz', 'Input-Referred EMI Noise 0.7-0.96 GHz', 'Input-Referred EMI 0.70-0.96 GHz 90 V/m', '25.0'),
    ('knowles_mm20_62249', 'D00186943_V3_DATA SHEET MIC MM20-62249-B66 KNOWLES.pdf', 2, 'input_referred_emi_1_4_2_0_ghz', 'Input-Referred EMI Noise 1.4-2.0 GHz', 'Input-Referred EMI 1.4-2.0 GHz 50 V/m', '15.0'),
    ('knowles_mm20_62249', 'D00186943_V3_DATA SHEET MIC MM20-62249-B66 KNOWLES.pdf', 2, 'input_referred_emi_2_0_2_7_ghz', 'Input-Referred EMI Noise 2.0-2.7 GHz', 'Input-Referred EMI 2.0-2.7 GHz 35V/m', '15.0'),
]

for comp_id, fname, page, key, lbl, raw, val in tests:
    pdf_path = mic_dir / fname
    _, hl = highlight_datasheet_pdf(pdf_path, page_num=page, param_key=key, param_label=lbl, raw_label=raw, val=val)
    print(f'{comp_id} [{key}] val={val} -> has_hl: {hl["has_highlight"]}, y: {hl["y"]:.1f}, ratio: {hl["ratio"]:.4f}')
