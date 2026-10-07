"""Alias matcher and synonym dictionary for parameter identification."""

import json
import re
from typing import Dict, Any, Optional, Tuple
from ..config import SCHEMAS_DIR


_SCHEMAS_CACHE: Dict[str, dict] = {}


def get_category_schema(category_id: str) -> dict:
    """Load schema dictionary for a category from JSON files."""
    if category_id in _SCHEMAS_CACHE:
        return _SCHEMAS_CACHE[category_id]

    schema_file = SCHEMAS_DIR / f"{category_id}.json"
    if not schema_file.exists():
        # Fallback to microphone if category not found
        schema_file = SCHEMAS_DIR / "microphone.json"

    try:
        with open(schema_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            _SCHEMAS_CACHE[category_id] = data
            return data
    except Exception as exc:
        print(f"[alias_matcher] Error reading schema {schema_file}: {exc}")
        return {"category_id": category_id, "groups": []}


def _simplify(s: str) -> str:
    """Normalize string for fuzzy comparison: lowercase, alphanumeric only."""
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _is_unit_compatible(param_unit: Optional[str], raw_unit: Optional[str]) -> bool:
    """Verify that the physical measurement dimension of the row matches the schema parameter."""
    if not param_unit or not raw_unit:
        return True
    p = str(param_unit).strip().lower()
    r = str(raw_unit).strip().lower()
    if p == r:
        return True

    families = {
        "time": {"ms", "s", "µs", "us", "sec", "msec"},
        "current": {"µa", "ua", "ma", "a"},
        "voltage": {"v", "mv"},
        "sound": {"db", "dbv", "dba", "db spl"},
        "freq": {"hz", "khz", "mhz"},
        "imp": {"ω", "kω", "ohm", "ohms"},
        "temp": {"°c", "c", "deg c"},
    }
    p_fam = next((f for f, units in families.items() if p in units), None)
    r_fam = next((f for f, units in families.items() if r in units), None)
    if p_fam and r_fam and p_fam != r_fam:
        return False
    return True


def match_parameter_alias(
    raw_label: str,
    category_id: str = "microphone",
    unit: Optional[str] = None
) -> Tuple[Optional[dict], float]:
    """
    Match a raw row label against canonical parameter definitions and aliases.
    Returns (parameter_def, confidence_score: 0.0 - 1.0).
    """
    if not raw_label:
        return None, 0.0

    schema = get_category_schema(category_id)
    raw_clean = raw_label.strip()
    raw_simple = _simplify(raw_clean)

    best_param = None
    best_score = 0.0

    for group in schema.get("groups", []):
        for param in group.get("parameters", []):
            param_key = param.get("key", "")
            param_label = param.get("label", "")
            param_unit = param.get("unit", "")
            aliases = param.get("aliases", [])

            # Unit compatibility check: prevent current (µA) from matching time (ms), etc.
            if unit and not _is_unit_compatible(param_unit, unit):
                continue

            # 1. Exact match on canonical key or label
            if _simplify(param_key) == raw_simple or _simplify(param_label) == raw_simple:
                return param, 1.0

            # 2. Check exact aliases
            for alias in aliases:
                alias_simple = _simplify(alias)
                if alias_simple == raw_simple:
                    return param, 1.0
                if alias_simple and alias_simple in raw_simple and len(alias_simple) >= 4:
                    score = len(alias_simple) / max(len(raw_simple), 1) * 0.95
                    if score > best_score:
                        best_score = score
                        best_param = param
                elif raw_simple and raw_simple in alias_simple and len(raw_simple) >= 4:
                    score = len(raw_simple) / max(len(alias_simple), 1) * 0.90
                    if score > best_score:
                        best_score = score
                        best_param = param

    # Threshold for fuzzy match acceptance
    if best_param and best_score >= 0.55:
        return best_param, round(best_score, 2)

    return None, 0.0
