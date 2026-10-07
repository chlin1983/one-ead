import urllib.request
import json
import re

# Fetch components
comps_data = []
for cid in ['knowles_mm60_63230', 'knowles_mm08_36139', 'knowles_mm20_62249', 'knowles_mm07_62964_b66']:
    url = f'http://127.0.0.1:8100/api/component_database/components/{cid}'
    with urllib.request.urlopen(url) as res:
        comps_data.append(json.loads(res.read().decode('utf-8')))

# Fetch schema
with urllib.request.urlopen('http://127.0.0.1:8100/api/component_database/schemas') as res:
    schemas = json.loads(res.read().decode('utf-8'))
schema = schemas.get('microphone', {})

# Python mirror of getCanonicalSpecInfo
def get_canonical_spec_info(s):
    if not s:
        return {'canon_key': '', 'clean_label': '', 'unit': ''}
    raw_lbl = (s.get('param_label') or s.get('param_key') or '').strip()
    clean_label = re.sub(r'^[*•\-–\s]+', '', raw_lbl).strip()

    is_emi = bool(re.search(r'emi', clean_label, re.IGNORECASE) or re.search(r'emi', s.get('param_key') or '', re.IGNORECASE))
    if is_emi:
        full_emi = f"{clean_label} {s.get('param_key') or ''} {s.get('condition') or ''}".lower()
        if '0.7' in full_emi and '0.96' in full_emi:
            return {'canon_key': 'input_referred_emi_0_7_0_96_ghz', 'clean_label': 'Input-Referred EMI Noise 0.7-0.96 GHz', 'unit': s.get('unit') or 'dB SPL'}
        elif '1.4' in full_emi and '2.0' in full_emi:
            return {'canon_key': 'input_referred_emi_1_4_2_0_ghz', 'clean_label': 'Input-Referred EMI Noise 1.4-2.0 GHz', 'unit': s.get('unit') or 'dB SPL'}
        elif '2.0' in full_emi and '2.7' in full_emi:
            return {'canon_key': 'input_referred_emi_2_0_2_7_ghz', 'clean_label': 'Input-Referred EMI Noise 2.0-2.7 GHz', 'unit': s.get('unit') or 'dB SPL'}

    canon_key = re.sub(r'[^a-z0-9]+', '_', clean_label.lower()).strip('_')
    return {'canon_key': canon_key, 'clean_label': clean_label, 'unit': s.get('unit') or ''}

# Collect schema keys
schema_key_set = set()
for g in schema.get('groups', []):
    for p in g.get('parameters', []):
        schema_key_set.add(p['key'])

# Verify matching for the 3 EMI parameters in schema
for g in schema.get('groups', []):
    for p in g.get('parameters', []):
        if 'emi' in p['key']:
            row_cells = []
            for comp in comps_data:
                # 1. Direct match
                found = next((s for s in comp.get('specs', []) if s['param_key'] == p['key']), None)
                # 2. Canonical key match
                if not found:
                    found = next((s for s in comp.get('specs', []) if get_canonical_spec_info(s)['canon_key'] == p['key']), None)
                if found:
                    val = found.get('nom_val') or found.get('min_val') or found.get('max_val') or 'NA'
                    unit = found.get('unit') or p.get('unit', '')
                    row_cells.append(f"{val} {unit}".strip())
                else:
                    row_cells.append("NA")
            print(f"ROW: {p['label']:<40} | " + " | ".join(f"{c.get('part_number'):<15}: {v:<12}" for c, v in zip(comps_data, row_cells)))
