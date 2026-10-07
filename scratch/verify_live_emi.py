import urllib.request
import json

# 1. Verify /schemas
schemas_url = 'http://127.0.0.1:8100/api/component_database/schemas'
with urllib.request.urlopen(schemas_url) as res:
    schemas = json.loads(res.read().decode('utf-8'))
    mic_schema = schemas.get('microphone', {})
    emi_params = []
    for g in mic_schema.get('groups', []):
        for p in g.get('parameters', []):
            if 'emi' in p.get('key', ''):
                emi_params.append(p)
    print(f"Schemas EMI parameters ({len(emi_params)}):")
    for ep in emi_params:
        print(f"  {ep['key']}: {ep['label']} ({ep['unit']}) cond={ep.get('default_conditions')}")

# 2. Verify /components/{id}
comps = ['knowles_mm60_63230', 'knowles_mm08_36139', 'knowles_mm20_62249', 'knowles_mm07_62964_b66']
print("\nComponents EMI specs in API:")
for cid in comps:
    url = f'http://127.0.0.1:8100/api/component_database/components/{cid}'
    with urllib.request.urlopen(url) as res:
        c = json.loads(res.read().decode('utf-8'))
        emi_specs = [s for s in c.get('specs', []) if 'emi' in s.get('param_key', '').lower()]
        print(f"\n  === {c['id']} ({c['part_number']}): {len(emi_specs)} EMI specs ===")
        for s in emi_specs:
            print(f"    key={s['param_key']}, label={s['param_label']}, nom={s['nom_val']}, max={s['max_val']}, cond={s['condition']}, page={s['source_page']}")
