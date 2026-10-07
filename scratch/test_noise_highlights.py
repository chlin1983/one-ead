import sys
sys.path.insert(0, '.')
from modules.component_database.module import highlight_datasheet_pdf, DATASHEETS_VAULT, BASE_DIR
from pathlib import Path

tests = [
    ('knowles_mm60_63230', 'D00343759_V2_DATA SHEET MIC MM60-63230-B66 KNOWLES.pdf', 2, 'input_referred_noise_1_3rd_octave_100_hz', 'Input-Referred Noise, 1/3rd Octave 100 Hz', '12.0', 'Input-Referred Noise, 1/3rd Octave 100 Hz'),
    ('knowles_mm08_36139', 'MM08-36139-B66 Rev 5 preliminary datasheet.pdf', 2, 'input_referred_noise_1_3rd_octave_100_hz', 'Input-Referred Noise, 1/3rd Octave 100 Hz', '16.5', 'Input-Referred Noise, 1/3rd Octave 100 Hz'),
    ('knowles_mm20_62249', 'D00186943_V3_DATA SHEET MIC MM20-62249-B66 KNOWLES.pdf', 2, 'input_referred_noise_1_3rd_octave_100_hz', 'Input-Referred Noise, 1/3rd Octave 100 Hz', '15.0', 'Input-Referred Noise, 1/3rd Octave 100 Hz'),
    ('knowles_mm20_62249', 'D00186943_V3_DATA SHEET MIC MM20-62249-B66 KNOWLES.pdf', 2, 'input_referred_noise_1_3rd_octave_100_hz', 'Input-Referred Noise, 1/3rd Octave 100 Hz', '15.0', 'Input-Referred Noise, 1/3rd Octave'),
    ('knowles_mm20_62249', 'D00186943_V3_DATA SHEET MIC MM20-62249-B66 KNOWLES.pdf', 2, 'input_referred_noise_1_3rd_octave_1_khz', 'Input-Referred Noise, 1/3rd Octave 1 kHz', '10.0', 'Input-Referred Noise, 1/3rd Octave 1 kHz'),
    ('knowles_mm20_62249', 'D00186943_V3_DATA SHEET MIC MM20-62249-B66 KNOWLES.pdf', 2, 'input_referred_noise_1_3rd_octave_10_khz', 'Input-Referred Noise, 1/3rd Octave 10 kHz', '14.0', 'Input-Referred Noise, 1/3rd Octave 10 kHz'),
]

mic_dir = BASE_DIR / 'microphone'
for comp_id, fname, page, key, lbl, val, raw in tests:
    pdf_path = mic_dir / fname
    _, hl = highlight_datasheet_pdf(pdf_path, page_num=page, param_key=key, param_label=lbl, raw_label=raw, val=val)
    print(f'{comp_id} ({key}) -> has_hl: {hl["has_highlight"]}, y: {hl["y"]:.1f}, ratio: {hl["ratio"]:.4f}')
