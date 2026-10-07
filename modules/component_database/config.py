"""Configuration settings and filesystem paths for Component Database."""

from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
SCHEMAS_DIR = BASE_DIR / "schemas"
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "components.db"
DATASHEETS_VAULT = DATA_DIR / "datasheets"

# Ensure directories exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
DATASHEETS_VAULT.mkdir(parents=True, exist_ok=True)


def resolve_pdf_path(category: str, filename: str) -> Path:
    """
    Locate a datasheet PDF's actual path on disk, checking in order:
    1. Bundled per-category folder (seed/reference datasheets): modules/component_database/<category>/
    2. Per-category vault subfolder (uploads are filed here): data/datasheets/<category>/
    3. Legacy flat vault (uploads made before per-category subfolders existed): data/datasheets/
    Returns the first path that exists; if none exist, returns the per-category vault path —
    the preferred location to write a NEW file of this category.
    """
    cat = category or "microphone"
    for candidate in (BASE_DIR / cat / filename, DATASHEETS_VAULT / cat / filename, DATASHEETS_VAULT / filename):
        if candidate.exists():
            return candidate
    return DATASHEETS_VAULT / cat / filename
