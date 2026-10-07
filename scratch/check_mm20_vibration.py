import sqlite3

conn = sqlite3.connect('modules/component_database/data/components.db')
c = conn.cursor()

rows = c.execute("""
    SELECT s.id, s.param_key, s.param_label, s.min_val, s.nom_val, s.max_val, s.unit, s.condition, s.source_page
    FROM specs s
    JOIN components c ON s.component_id = c.id
    WHERE c.part_number = 'MM20-62249-B66'
    AND (s.param_label LIKE '%vibration%' OR s.param_key LIKE '%vibration%')
""").fetchall()

print("MM20 Vibration specs in DB:")
for r in rows:
    print(r)

all_vibs = c.execute("""
    SELECT c.part_number, s.id, s.param_key, s.param_label, s.min_val, s.nom_val, s.max_val, s.unit, s.condition, s.source_page
    FROM specs s
    JOIN components c ON s.component_id = c.id
    WHERE s.param_label LIKE '%vibration%' OR s.param_key LIKE '%vibration%'
""").fetchall()

print("\nAll Vibration specs in DB:")
for r in all_vibs:
    print(r)
