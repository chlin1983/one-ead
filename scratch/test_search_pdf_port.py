import fitz
from pathlib import Path

pdf_dir = Path('modules/component_database/microphone')

for pdf_file in sorted(pdf_dir.glob('*.pdf')):
    doc = fitz.open(pdf_file)
    print(f"\n--- {pdf_file.name} (pages: {len(doc)}) ---")
    for p_no in range(len(doc)):
        page = doc[p_no]
        # search for acoustic port
        res1 = page.search_for("Acoustic port dimension")
        res2 = page.search_for("Acoustic Port")
        res3 = page.search_for("Acoustic Port (AP)")
        res4 = page.search_for("port dimension")
        if res1 or res2 or res3 or res4:
            print(f"Page {p_no + 1}:")
            if res1: print(f"  'Acoustic port dimension': {res1}")
            if res2: print(f"  'Acoustic Port': {res2}")
            if res3: print(f"  'Acoustic Port (AP)': {res3}")
            if res4: print(f"  'port dimension': {res4}")
            # print words around here
            words = page.get_text("words")
            y_ref = (res1 or res2 or res3 or res4)[0].y0
            nearby = [w for w in words if abs(w[1] - y_ref) < 15]
            print(f"  Nearby line words: {[w[4] for w in nearby]}")
