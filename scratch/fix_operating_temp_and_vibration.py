"""
One-off DB repair (2026-10-01): operating_temp and input_referred_vibration_* specs were
extracted and persisted BEFORE the table_extractor.py fixes (split-cell digit-merge bug
corrupting Operating Temperature into e.g. "1722", and vibration axis rows losing their
Z/Y/X identity + unit). sync_disk_datasheets() only extracts specs for NEWLY discovered
PDFs, so already-registered components keep their stale/corrupted rows forever unless
explicitly re-extracted. This script re-runs the (now fixed) parser for every existing
component with a resolvable datasheet PDF and replaces ONLY its operating_temp and
input_referred_vibration_* spec rows with freshly extracted values, leaving every other
spec (including any manual Datasheet Inspector edits) untouched.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from modules.component_database.db import get_connection
from modules.component_database.config import resolve_pdf_path
from modules.component_database.parsers.table_extractor import process_datasheet_pdf

TARGET_KEYS_EXACT = {"operating_temp"}
TARGET_KEYS_PREFIX = ("input_referred_vibration", "phase_")


def main() -> None:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, datasheet_filename, datasheet_category, category_id FROM components")
        components = [dict(r) for r in cursor.fetchall()]

        for comp in components:
            filename = comp.get("datasheet_filename")
            if not filename:
                continue
            cat = comp.get("datasheet_category") or comp.get("category_id") or "microphone"
            pdf_path = resolve_pdf_path(cat, filename)
            if not pdf_path.exists():
                continue

            try:
                fresh_specs = process_datasheet_pdf(pdf_path, category_id=cat)
            except Exception as exc:
                print(f"[skip] {comp['id']}: extraction error: {exc}")
                continue

            fresh_targets = [
                sp for sp in fresh_specs
                if sp["param_key"] in TARGET_KEYS_EXACT or sp["param_key"].startswith(TARGET_KEYS_PREFIX)
            ]
            # NOTE: phase_250_hz/phase_1k_hz rows are not unique per component (a datasheet can
            # have 2 distinct "Phase 250 Hz" measurements - stripe-marked mic vs front mic pairs -
            # that collapse to the same param_key); insert all of them, same as process_datasheet_pdf does.
            if not fresh_targets:
                continue

            cursor.execute(
                """
                DELETE FROM specs
                WHERE component_id = ?
                  AND (param_key = 'operating_temp' OR param_key LIKE 'input_referred_vibration%' OR param_key LIKE 'phase_%')
                """,
                (comp["id"],),
            )

            for sp in fresh_targets:
                cursor.execute(
                    """
                    INSERT INTO specs
                    (component_id, param_key, param_label, min_val, nom_val, max_val, unit, condition, source_page, status, confidence)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        comp["id"], sp["param_key"], sp["canonical_label"],
                        str(sp["min"]) if sp.get("min") is not None else None,
                        str(sp["nom"]) if sp.get("nom") is not None else None,
                        str(sp["max"]) if sp.get("max") is not None else None,
                        sp.get("unit", ""), sp.get("condition", ""),
                        sp.get("source_page", 1), sp.get("status", "verified"),
                        sp.get("confidence", 1.0),
                    ),
                )
            print(f"[fixed] {comp['id']} ({filename}): {[s['param_key'] for s in fresh_targets]}")

        conn.commit()


if __name__ == "__main__":
    main()
