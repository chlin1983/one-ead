import sqlite3

conn = sqlite3.connect('modules/component_database/data/components.db')
cur = conn.cursor()
cur.execute("SELECT component_id, param_key, param_label, nom_val, unit, condition, source_page FROM specs WHERE param_key LIKE '%port%' OR param_key LIKE '%dim%'")
rows = cur.fetchall()
print(f"Found {len(rows)} rows:")
for r in rows:
    print(r)
