import sys, os
sys.path.insert(0, os.path.abspath('.'))
import json, re, sqlite3, fitz
from modules.component_database.config import BASE_DIR
from modules.component_database.module import highlight_datasheet_pdf

print("===================================================================")
print("VERIFICATION: Matrix Row Value Matching & Pinpoint PDF Highlighting")
print("===================================================================")

with open('modules/component_database/schemas/microphone.json', 'r', encoding='utf-8') as f:
    schema = json.load(f)

conn = sqlite3.connect('modules/component_database/data/components.db')
c = conn.cursor()

parts = ['MM60-63230-B66', 'MM08-36139-B66', 'MM20-62249-B66']
fullComps = []
for pn in parts:
    row = c.execute("SELECT id, part_number FROM components WHERE part_number=?", (pn,)).fetchone()
    if not row: continue
    cid, part_number = row
    specs_rows = c.execute("SELECT param_key, param_label, min_val, nom_val, max_val, unit, condition, source_page FROM specs WHERE component_id=?", (cid,)).fetchall()
    specs = []
    for s in specs_rows:
        specs.append({
            'param_key': s[0], 'param_label': s[1], 'min_val': s[2], 'nom_val': s[3], 'max_val': s[4], 'unit': s[5], 'condition': s[6], 'source_page': s[7]
        })
    fullComps.append({'id': cid, 'part_number': part_number, 'specs': specs})

def getCanonicalSpecInfo(s):
    if not s: return {'canonKey': '', 'cleanLabel': '', 'unit': ''}
    rawLbl = (s.get('param_label') or s.get('param_key') or '').strip()
    cleanLabel = re.sub(r'^[*•\-–\s]+', '', rawLbl).strip()

    # Frequency check
    hasFreq = bool(re.search(r'\b\d+(?:\.\d+)?\s*(?:k?hz|g?hz)\b', cleanLabel, re.I))
    if not hasFreq and bool(re.search(r'(?:octave|noise|vibration|sensitivity|psrr|phase)', cleanLabel, re.I)):
        cond = s.get('condition') or ''
        mFreq = re.search(r'@?\s*(10\s*k?hz|1\s*k?hz|100\s*hz|30\s*hz|250\s*hz)', cond, re.I)
        if mFreq:
            freqStr = re.sub(r'(\d+)\s*(k?hz)', r'\1 \2', mFreq.group(1).strip(), flags=re.I)
            freqStr = re.sub(r'khz', 'kHz', freqStr, flags=re.I)
            freqStr = re.sub(r'hz', 'Hz', freqStr, flags=re.I)
            cleanLabel = f"{cleanLabel} {freqStr}"

    # Vibration axis/port clarification
    if bool(re.search(r'vibration', cleanLabel, re.I)) and not bool(re.search(r'[xyz]\s*axis', cleanLabel, re.I)):
        cond = s.get('condition') or ''
        mAxis = re.search(r'\b([xyz])[- ]?axis\b', cond, re.I)
        if mAxis:
            cleanLabel = f"{cleanLabel} {mAxis.group(1).upper()} axis"
        elif bool(re.search(r'open\s*port', cond, re.I)) and not bool(re.search(r'open\s*port', cleanLabel, re.I)):
            cleanLabel = f"{cleanLabel} (Open Port)"
        elif bool(re.search(r'blocked\s*port', cond, re.I)) and not bool(re.search(r'blocked\s*port', cleanLabel, re.I)):
            cleanLabel = f"{cleanLabel} (Blocked Port)"

    # EMI
    isEmi = bool(re.search(r'emi', cleanLabel, re.I) or re.search(r'emi', s.get('param_key', ''), re.I))
    if isEmi:
        fullEmiStr = f"{cleanLabel} {s.get('param_key', '')} {s.get('condition', '')}".lower()
        if '0.7' in fullEmiStr and '0.96' in fullEmiStr:
            return {'canonKey': 'input_referred_emi_0_7_0_96_ghz', 'cleanLabel': 'Input-Referred EMI Noise 0.7-0.96 GHz', 'unit': s.get('unit') or 'dB SPL'}
        elif '1.4' in fullEmiStr and '2.0' in fullEmiStr:
            return {'canonKey': 'input_referred_emi_1_4_2_0_ghz', 'cleanLabel': 'Input-Referred EMI Noise 1.4-2.0 GHz', 'unit': s.get('unit') or 'dB SPL'}
        elif '2.0' in fullEmiStr and '2.7' in fullEmiStr:
            return {'canonKey': 'input_referred_emi_2_0_2_7_ghz', 'cleanLabel': 'Input-Referred EMI Noise 2.0-2.7 GHz', 'unit': s.get('unit') or 'dB SPL'}

    canonKey = re.sub(r'[^a-z0-9]+', '_', cleanLabel.lower()).strip('_')
    return {'canonKey': canonKey, 'cleanLabel': cleanLabel, 'unit': s.get('unit', '')}

schemaKeySet = set()
for g in schema['groups']:
    for p in g['parameters']:
        schemaKeySet.add(p['key'])

extraSpecsMap = {}
for comp in fullComps:
    for s in comp['specs']:
        canon = getCanonicalSpecInfo(s)
        if s['param_key'] not in schemaKeySet and canon['canonKey'] not in schemaKeySet:
            if canon['canonKey'] not in extraSpecsMap:
                extraSpecsMap[canon['canonKey']] = {
                    'key': canon['canonKey'],
                    'label': canon['cleanLabel'],
                    'unit': canon['unit'],
                    'rawKeys': {s['param_key']}
                }
            else:
                existing = extraSpecsMap[canon['canonKey']]
                existing['rawKeys'].add(s['param_key'])
                if not existing['unit'] and canon['unit']:
                    existing['unit'] = canon['unit']

extraParams = list(extraSpecsMap.values())
emiOrder = [
    'input_referred_emi_0_7_0_96_ghz',
    'input_referred_emi_1_4_2_0_ghz',
    'input_referred_emi_2_0_2_7_ghz'
]
extraParams.sort(key=lambda x: emiOrder.index(x['key']) if x['key'] in emiOrder else 999)

print("\n--- MATRIX EXTRA SPECS ---")
for p in extraParams:
    vals = []
    for comp in fullComps:
        found = next((s for s in comp['specs'] if s['param_key'] == p['key']), None)
        if not found:
            found = next((s for s in comp['specs'] if getCanonicalSpecInfo(s)['canonKey'] == p['key']), None)
        if not found and 'rawKeys' in p:
            found = next((s for s in comp['specs'] if s['param_key'] in p['rawKeys'] and (not getCanonicalSpecInfo(s)['canonKey'] or getCanonicalSpecInfo(s)['canonKey'] == p['key'])), None)
        vals.append(f"{found['nom_val']} {found['unit']}" if found else "NA")
    print(f"  {p['label']}: {' | '.join(vals)}")

# Assertions for correct values
open_port_row = next(p for p in extraParams if 'Open Port' in p['label'])
blocked_port_row = next(p for p in extraParams if 'Blocked Port' in p['label'])

mm20_open = next((s for s in fullComps[2]['specs'] if getCanonicalSpecInfo(s)['canonKey'] == open_port_row['key'] or s['param_key'] == open_port_row['key']), None)
mm20_blocked = next((s for s in fullComps[2]['specs'] if getCanonicalSpecInfo(s)['canonKey'] == blocked_port_row['key'] or s['param_key'] == blocked_port_row['key']), None)

print(f"\nVerification MM20: Open Port = {mm20_open['nom_val']}, Blocked Port = {mm20_blocked['nom_val']}")
assert float(mm20_open['nom_val']) == 65.0, "MM20 Open Port MUST BE 65.0 dB SPL!"
assert float(mm20_blocked['nom_val']) == 54.0, "MM20 Blocked Port MUST BE 54.0 dB SPL!"

# 2. Test Highlighting for Open Port and Blocked Port on MM20
pdf_path = BASE_DIR / 'microphone' / 'D00186943_V3_DATA SHEET MIC MM20-62249-B66 KNOWLES.pdf'

print("\n--- PDF HIGHLIGHT: MM20 OPEN PORT ---")
pdf_bytes, hl = highlight_datasheet_pdf(
    pdf_path=pdf_path,
    page_num=2,
    param_key='input_referred_vibration_1_khz_open_port',
    param_label='Input Referred Vibration 1 kHz (Open Port)',
    raw_label='Input Referred Vibration',
    val='65.0',
    min_val=None,
    max_val=None,
    category='microphone'
)
print(f"  Highlight info: {hl}")
doc = fitz.open(stream=pdf_bytes, filetype="pdf")
annots = list(doc[1].annots())
for i, a in enumerate(annots):
    words = [w[4] for w in doc[1].get_text("words") if fitz.Rect(w[:4]).intersects(a.rect)]
    print(f"  Annot {i}: words={' '.join(words)}, rect={a.rect}")
val_words = [w[4] for w in doc[1].get_text("words") if fitz.Rect(w[:4]).intersects(annots[1].rect)]
assert any('65' in w for w in val_words), f"65 must be highlighted for Open Port! Got: {val_words}"

print("\n--- PDF HIGHLIGHT: MM20 BLOCKED PORT ---")
pdf_bytes2, hl2 = highlight_datasheet_pdf(
    pdf_path=pdf_path,
    page_num=2,
    param_key='input_referred_vibration_1_khz_blocked_port',
    param_label='Input Referred Vibration 1 kHz (Blocked Port)',
    raw_label='Input Referred Vibration',
    val='54.0',
    min_val=None,
    max_val=None,
    category='microphone'
)
print(f"  Highlight info: {hl2}")
doc2 = fitz.open(stream=pdf_bytes2, filetype="pdf")
annots2 = list(doc2[1].annots())
for i, a in enumerate(annots2):
    words = [w[4] for w in doc2[1].get_text("words") if fitz.Rect(w[:4]).intersects(a.rect)]
    print(f"  Annot {i}: words={' '.join(words)}, rect={a.rect}")
val_words2 = [w[4] for w in doc2[1].get_text("words") if fitz.Rect(w[:4]).intersects(annots2[1].rect)]
assert any('54' in w for w in val_words2), f"54 must be highlighted for Blocked Port! Got: {val_words2}"

print("\nALL VERIFICATIONS PASSED 100% PERFECTLY!")
