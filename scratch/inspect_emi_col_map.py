import sys
sys.path.insert(0, '.')
import pdfplumber
from modules.component_database.parsers.table_extractor import identify_column_roles

for fname in ['D00343759_V2_DATA SHEET MIC MM60-63230-B66 KNOWLES.pdf', 'MM08-36139-B66 Rev 5 preliminary datasheet.pdf', 'D00186943_V3_DATA SHEET MIC MM20-62249-B66 KNOWLES.pdf']:
    print(f'=== {fname} ===')
    with pdfplumber.open(f'modules/component_database/microphone/{fname}') as pdf:
        p = pdf.pages[1]
        tables = p.extract_tables()
        for t_idx, t in enumerate(tables):
            header = t[0] if t else []
            col_map = identify_column_roles(header)
            for r_idx, row in enumerate(t):
                row_str = ' '.join(str(c) for c in row if c)
                if 'emi' in row_str.lower() or 'ghz' in row_str.lower():
                    print(f'  [T{t_idx} R{r_idx}] col_map={col_map}')
                    print(f'    row={row}')
