"""SQLite database repository and persistent storage for Component Database."""

import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from .config import BASE_DIR, DATASHEETS_VAULT, DB_PATH, SCHEMAS_DIR, resolve_pdf_path


def get_connection() -> sqlite3.Connection:
    """Create a SQLite connection with row factory enabled."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Initialize database tables and seed baseline datasheets if empty."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS components (
                id TEXT PRIMARY KEY,
                part_number TEXT NOT NULL,
                manufacturer TEXT NOT NULL,
                category_id TEXT NOT NULL,
                description TEXT DEFAULT '',
                package_type TEXT DEFAULT '',
                datasheet_filename TEXT DEFAULT '',
                datasheet_category TEXT DEFAULT '',
                verified INTEGER DEFAULT 1,
                tags TEXT DEFAULT '',
                created_at TEXT NOT NULL
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS specs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                component_id TEXT NOT NULL,
                param_key TEXT NOT NULL,
                param_label TEXT NOT NULL,
                min_val TEXT,
                nom_val TEXT,
                max_val TEXT,
                unit TEXT DEFAULT '',
                condition TEXT DEFAULT '',
                source_page INTEGER DEFAULT 1,
                status TEXT DEFAULT 'verified',
                confidence REAL DEFAULT 1.0,
                FOREIGN KEY (component_id) REFERENCES components(id) ON DELETE CASCADE
            )
        """)

        # Tombstones for user-deleted datasheets: prevents sync_disk_datasheets() from
        # resurrecting a just-deleted component if its PDF is still locked on disk (e.g. a
        # stale OS file handle) at the moment of deletion.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS deleted_datasheets (
                filename TEXT NOT NULL,
                category TEXT NOT NULL,
                deleted_at TEXT NOT NULL,
                PRIMARY KEY (filename, category)
            )
        """)

        # Auto-Sync: seed or restore baseline components if their PDF exists on disk
        _seed_baseline_data(conn)
        conn.commit()


def _seed_baseline_data(conn: sqlite3.Connection) -> None:
    """Seed baseline components with verified local PDF datasheets."""
    cursor = conn.cursor()
    now_str = datetime.now().isoformat()

    seed_components = [
        {
            "id": "knowles_mm60_63230",
            "part_number": "MM60-63230-B66",
            "manufacturer": "Knowles",
            "category_id": "microphone",
            "description": "High performance low noise analog MEMS microphone with integrated ASIC.",
            "package_type": "LGA Bottom Port",
            "datasheet_filename": "D00343759_V2_DATA SHEET MIC MM60-63230-B66 KNOWLES.pdf",
            "datasheet_category": "microphone",
            "verified": 1,
            "tags": "MEMS,Analog,Low-Noise,Bottom-Port,Verified",
            "specs": [
                {"key": "acoustic_port_dim", "label": "Acoustic Port Dimension", "min": None, "nom": "0.30", "max": None, "unit": "mm", "cond": "Ø 0.30 mm", "page": 1},
                {"key": "supply_voltage", "label": "Supply Voltage", "min": "0.88", "nom": "0.90", "max": "1.40", "unit": "V", "cond": "Operating range including supply transients", "page": 2},
                {"key": "current_consumption", "label": "Current Consumption (Drain)", "min": "35", "nom": "40", "max": "45", "unit": "µA", "cond": "No load @ 0.9V", "page": 2},
                {"key": "output_dc_bias", "label": "Output Load Voltage (VL)", "min": "0.40", "nom": "0.50", "max": "0.65", "unit": "V", "cond": "after settled (open load)", "page": 2},
                {"key": "output_impedance", "label": "Output Impedance", "min": "1200", "nom": "2700", "max": "4200", "unit": "Ω", "cond": "1 kHz", "page": 2},
                {"key": "psrr", "label": "PSRR", "min": "38.0", "nom": "45.0", "max": None, "unit": "dB", "cond": "75 mVpp sine wave @ 1 kHz", "page": 2},
                {"key": "sensitivity_1k", "label": "Sensitivity @ 1 kHz", "min": "-36.5", "nom": "-35.5", "max": "-34.5", "unit": "dBV", "cond": "dB re 1V / 1 Pa, 94 dB SPL", "page": 2},
                {"key": "sensitivity_100hz", "label": "Sensitivity @ 100 Hz", "min": "-2.0", "nom": "-1.0", "max": "0.0", "unit": "dBV", "cond": "dB re sensitivity @ 1kHz", "page": 2},
                {"key": "sensitivity_10k", "label": "Sensitivity @ 10 kHz", "min": "-3.0", "nom": "-2.0", "max": "-1.0", "unit": "dBV", "cond": "dB re sensitivity @ 1kHz", "page": 2},
                {"key": "snr", "label": "Signal to Noise Ratio (SNR)", "min": "67.5", "nom": "69.0", "max": None, "unit": "dBA", "cond": "100 Hz to 20 kHz A-weighted", "page": 2},
                {"key": "ein", "label": "Equivalent Input Noise (EIN)", "min": None, "nom": "25.0", "max": "26.5", "unit": "dB SPL", "cond": "100 Hz to 20 kHz A-weighted", "page": 2},
                {"key": "aop", "label": "Acoustic Overload Point (AOP)", "min": None, "nom": "119.0", "max": None, "unit": "dB SPL", "cond": "10% THD @ 1 kHz", "page": 2},
                {"key": "thd_point", "label": "Input SPL @ Distortion", "min": None, "nom": "118.0", "max": None, "unit": "dB SPL", "cond": "5% THD @ 1 kHz", "page": 2},
                {"key": "lfro", "label": "Low Frequency Roll-Off (LFRO)", "min": None, "nom": "50.0", "max": None, "unit": "Hz", "cond": "-3 dB re sensitivity @ 1kHz", "page": 2},
                {"key": "resonance_freq", "label": "Resonance Peak Frequency", "min": None, "nom": "19.0", "max": None, "unit": "kHz", "cond": "Cavity resonance", "page": 2},
                {"key": "resonance_amp", "label": "Resonance Peak Amplitude", "min": None, "nom": "7.5", "max": None, "unit": "dB", "cond": "dB re sensitivity @ 1kHz", "page": 2},
                {"key": "weight", "label": "Weight", "min": None, "nom": "0.0212", "max": None, "unit": "g", "cond": "Typical packaged mass", "page": 2},
                {"key": "startup_time", "label": "Startup Time", "min": None, "nom": None, "max": "9.0", "unit": "s", "cond": "Sensitivity stable within 0.23 ± 0.15dB", "page": 2},
                {"key": "operating_temp", "label": "Operating Temperature", "min": "-17", "nom": "22", "max": "63", "unit": "°C", "cond": "Operating environmental range", "page": 2},
                {"key": "polarity", "label": "Polarity", "min": "Increasing output voltage", "nom": None, "max": None, "unit": "", "cond": "Positive inlet pressure", "page": 2}
            ]
        },
        {
            "id": "knowles_mm08_36139",
            "part_number": "MM08-36139-B66",
            "manufacturer": "Knowles",
            "category_id": "microphone",
            "description": "Next-generation compact wide-bandwidth analog MEMS microphone with 29kHz resonance.",
            "package_type": "LGA Bottom Port",
            "datasheet_filename": "MM08-36139-B66 Rev 5 preliminary datasheet.pdf",
            "datasheet_category": "microphone",
            "verified": 1,
            "tags": "MEMS,Analog,Wideband,High-Resonance,Preliminary",
            "specs": [
                {"key": "acoustic_port_dim", "label": "Acoustic Port Dimension", "min": None, "nom": "0.35", "max": None, "unit": "mm", "cond": "Ø 0.35 mm", "page": 1},
                {"key": "supply_voltage", "label": "Supply Voltage", "min": "0.85", "nom": "0.90", "max": "1.40", "unit": "V", "cond": "Operating range", "page": 2},
                {"key": "current_consumption", "label": "Current Consumption (Drain)", "min": "35", "nom": "40", "max": "46", "unit": "µA", "cond": "Typical operating state", "page": 2},
                {"key": "output_dc_bias", "label": "Output Load Voltage (VL)", "min": "0.35", "nom": "0.45", "max": "0.55", "unit": "V", "cond": "after settled (open load)", "page": 2},
                {"key": "output_impedance", "label": "Output Impedance", "min": "1400", "nom": "2600", "max": "3800", "unit": "Ω", "cond": "1 kHz", "page": 2},
                {"key": "psrr", "label": "PSRR", "min": "32.0", "nom": "38.0", "max": None, "unit": "dB", "cond": "75 mVpp sine wave @ 1 kHz", "page": 2},
                {"key": "sensitivity_1k", "label": "Sensitivity @ 1 kHz", "min": "-40.5", "nom": "-37.5", "max": "-34.5", "unit": "dBV", "cond": "dB re 1V / 1 Pa, 94 dB SPL", "page": 2},
                {"key": "sensitivity_100hz", "label": "Sensitivity @ 100 Hz", "min": "-2.0", "nom": "-1.0", "max": "0.0", "unit": "dBV", "cond": "dB re sensitivity @ 1kHz", "page": 2},
                {"key": "sensitivity_10k", "label": "Sensitivity @ 10 kHz", "min": "-1.0", "nom": "0.5", "max": "2.0", "unit": "dBV", "cond": "dB re sensitivity @ 1kHz", "page": 2},
                {"key": "snr", "label": "Signal to Noise Ratio (SNR)", "min": "65.0", "nom": "67.0", "max": None, "unit": "dBA", "cond": "100 Hz to 20 kHz A-weighted", "page": 2},
                {"key": "ein", "label": "Equivalent Input Noise (EIN)", "min": None, "nom": "27.0", "max": "29.0", "unit": "dB SPL", "cond": "100 Hz to 20 kHz A-weighted", "page": 2},
                {"key": "aop", "label": "Acoustic Overload Point (AOP)", "min": None, "nom": "120.0", "max": None, "unit": "dB SPL", "cond": "10% THD @ 1 kHz", "page": 2},
                {"key": "thd_point", "label": "Input SPL @ Distortion", "min": None, "nom": "118.0", "max": None, "unit": "dB SPL", "cond": "5% THD @ 1 kHz", "page": 2},
                {"key": "lfro", "label": "Low Frequency Roll-Off (LFRO)", "min": None, "nom": "50.0", "max": None, "unit": "Hz", "cond": "-3 dB re sensitivity @ 1kHz", "page": 2},
                {"key": "resonance_freq", "label": "Resonance Peak Frequency", "min": None, "nom": "29.0", "max": None, "unit": "kHz", "cond": "Ultrasonic extended bandwidth", "page": 2},
                {"key": "resonance_amp", "label": "Resonance Peak Amplitude", "min": None, "nom": "9.5", "max": None, "unit": "dB", "cond": "dB re sensitivity @ 1kHz", "page": 2},
                {"key": "weight", "label": "Weight", "min": None, "nom": "0.0230", "max": None, "unit": "g", "cond": "Typical packaged mass", "page": 2},
                {"key": "startup_time", "label": "Startup Time", "min": None, "nom": "125.0", "max": "430.0", "unit": "ms", "cond": "Ramp to register loading time", "page": 3},
                {"key": "operating_temp", "label": "Operating Temperature", "min": "-17", "nom": "22", "max": "63", "unit": "°C", "cond": "Operating environmental range", "page": 2},
                {"key": "polarity", "label": "Polarity", "min": "Increasing output voltage", "nom": None, "max": None, "unit": "", "cond": "Positive inlet pressure", "page": 2}
            ]
        },
        {
            "id": "knowles_mm20_62249",
            "part_number": "MM20-62249-B66",
            "manufacturer": "Knowles",
            "category_id": "microphone",
            "description": "High performance analog MEMS microphone with ultra-low noise 70.5 dBA SNR and high AOP.",
            "package_type": "LGA Bottom Port",
            "datasheet_filename": "D00186943_V3_DATA SHEET MIC MM20-62249-B66 KNOWLES.pdf",
            "datasheet_category": "microphone",
            "verified": 1,
            "tags": "MEMS,Analog,Ultra-Low-Noise,High-SNR,Bottom-Port,Verified",
            "specs": [
                {"key": "supply_voltage", "label": "Supply Voltage", "min": "0.9", "nom": "0.9", "max": "1.3", "unit": "V", "cond": "Operating range", "page": 2},
                {"key": "current_consumption", "label": "Current Consumption (Drain)", "min": "22", "nom": "38", "max": "48", "unit": "µA", "cond": "Typical operating state", "page": 2},
                {"key": "output_dc_bias", "label": "Output Load Voltage (VL)", "min": "0.45", "nom": "0.55", "max": "0.65", "unit": "V", "cond": "after settled (open load)", "page": 2},
                {"key": "output_impedance", "label": "Output Impedance", "min": "2850", "nom": "4250", "max": "5100", "unit": "Ω", "cond": "1 kHz", "page": 2},
                {"key": "psrr", "label": "PSRR", "min": None, "nom": "32.0", "max": None, "unit": "dB", "cond": "1 kHz", "page": 2},
                {"key": "sensitivity_1k", "label": "Sensitivity @ 1 kHz", "min": "-59.5", "nom": "-56.5", "max": "-53.5", "unit": "dBV", "cond": "dB re 1V / 0.1 Pa", "page": 2},
                {"key": "sensitivity_100hz", "label": "Sensitivity @ 100 Hz", "min": "-3.5", "nom": "-1.5", "max": "0.5", "unit": "dBV", "cond": "dB re sensitivity @ 1kHz", "page": 2},
                {"key": "sensitivity_10k", "label": "Sensitivity @ 10 kHz", "min": "-5.0", "nom": "-2.0", "max": "1.0", "unit": "dBV", "cond": "dB re sensitivity @ 1kHz", "page": 2},
                {"key": "snr", "label": "Signal to Noise Ratio (SNR)", "min": None, "nom": "70.5", "max": None, "unit": "dBA", "cond": "20 Hz to 20 kHz A-weighted", "page": 2},
                {"key": "ein", "label": "Equivalent Input Noise (EIN)", "min": None, "nom": "23.5", "max": "27.0", "unit": "dB SPL", "cond": "20 Hz to 20 kHz A-weighted", "page": 2},
                {"key": "aop", "label": "Acoustic Overload Point (AOP)", "min": None, "nom": "121.0", "max": None, "unit": "dB SPL", "cond": "10% THD @ 1 kHz", "page": 2},
                {"key": "lfro", "label": "Low Frequency Roll-Off (LFRO)", "min": None, "nom": "55.0", "max": None, "unit": "Hz", "cond": "-3 dB re sensitivity @ 1kHz", "page": 2},
                {"key": "resonance_freq", "label": "Resonance Peak Frequency", "min": None, "nom": "19.5", "max": None, "unit": "kHz", "cond": "Resonance frequency", "page": 2},
                {"key": "resonance_amp", "label": "Resonance Peak Amplitude", "min": None, "nom": "8.0", "max": None, "unit": "dB", "cond": "dB re sensitivity @ 1kHz", "page": 2},
                {"key": "startup_time", "label": "Startup Time", "min": None, "nom": "0.5", "max": None, "unit": "s", "cond": "Sensitivity stable within +/- 0.2dB", "page": 2},
                {"key": "operating_temp", "label": "Operating Temperature", "min": "-17", "nom": "22", "max": "63", "unit": "°C", "cond": "Operating environmental range", "page": 2},
                {"key": "polarity", "label": "Polarity", "min": "Increasing output voltage", "nom": None, "max": None, "unit": "", "cond": "Increasing pressure at inlet", "page": 2}
            ]
        }
    ]

    for comp in seed_components:
        # Auto-Sync: Only seed components whose underlying PDF file actually exists on disk
        filename = comp.get("datasheet_filename")
        if filename:
            cat = comp.get("datasheet_category") or comp.get("category_id") or "microphone"
            pdf_path = resolve_pdf_path(cat, filename)
            if not pdf_path.exists():
                continue

        # If already exists in DB, don't re-insert (preserves user updates)
        cursor.execute("SELECT 1 FROM components WHERE id = ?", (comp["id"],))
        if cursor.fetchone():
            continue

        cursor.execute("""
            INSERT OR REPLACE INTO components 
            (id, part_number, manufacturer, category_id, description, package_type, datasheet_filename, datasheet_category, verified, tags, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            comp["id"], comp["part_number"], comp["manufacturer"], comp["category_id"],
            comp["description"], comp["package_type"], comp["datasheet_filename"],
            comp["datasheet_category"], comp["verified"], comp["tags"], now_str
        ))

        for sp in comp["specs"]:
            cursor.execute("""
                INSERT INTO specs (component_id, param_key, param_label, min_val, nom_val, max_val, unit, condition, source_page, status, confidence)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                comp["id"], sp["key"], sp["label"],
                str(sp["min"]) if sp["min"] is not None else None,
                str(sp["nom"]) if sp["nom"] is not None else None,
                str(sp["max"]) if sp["max"] is not None else None,
                sp["unit"], sp["cond"], sp["page"], "verified", 1.0
            ))
    conn.commit()


import re


def _dedupe_specs(specs_data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Keep only one entry per param_key. Upstream PDF extraction can yield spurious duplicate
    matches for the same canonical parameter found on different pages (e.g. a fuzzy alias
    match with no real value); without this, whichever duplicate happens to be inserted last
    silently overwrites a complete entry with a blank one (e.g. "null dBV" in the Catalog).
    Preference: has a nominal value > has only min/max > higher confidence > first seen.
    """
    def _has_val(v: Any) -> bool:
        return v is not None and v != "" and v != "TBD"

    best: Dict[str, tuple] = {}
    for sp in specs_data:
        key = sp.get("param_key") or sp.get("key", "")
        if not key:
            continue
        nom = sp.get("nom_val", sp.get("nom"))
        min_v = sp.get("min_val", sp.get("min"))
        max_v = sp.get("max_val", sp.get("max"))
        completeness = 2 if _has_val(nom) else (1 if (_has_val(min_v) or _has_val(max_v)) else 0)
        score = (completeness, float(sp.get("confidence", 0) or 0))
        if key not in best or score > best[key][0]:
            best[key] = (score, sp)
    return [entry[1] for entry in best.values()]


def guess_part_and_manufacturer(filename: str) -> tuple:
    """Heuristically derive a part number and manufacturer from a datasheet filename."""
    stem = Path(filename).stem
    m_pn = re.search(r"([A-Z0-9]{2,}-[A-Z0-9]+-[A-Z0-9]+)", filename, re.IGNORECASE)
    if not m_pn:
        m_pn = re.search(r"([A-Z0-9]{3,}-[A-Z0-9]+)", filename, re.IGNORECASE)
    part_number = m_pn.group(1).upper() if m_pn else stem

    upper_name = filename.upper()
    if "KNOWLES" in upper_name:
        manufacturer = "Knowles"
    elif "ST" in upper_name or "STMICRO" in upper_name:
        manufacturer = "STMicroelectronics"
    elif "TDK" in upper_name or "INVENSENSE" in upper_name:
        manufacturer = "TDK InvenSense"
    elif "BOSCH" in upper_name:
        manufacturer = "Bosch"
    else:
        manufacturer = "Generic"

    return part_number, manufacturer


def sync_disk_datasheets() -> None:
    """
    Bi-directional synchronization between local PDF filesystem folders and SQLite database.
    1. If a component's PDF has been deleted from disk, automatically prune the component from DB.
    2. If a new PDF file is added to a category folder (e.g. microphone/), automatically discover,
       parse its specifications, and ingest it into DB so it appears immediately in the Catalog.
    """
    with get_connection() as conn:
        cursor = conn.cursor()
        now_str = datetime.now().isoformat()

        # 1. Prune components whose underlying PDF file was deleted
        cursor.execute("SELECT id, category_id, datasheet_filename, datasheet_category FROM components")
        existing_rows = cursor.fetchall()
        for row in existing_rows:
            filename = row["datasheet_filename"]
            if filename:
                cat = row["datasheet_category"] or row["category_id"] or "microphone"
                pdf_path = resolve_pdf_path(cat, filename)
                if not pdf_path.exists():
                    cursor.execute("DELETE FROM specs WHERE component_id = ?", (row["id"],))
                    cursor.execute("DELETE FROM components WHERE id = ?", (row["id"],))

        # 1b. Retry physical removal of tombstoned (user-deleted) files whose unlink failed
        # earlier because the file was still locked; clean up the tombstone once it succeeds.
        cursor.execute("SELECT filename, category FROM deleted_datasheets")
        tombstones = {(r["filename"], r["category"]) for r in cursor.fetchall()}
        for filename, cat in list(tombstones):
            pdf_path = resolve_pdf_path(cat, filename)
            if not pdf_path.exists():
                cursor.execute(
                    "DELETE FROM deleted_datasheets WHERE filename = ? AND category = ?", (filename, cat)
                )
                tombstones.discard((filename, cat))
                continue
            try:
                pdf_path.unlink()
                cursor.execute(
                    "DELETE FROM deleted_datasheets WHERE filename = ? AND category = ?", (filename, cat)
                )
                tombstones.discard((filename, cat))
            except OSError:
                pass  # still locked; retry on the next sync

        # 2. Discover new PDF files on disk not yet registered in components
        cursor.execute("SELECT datasheet_filename FROM components WHERE datasheet_filename != ''")
        registered_files = {r["datasheet_filename"] for r in cursor.fetchall()}

        categories = ["microphone", "receiver", "telecoil"]
        for cat_dir in BASE_DIR.iterdir():
            if cat_dir.is_dir() and not cat_dir.name.startswith(('.', '_')) and cat_dir.name not in ('data', 'schemas', 'parsers', 'web', '__pycache__'):
                if cat_dir.name not in categories:
                    categories.append(cat_dir.name)

        from .parsers.table_extractor import process_datasheet_pdf

        for cat in categories:
            cat_path = BASE_DIR / cat
            if not cat_path.exists():
                continue
            for pdf_file in cat_path.glob("*.pdf"):
                if pdf_file.name in registered_files:
                    continue
                if (pdf_file.name, cat) in tombstones:
                    continue  # user explicitly deleted this; don't auto re-ingest

                part_number, manufacturer = guess_part_and_manufacturer(pdf_file.name)

                clean_pn = re.sub(r'[^a-z0-9_]', '_', part_number.lower())
                comp_id = f"{manufacturer.lower()}_{clean_pn}"

                cursor.execute("SELECT 1 FROM components WHERE id = ?", (comp_id,))
                if cursor.fetchone():
                    comp_id = f"{comp_id}_{abs(hash(pdf_file.name)) % 10000}"

                package_type = "LGA Bottom Port" if cat == "microphone" else "Standard SMD"
                description = f"High performance {cat} sensor with integrated interface."
                tags = "MEMS,Auto-Discovered,PDF"

                try:
                    specs = process_datasheet_pdf(pdf_file, category_id=cat)
                except Exception as ex:
                    print(f"[db sync] Error extracting specs from {pdf_file.name}: {ex}")
                    specs = []
                specs = _dedupe_specs(specs)

                cursor.execute("""
                    INSERT INTO components 
                    (id, part_number, manufacturer, category_id, description, package_type, datasheet_filename, datasheet_category, verified, tags, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    comp_id, part_number, manufacturer, cat, description, package_type,
                    pdf_file.name, cat, 1, tags, now_str
                ))

                for sp in specs:
                    cursor.execute("""
                        INSERT INTO specs 
                        (component_id, param_key, param_label, min_val, nom_val, max_val, unit, condition, source_page, status, confidence)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        comp_id, sp["param_key"], sp["canonical_label"],
                        str(sp["min"]) if sp.get("min") is not None else None,
                        str(sp["nom"]) if sp.get("nom") is not None else None,
                        str(sp["max"]) if sp.get("max") is not None else None,
                        sp.get("unit", ""), sp.get("condition", ""),
                        sp.get("source_page", 1), sp.get("status", "verified"),
                        sp.get("confidence", 1.0)
                    ))

                registered_files.add(pdf_file.name)
        conn.commit()


def list_components(category_id: Optional[str] = None, query: Optional[str] = None) -> List[Dict[str, Any]]:
    """Query components with optional category filtering and search query."""
    init_db()
    # Synchronize disk PDF files (auto-ingest new files and auto-prune deleted files)
    sync_disk_datasheets()

    with get_connection() as conn:
        cursor = conn.cursor()
        sql = "SELECT * FROM components WHERE 1=1"
        params: List[Any] = []

        if category_id and category_id != "all":
            sql += " AND category_id = ?"
            params.append(category_id)

        if query:
            q_clean = f"%{query.strip()}%"
            sql += " AND (part_number LIKE ? OR manufacturer LIKE ? OR description LIKE ? OR tags LIKE ?)"
            params.extend([q_clean, q_clean, q_clean, q_clean])

        sql += " ORDER BY category_id, manufacturer, part_number"
        cursor.execute(sql, params)
        rows = cursor.fetchall()

        results = []
        for r in rows:
            comp = dict(r)

            # Fetch preview key specs. A datasheet can yield spurious duplicate rows for the
            # same param_key (e.g. a false alias match on another page) — prefer whichever
            # row actually has a nominal value instead of letting a blank duplicate win.
            cursor.execute("""
                SELECT param_key, param_label, min_val, nom_val, max_val, unit, condition 
                FROM specs 
                WHERE component_id = ? AND param_key IN ('sensitivity_1k', 'snr', 'supply_voltage', 'aop', 'sensitivity_spl', 'nominal_impedance')
                ORDER BY (nom_val IS NULL OR nom_val = ''), id
            """, (comp["id"],))
            spec_rows = cursor.fetchall()
            key_specs = {}
            for sr in spec_rows:
                key_specs.setdefault(sr["param_key"], dict(sr))  # first row wins (best thanks to ORDER BY above)
            comp["key_specs"] = key_specs
            results.append(comp)

        return results


def get_component(component_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve full component record with all associated parametric specs."""
    init_db()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM components WHERE id = ?", (component_id,))
        row = cursor.fetchone()
        if not row:
            return None

        comp = dict(row)

        # Auto-Sync: verify if the component's underlying PDF file still exists on disk
        filename = comp.get("datasheet_filename")
        if filename:
            cat = comp.get("datasheet_category") or comp.get("category_id") or "microphone"
            pdf_path = resolve_pdf_path(cat, filename)
            if not pdf_path.exists():
                cursor.execute("DELETE FROM specs WHERE component_id = ?", (component_id,))
                cursor.execute("DELETE FROM components WHERE id = ?", (component_id,))
                conn.commit()
                return None

        cursor.execute("SELECT * FROM specs WHERE component_id = ? ORDER BY id", (component_id,))
        spec_rows = cursor.fetchall()
        comp["specs"] = [dict(sr) for sr in spec_rows]
        return comp


def save_component(component_data: Dict[str, Any], specs_data: List[Dict[str, Any]], mode: str = "create") -> str:
    """
    Insert or update a component and its associated parametric specs.
    - If component_data["id"] is explicitly provided, always updates that exact record (in place).
    - Otherwise (mode="create"), a slug id is derived from manufacturer+part_number; if that slug
      already belongs to an existing component, a numeric suffix is appended so a "create" can
      never silently clobber an unrelated existing row (use mode="update" with an explicit id instead).
    """
    init_db()
    explicit_id = component_data.get("id")
    now_str = datetime.now().isoformat()

    with get_connection() as conn:
        cursor = conn.cursor()

        if explicit_id:
            comp_id = explicit_id
        else:
            base_slug = f"{component_data.get('manufacturer', 'generic').lower()}_{component_data.get('part_number', 'part').lower().replace(' ', '_')}"
            comp_id = base_slug
            if mode != "update":
                suffix = 2
                while True:
                    cursor.execute("SELECT 1 FROM components WHERE id = ?", (comp_id,))
                    if not cursor.fetchone():
                        break
                    comp_id = f"{base_slug}_{suffix}"
                    suffix += 1

        cursor.execute("""
            INSERT OR REPLACE INTO components
            (id, part_number, manufacturer, category_id, description, package_type, datasheet_filename, datasheet_category, verified, tags, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            comp_id,
            component_data.get("part_number", "Unknown Part"),
            component_data.get("manufacturer", "Generic"),
            component_data.get("category_id", "microphone"),
            component_data.get("description", ""),
            component_data.get("package_type", ""),
            component_data.get("datasheet_filename", ""),
            component_data.get("datasheet_category", component_data.get("category_id", "microphone")),
            1 if component_data.get("verified", True) else 0,
            component_data.get("tags", ""),
            now_str
        ))

        # Replace specs
        cursor.execute("DELETE FROM specs WHERE component_id = ?", (comp_id,))
        for sp in _dedupe_specs(specs_data):
            cursor.execute("""
                INSERT INTO specs 
                (component_id, param_key, param_label, min_val, nom_val, max_val, unit, condition, source_page, status, confidence)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                comp_id,
                sp.get("param_key") or sp.get("key", ""),
                sp.get("param_label") or sp.get("canonical_label") or sp.get("label", ""),
                str(sp["min_val"]) if sp.get("min_val") is not None else (str(sp["min"]) if sp.get("min") is not None else None),
                str(sp["nom_val"]) if sp.get("nom_val") is not None else (str(sp["nom"]) if sp.get("nom") is not None else None),
                str(sp["max_val"]) if sp.get("max_val") is not None else (str(sp["max"]) if sp.get("max") is not None else None),
                sp.get("unit", ""),
                sp.get("condition") or sp.get("cond", ""),
                sp.get("source_page") or sp.get("page", 1),
                sp.get("status", "verified"),
                float(sp.get("confidence", 1.0))
            ))
        conn.commit()
    return comp_id


def delete_component(component_id: str) -> Dict[str, Any]:
    """Delete a component, its specs, and its underlying PDF file (if no other component shares it)."""
    init_db()
    now_str = datetime.now().isoformat()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT datasheet_filename, datasheet_category, category_id FROM components WHERE id = ?",
            (component_id,)
        )
        row = cursor.fetchone()
        if not row:
            return {"deleted": False, "file_deleted": False, "filename": None}

        filename = row["datasheet_filename"]
        cat = row["datasheet_category"] or row["category_id"] or "microphone"

        cursor.execute("DELETE FROM specs WHERE component_id = ?", (component_id,))
        cursor.execute("DELETE FROM components WHERE id = ?", (component_id,))
        deleted = cursor.rowcount > 0

        file_deleted = False
        if deleted and filename:
            cursor.execute(
                "SELECT 1 FROM components WHERE datasheet_filename = ? AND datasheet_category = ?",
                (filename, cat)
            )
            if not cursor.fetchone():
                pdf_path = resolve_pdf_path(cat, filename)
                try:
                    if pdf_path.exists():
                        pdf_path.unlink()
                        file_deleted = True
                except OSError as exc:
                    print(f"[delete_component] Could not remove PDF {pdf_path}: {exc}")

                # If the file is still present (locked / unlink failed), tombstone it so
                # sync_disk_datasheets() never resurrects this component as "newly discovered";
                # the sync loop retries the physical delete on every later catalog load.
                if pdf_path.exists():
                    cursor.execute(
                        "INSERT OR REPLACE INTO deleted_datasheets (filename, category, deleted_at) VALUES (?, ?, ?)",
                        (filename, cat, now_str)
                    )

        conn.commit()
        return {"deleted": deleted, "file_deleted": file_deleted, "filename": filename}


def set_verified(component_id: str, verified: bool) -> bool:
    """Flip a component's verified flag without touching its specs."""
    init_db()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE components SET verified = ? WHERE id = ?",
            (1 if verified else 0, component_id)
        )
        conn.commit()
        return cursor.rowcount > 0
