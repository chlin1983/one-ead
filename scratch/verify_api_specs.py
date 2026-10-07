import urllib.request
import json

comps = ['knowles_mm60_63230', 'knowles_mm08_36139', 'knowles_mm20_62249', 'knowles_mm07_62964_b66']
for cid in comps:
    url = f'http://127.0.0.1:8100/api/component_database/components/{cid}'
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req) as res:
        c = json.loads(res.read().decode('utf-8'))
        noise_specs = [s for s in c.get('specs', []) if 'noise' in s.get('param_key', '').lower()]
        print(f"  {c['id']}: {c['part_number']} - {len(c.get('specs', []))} specs, {len(noise_specs)} noise specs")
        for ns in noise_specs:
            print(f"      key={ns['param_key']}, label={ns['param_label']}, nom={ns['nom_val']}, cond={ns['condition']}")
