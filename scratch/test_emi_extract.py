import sys
sys.path.insert(0, '.')
from modules.component_database.parsers import process_datasheet_pdf
from pathlib import Path

for fname in ['D00343759_V2_DATA SHEET MIC MM60-63230-B66 KNOWLES.pdf', 'MM08-36139-B66 Rev 5 preliminary datasheet.pdf', 'D00186943_V3_DATA SHEET MIC MM20-62249-B66 KNOWLES.pdf']:
    path = Path(f'modules/component_database/microphone/{fname}')
    items = process_datasheet_pdf(path, 'microphone')
    print(f'=== {fname} ===')
    for item in items:
        if 'emi' in item['raw_label'].lower() or 'emi' in item['param_key'].lower() or 'ghz' in item['raw_label'].lower():
            print(f"  key={item['param_key']}, raw={item['raw_label']}, nom={item['nom']}, min={item['min']}, max={item['max']}, unit={item['unit']}, cond={item['condition']}")
