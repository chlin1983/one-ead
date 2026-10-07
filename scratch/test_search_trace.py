import fitz

doc = fitz.open('modules/component_database/microphone/D00186943_V3_DATA SHEET MIC MM20-62249-B66 KNOWLES.pdf')
page = doc[1]

candidates = [
    "Sensitivity @ 1 kHz",
    "Sensitivity @ 1kHz",
    "Sensitivity 1 kHz",
    "Sensitivity @1kHz",
    "1 kHz",
    "sensitivity @ 1kHz",
    "sensitivity @ 1 kHz",
]

words = page.get_text('words')
for c in candidates:
    rects = page.search_for(c)
    print(f"\nCandidate: {repr(c)} -> {len(rects)} match(es)")
    for r in rects:
        # print words on that row
        y_mid = (r.y0 + r.y1) / 2
        row_words = [w[4] for w in words if abs((w[1] + w[3]) / 2 - y_mid) < 7]
        print(f"   Rect: {r} -> Line: {' '.join(row_words)}")
