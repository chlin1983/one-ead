import sqlite3, re

conn = sqlite3.connect('modules/component_database/data/components.db')
c = conn.cursor()

def get_canonical_spec_info(param_key, param_label, condition):
    lbl = (param_label or param_key or '').strip()
    lbl = re.sub(r'^[*•\-–\s]+', '', lbl)
    
    # Check if frequency already in lbl
    has_freq = bool(re.search(r'\b\d+(?:\.\d+)?\s*(?:k?hz|g?hz)\b', lbl, re.IGNORECASE))
    
    # If no frequency in label, check condition or param_key
    if not has_freq and re.search(r'(?:octave|noise|vibration|sensitivity|psrr|phase)', lbl, re.IGNORECASE):
        cond = condition or ''
        m = re.search(r'@?\s*(10\s*k?hz|1\s*k?hz|100\s*hz|30\s*hz|250\s*hz)', cond, re.IGNORECASE)
        if m:
            freq_str = m.group(1).strip()
            freq_str = re.sub(r'(\d+)\s*(k?hz)', r'\1 \2', freq_str, flags=re.IGNORECASE)
            lbl = f'{lbl} {freq_str}'
            
    if 'vibration' in lbl.lower() and not re.search(r'[xyz]\s*axis', lbl, re.IGNORECASE):
        cond = condition or ''
        m_axis = re.search(r'\b([xyz])[- ]?axis\b', cond, re.IGNORECASE)
        if m_axis:
            lbl = f'{lbl} {m_axis.group(1).upper()} axis'
        elif 'open port' in cond.lower():
            lbl = f'{lbl} (Open Port)'
        elif 'blocked port' in cond.lower():
            lbl = f'{lbl} (Blocked Port)'
            
    canon_key = re.sub(r'[^a-zA-Z0-9]+', '_', lbl).strip('_').lower()
    return canon_key, lbl

all_specs = c.execute('SELECT component_id, param_key, param_label, condition, nom_val FROM specs').fetchall()
canon_map = {}
for comp_id, k, l, cond, nom in all_specs:
    ck, cl = get_canonical_spec_info(k, l, cond)
    if ck not in canon_map:
        canon_map[ck] = {'label': cl, 'comps': {}}
    canon_map[ck]['comps'][comp_id] = nom

print(f'Total distinct canonical specs: {len(canon_map)}')
for ck, data in canon_map.items():
    if len(data['comps']) > 1 or 'noise' in ck or 'octave' in ck or 'vibrat' in ck:
        print(f'{ck} -> \"{data["label"]}\": {data["comps"]}')
