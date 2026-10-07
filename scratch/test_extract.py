import pdfplumber
from pathlib import Path

pdf_path = Path("modules/component_database/microphone/D00343759_V2_DATA SHEET MIC MM60-63230-B66 KNOWLES.pdf")
with pdfplumber.open(pdf_path) as pdf:
    p4 = pdf.pages[3]
    
    # Try different table settings
    settings_list = [
        {"vertical_strategy": "lines", "horizontal_strategy": "lines"},
        {"vertical_strategy": "text", "horizontal_strategy": "lines"},
        {"snap_tolerance": 5, "join_tolerance": 5},
        {"text_x_tolerance": 3, "text_y_tolerance": 3},
        {"vertical_strategy": "lines", "snap_x_tolerance": 5},
    ]
    
    for idx, s in enumerate(settings_list):
        print(f"=== Setting {idx}: {s} ===")
        tables = p4.extract_tables(table_settings=s)
        if len(tables) > 1:
            for row in tables[1][:4]:
                print("  ", row)
