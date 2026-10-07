import sqlite3
from pathlib import Path

db_path = Path(__file__).resolve().parent.parent / "modules" / "component_database" / "data" / "components.db"
conn = sqlite3.connect(str(db_path))
conn.row_factory = sqlite3.Row
cur = conn.cursor()
cur.execute("SELECT id, category_id, datasheet_category, datasheet_filename FROM components WHERE part_number LIKE '%MM60%'")
for r in cur.fetchall():
    print(dict(r))
conn.close()
