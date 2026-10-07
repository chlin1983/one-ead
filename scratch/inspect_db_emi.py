import sqlite3

conn = sqlite3.connect('modules/component_database/data/components.db')
c = conn.cursor()
rows = c.execute("SELECT id, component_id, param_key, param_label, condition, nom_val, min_val, max_val, unit, source_page FROM specs WHERE param_key LIKE '%emi%' OR param_label LIKE '%emi%'").fetchall()
print(f'Total EMI rows in DB: {len(rows)}')
for r in rows:
    print(r)
