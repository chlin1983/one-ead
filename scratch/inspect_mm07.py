import sqlite3
from pathlib import Path

db_path = Path(__file__).resolve().parent.parent / "modules" / "component_database" / "data" / "components.db"
conn = sqlite3.connect(str(db_path))
conn.row_factory = sqlite3.Row
cur = conn.cursor()

cur.execute("SELECT id, part_number, manufacturer, datasheet_filename, datasheet_category, category_id FROM components WHERE part_number LIKE '%MM07%'")
rows = cur.fetchall()
for r in rows:
    print(dict(r))
    cur.execute(
        "SELECT param_key, param_label, min_val, nom_val, max_val, unit, condition, source_page, status, confidence "
        "FROM specs WHERE component_id = ? AND param_key LIKE '%sensit%' ORDER BY id",
        (r["id"],)
    )
    for sp in cur.fetchall():
        print("  ", dict(sp))

conn.close()
