"""One-time migration: move legacy flat-vault PDFs (datasheet_category='vault') into their
proper per-category subfolder (data/datasheets/<category>/) and update the DB row to match,
now that uploads are filed by category instead of dumped flat into data/datasheets/.
"""
import shutil
import sqlite3
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "modules" / "component_database" / "data"
DB_PATH = DATA_DIR / "components.db"
VAULT = DATA_DIR / "datasheets"

conn = sqlite3.connect(str(DB_PATH))
conn.row_factory = sqlite3.Row
cur = conn.cursor()

cur.execute("SELECT id, part_number, category_id, datasheet_filename FROM components WHERE datasheet_category = 'vault'")
rows = cur.fetchall()

if not rows:
    print("Nothing to migrate.")
else:
    for row in rows:
        filename = row["datasheet_filename"]
        cat = row["category_id"] or "microphone"
        old_path = VAULT / filename
        new_dir = VAULT / cat
        new_dir.mkdir(parents=True, exist_ok=True)
        new_path = new_dir / filename

        if old_path.exists():
            shutil.move(str(old_path), str(new_path))
            print(f"Moved: {old_path.relative_to(DATA_DIR)} -> {new_path.relative_to(DATA_DIR)}")
        elif not new_path.exists():
            print(f"WARNING: file not found for {row['part_number']} ({filename}); skipping file move")

        cur.execute("UPDATE components SET datasheet_category = ? WHERE id = ?", (cat, row["id"]))
        print(f"  DB updated: {row['id']} datasheet_category -> '{cat}'")

    conn.commit()
    print(f"Done. Migrated {len(rows)} component(s).")

conn.close()
