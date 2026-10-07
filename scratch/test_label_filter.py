import sys, os
sys.path.insert(0, os.path.abspath('.'))
import fitz, re
from modules.component_database.config import BASE_DIR

pdf_path = BASE_DIR / 'microphone' / 'D00186943_V3_DATA SHEET MIC MM20-62249-B66 KNOWLES.pdf'
doc = fitz.open(str(pdf_path))
page = doc[1]
words = page.get_text('words')

raw_query = "input referred vibration"
q_tokens = {"input", "referred", "vibration"}

# For Blocked Port: y_mid = 489.25
y_mid = 489.25

nearby_w = [
    w for w in words
    if w[0] < 185
    and abs((w[1] + w[3]) / 2 - y_mid) <= 22 and w[4].strip() not in ("-", "--", "*", "•")
    and not re.match(r"^[-+]?\d*\.?\d+$", w[4].strip())
]
print("All nearby words within 22pt:")
for w in nearby_w:
    print(f"  {w[4]} (y={(w[1]+w[3])/2:.1f})")

matching_w = [w for w in nearby_w if re.sub(r"[^a-z0-9]", "", w[4].lower()) in q_tokens]
print("Matching query tokens words:")
for w in matching_w:
    print(f"  {w[4]} (y={(w[1]+w[3])/2:.1f})")

if matching_w:
    target_line_y = sum((w[1] + w[3]) / 2 for w in matching_w) / len(matching_w)
    chosen_lbl_w = [w for w in nearby_w if abs((w[1] + w[3]) / 2 - target_line_y) <= 8]
else:
    closest_w = min(nearby_w, key=lambda w: abs((w[1] + w[3]) / 2 - y_mid))
    line_y = (closest_w[1] + closest_w[3]) / 2
    chosen_lbl_w = [w for w in nearby_w if abs((w[1] + w[3]) / 2 - line_y) <= 8]

print("Filtered chosen_lbl_w:")
for w in chosen_lbl_w:
    print(f"  {w[4]} (y={(w[1]+w[3])/2:.1f})")
print("Rect:", min(w[0] for w in chosen_lbl_w), min(w[1] for w in chosen_lbl_w), max(w[2] for w in chosen_lbl_w), max(w[3] for w in chosen_lbl_w))
