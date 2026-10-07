import json, re, sqlite3

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
        elif bool(re.search(r'open\s*port', cond, re.I)):
            cleanLabel = f"{cleanLabel} (Open Port)"
        elif bool(re.search(r'blocked\s*port', cond, re.I)):
            cleanLabel = f"{cleanLabel} (Blocked Port)"

    # 1/3rd octave
    isOctaveNoise = bool(re.search(r'1/3(?:rd)?\s*octave', cleanLabel, re.I) or re.search(r'1_3rd_octave', s.get('param_key', ''), re.I))
    if isOctaveNoise:
        fullNoiseStr = f"{cleanLabel} {s.get('param_key', '')} {s.get('condition', '')}".lower()
        if '100' in fullNoiseStr and 'hz' in fullNoiseStr:
            return {'canonKey': 'input_referred_noise_1_3rd_octave_100_hz', 'cleanLabel': 'Input-Referred Noise, 1/3rd Octave 100 Hz', 'unit': s.get('unit') or 'dB SPL'}
        elif '10' in fullNoiseStr and ('khz' in fullNoiseStr or 'k hz' in fullNoiseStr):
            return {'canonKey': 'input_referred_noise_1_3rd_octave_10_khz', 'cleanLabel': 'Input-Referred Noise, 1/3rd Octave 10 kHz', 'unit': s.get('unit') or 'dB SPL'}
        elif ('1' in fullNoiseStr or '1k' in fullNoiseStr) and ('khz' in fullNoiseStr or 'k hz' in fullNoiseStr):
            return {'canonKey': 'input_referred_noise_1_3rd_octave_1_khz', 'cleanLabel': 'Input-Referred Noise, 1/3rd Octave 1 kHz', 'unit': s.get('unit') or 'dB SPL'}

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

print("\n--- BEFORE FIX (rawKeys before canonKey) ---")
for p in extraParams:
    vals = []
    for comp in fullComps:
        found = next((s for s in comp['specs'] if s['param_key'] == p['key']), None)
        if not found and 'rawKeys' in p:
            found = next((s for s in comp['specs'] if s['param_key'] in p['rawKeys']), None)
        if not found:
            found = next((s for s in comp['specs'] if getCanonicalSpecInfo(s)['canonKey'] == p['key']), None)
        vals.append(f"{found['nom_val']} {found['unit']}" if found else "NA")
    print(f"{p['label']}: {' | '.join(vals)}")

print("\n--- AFTER FIX (canonKey before rawKeys) ---")
for p in extraParams:
    vals = []
    for comp in fullComps:
        # 1. Direct match by param_key
        found = next((s for s in comp['specs'] if s['param_key'] == p['key']), None)
        # 2. Canonical key comparison (precise)
        if not found:
            found = next((s for s in comp['specs'] if getCanonicalSpecInfo(s)['canonKey'] == p['key']), None)
        # 3. Fallback: rawKeys ONLY if unique
        if not found and 'rawKeys' in p:
            found = next((s for s in comp['specs'] if s['param_key'] in p['rawKeys']), None)
        vals.append(f"{found['nom_val']} {found['unit']}" if found else "NA")
    print(f"{p['label']}: {' | '.join(vals)}")
