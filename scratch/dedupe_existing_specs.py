"""One-time cleanup: remove spurious duplicate (component_id, param_key) spec rows,
keeping only the most complete one per key (same preference rule as db._dedupe_specs).
Run once against the live DB to fix bad data already inserted before the dedupe fix existed.
"""
import sqlite3
from pathlib import Path

db_path = Path(__file__).resolve().parent.parent / "modules" / "component_database" / "data" / "components.db"
conn = sqlite3.connect(str(db_path))
conn.row_factory = sqlite3.Row
cur = conn.cursor()


def has_val(v):
    return v is not None and v != "" and v != "TBD"


cur.execute("SELECT DISTINCT component_id FROM specs")
comp_ids = [r["component_id"] for r in cur.fetchall()]

total_removed = 0
for comp_id in comp_ids:
    cur.execute("SELECT * FROM specs WHERE component_id = ?", (comp_id,))
    rows = [dict(r) for r in cur.fetchall()]

    best_by_key = {}
    for row in rows:
        key = row["param_key"]
        completeness = 2 if has_val(row["nom_val"]) else (1 if (has_val(row["min_val"]) or has_val(row["max_val"])) else 0)
        score = (completeness, float(row["confidence"] or 0))
        if key not in best_by_key or score > best_by_key[key][0]:
            best_by_key[key] = (score, row)

    keep_ids = {v[1]["id"] for v in best_by_key.values()}
    remove_ids = [row["id"] for row in rows if row["id"] not in keep_ids]
    for rid in remove_ids:
        cur.execute("DELETE FROM specs WHERE id = ?", (rid,))
        total_removed += 1
    if remove_ids:
        print(f"{comp_id}: removed {len(remove_ids)} duplicate spec row(s)")

conn.commit()
conn.close()
print(f"Done. Total duplicate spec rows removed: {total_removed}")
