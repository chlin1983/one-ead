"""Re-link MM60's datasheet file (its datasheet_filename had been blanked by a prior commit
that had no datasheet selected) and move it into the microphone vault subfolder."""
import shutil
import sqlite3
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "modules" / "component_database" / "data"
DB_PATH = DATA_DIR / "components.db"
VAULT = DATA_DIR / "datasheets"

filename = "D00343759_V2_TDS MEMS MIC MM60-63230-B66 KNOWLES.pdf"
old_path = VAULT / filename
new_dir = VAULT / "microphone"
new_dir.mkdir(parents=True, exist_ok=True)
new_path = new_dir / filename

if old_path.exists():
    shutil.move(str(old_path), str(new_path))
    print(f"Moved: {old_path.relative_to(DATA_DIR)} -> {new_path.relative_to(DATA_DIR)}")
else:
    print(f"WARNING: {old_path} not found")

conn = sqlite3.connect(str(DB_PATH))
cur = conn.cursor()
cur.execute(
    "UPDATE components SET datasheet_filename = ? WHERE id = 'knowles_mm60-63230-b66'",
    (filename,)
)
conn.commit()
print(f"DB updated: knowles_mm60-63230-b66 datasheet_filename -> '{filename}'")
conn.close()
