import sqlite3
from pathlib import Path

db_path = Path('modules/component_database/data/components.db')
conn = sqlite3.connect(str(db_path))
cur = conn.cursor()

parts = [
    {
        "id": "knowles_mm60_63230",
        "key": "acoustic_port_dim",
        "label": "Acoustic Port Dimension",
        "nom": "0.30",
        "unit": "mm",
        "cond": "Ø 0.30 mm",
        "page": 1
    },
    {
        "id": "knowles_mm08_36139",
        "key": "acoustic_port_dim",
        "label": "Acoustic Port Dimension",
        "nom": "0.35",
        "unit": "mm",
        "cond": "Ø 0.35 mm",
        "page": 1
    },
    {
        "id": "knowles_mm07_62964_b66",
        "key": "acoustic_port_dim",
        "label": "Acoustic Port Dimension",
        "nom": "0.325",
        "unit": "mm",
        "cond": "Ø 0.325 ±0.05 mm",
        "page": 4
    }
]

for p in parts:
    # Delete any existing
    cur.execute("DELETE FROM specs WHERE component_id = ? AND param_key = ?", (p["id"], p["key"]))
    cur.execute("""
        INSERT INTO specs 
        (component_id, param_key, param_label, min_val, nom_val, max_val, unit, condition, source_page, status, confidence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        p["id"], p["key"], p["label"],
        None, p["nom"], None,
        p["unit"], p["cond"], p["page"],
        "verified", 1.0
    ))
    print(f"Updated {p['id']}: {p['label']} = {p['nom']} {p['unit']} (Page {p['page']})")

conn.commit()
conn.close()
print("DB updated successfully!")
