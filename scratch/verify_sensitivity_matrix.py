import urllib.request
import json

# 1. Check schemas
schemas_url = 'http://127.0.0.1:8100/api/component_database/schemas'
with urllib.request.urlopen(schemas_url) as res:
    schemas = json.loads(res.read().decode('utf-8'))
    mic = schemas.get('microphone', {})
    ac_group = next((g for g in mic.get('groups', []) if g.get('id') == 'acoustic'), None)
    print("Acoustic Specifications parameters in schema:")
    for idx, p in enumerate(ac_group.get('parameters', [])[:7], 1):
        print(f"  {idx}. {p['key']}: {p['label']} ({p['unit']})")

# 2. Check component values in matrix order
comps = ['knowles_mm60_63230', 'knowles_mm08_36139', 'knowles_mm20_62249', 'knowles_mm07_62964_b66']
comps_data = []
for cid in comps:
    url = f'http://127.0.0.1:8100/api/component_database/components/{cid}'
    with urllib.request.urlopen(url) as res:
        comps_data.append(json.loads(res.read().decode('utf-8')))

print("\nComparison Matrix Acoustic Specifications Rows:")
for p in ac_group.get('parameters', [])[:6]:
    cells = []
    for c in comps_data:
        spec = next((s for s in c.get('specs', []) if s['param_key'] == p['key']), None)
        if spec:
            nom = spec.get('nom_val')
            mn = spec.get('min_val')
            mx = spec.get('max_val')
            val = nom if (nom and nom != '--') else (f"{mn} ~ {mx}" if (mn and mx) else (mn or mx or 'NA'))
            unit = spec.get('unit') or p.get('unit', '')
            cells.append(f"{val} {unit}".strip())
        else:
            cells.append("NA")
    print(f"  {p['label']:<28} | " + " | ".join(f"{c['part_number']:<15}: {v:<12}" for c, v in zip(comps_data, cells)))
