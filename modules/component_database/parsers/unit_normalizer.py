"""Unit normalization and numeric cleaning for extracted datasheet values."""

import re
from typing import Any, Optional, Tuple, Union


def clean_text(text: Optional[str]) -> str:
    """Clean common PDF extraction artifacts and corrupted encoding."""
    if not text:
        return ""
    s = str(text).strip()
    # Knowles PDF specific encoding fixes (U+FFFD replacement char)
    s = s.replace("\ufffdA", "µA").replace("\ufffdC", "°C").replace("\ufffd", "±")
    # Clean redundant newlines inside table cells
    s = re.sub(r"\s+", " ", s)

    # Fix broken syllables / word kerning splits from PDF font encoding
    split_fixes = [
        ("ti me", "time"),
        ("Ti me", "Time"),
        ("Dr ain", "Drain"),
        ("dr ain", "drain"),
        ("Fre quency", "Frequency"),
        ("fre quency", "frequency"),
        ("Am plitude", "Amplitude"),
        ("am plitude", "amplitude"),
        ("Im pedance", "Impedance"),
        ("im pedance", "impedance"),
        ("Sen sitivity", "Sensitivity"),
        ("sen sitivity", "sensitivity"),
        ("Tem perature", "Temperature"),
        ("tem perature", "temperature"),
        ("Speci fications", "Specifications"),
        ("speci fications", "specifications"),
        ("Thres hold", "Threshold"),
        ("thres hold", "threshold"),
        ("Volt age", "Voltage"),
        ("volt age", "voltage"),
    ]
    for a, b in split_fixes:
        s = s.replace(a, b)

    return s.strip()


def parse_numeric(val_str: Optional[str]) -> Tuple[Optional[float], Optional[str]]:
    """
    Attempt to extract a numeric float value.
    Returns (float_value, original_or_cleaned_string).
    """
    if not val_str:
        return None, None
    s = clean_text(val_str)
    if s in ("-", "--", "TBD", "N/A", "n/a", "", "None"):
        return None, s

    # Match numeric float / int with optional sign
    m = re.search(r"[-+]?\d*\.?\d+", s)
    if m:
        try:
            return float(m.group(0)), s
        except ValueError:
            pass
    return None, s


def normalize_value(min_val: Any, nom_val: Any, max_val: Any, unit: Any) -> dict:
    """Normalize a min/nom/max/unit tuple into a clean structure."""
    min_num, min_raw = parse_numeric(min_val)
    nom_num, nom_raw = parse_numeric(nom_val)
    max_num, max_raw = parse_numeric(max_val)
    unit_clean = clean_text(unit)

    # Standardize common engineering units
    unit_map = {
        "ohms": "Ω",
        "ohm": "Ω",
        "Ohm": "Ω",
        "uA": "µA",
        "dB A": "dBA",
        "deg": "°",
        "degrees": "°",
    }
    unit_clean = unit_map.get(unit_clean, unit_clean)

    # Strip a trailing "-"/"--" placeholder that bled into the Units cell from a blank
    # adjacent Condition column (e.g. "ºC -" -> "ºC"), a PDF table extraction artifact.
    unit_clean = re.sub(r"\s*-{1,2}$", "", unit_clean).strip()

    return {
        "min": min_num if min_num is not None else (min_raw if min_raw not in ("-", "--", None) else None),
        "nom": nom_num if nom_num is not None else (nom_raw if nom_raw not in ("-", "--", None) else None),
        "max": max_num if max_num is not None else (max_raw if max_raw not in ("-", "--", None) else None),
        "unit": unit_clean,
    }
