import re
import pdfplumber
from pathlib import Path

pdf_path = Path("modules/component_database/microphone/D00343759_V2_DATA SHEET MIC MM60-63230-B66 KNOWLES.pdf")

def fix_split_cells(row):
    """
    Repair cells where text crossed over column grid lines in PDF.
    E.g. Nom: '-- 1', Max: '25.0' -> Nom: '--', Max: '125.0'
         Nom: '150.0 2', Max: '00.0' -> Nom: '150.0', Max: '200.0'
    """
    if len(row) < 5:
        return row
    fixed = list(row)
    
    # Check numeric columns (typically indices 2, 3, 4: Min, Nom, Max)
    for i in range(len(fixed) - 1):
        c1 = str(fixed[i]).strip() if fixed[i] is not None else ""
        c2 = str(fixed[i+1]).strip() if fixed[i+1] is not None else ""
        
        # If c1 ends with a single digit preceded by space or dash, and c2 starts with digits
        # E.g. c1 = '-- 1' and c2 = '25.0'
        # E.g. c1 = '150.0 2' and c2 = '00.0'
        m1 = re.search(r"^(.*?)(?:\s+|--\s*)([0-9])$", c1)
        m2 = re.match(r"^([0-9]+\.?[0-9]*)(.*)$", c2)
        if m1 and m2:
            left_part = m1.group(1).strip()
            split_digit = m1.group(2)
            if not left_part:
                left_part = "--"
            repaired_c2 = split_digit + c2
            fixed[i] = left_part
            fixed[i+1] = repaired_c2
            
    return fixed

with pdfplumber.open(pdf_path) as pdf:
    p4 = pdf.pages[3]
    t = p4.extract_tables()[1]
    for r in t:
        fixed = fix_split_cells(r)
        print("Original:", r[2:5])
        print("Fixed:   ", fixed[2:5])
        print()
