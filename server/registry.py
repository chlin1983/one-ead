"""Automatic discovery of portal modules.

Every sub-package of :mod:`modules` is imported and inspected for a
module-level ``MODULE`` attribute (a :class:`~server.module.PortalModule`).
Registering a new tool is therefore purely additive: drop a package into
``modules/`` that exposes ``MODULE`` and it appears automatically.
"""

from __future__ import annotations

import importlib
import json
import pkgutil
from pathlib import Path
from typing import List

from server.module import PortalModule

ORDER_FILE = Path(__file__).resolve().parent / "plugin_order.json"


def get_saved_order() -> List[str]:
    """Retrieve the user's custom plugin order list from disk."""
    if not ORDER_FILE.exists():
        return []
    try:
        with open(ORDER_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list):
                return data
            if isinstance(data, dict) and "order" in data:
                return data["order"]
    except Exception as exc:
        print(f"[registry] Error reading {ORDER_FILE}: {exc}")
    return []


def save_saved_order(order: List[str]) -> bool:
    """Save the user's custom plugin order list to disk."""
    try:
        ORDER_FILE.parent.mkdir(parents=True, exist_ok=True)
        temp_file = ORDER_FILE.with_suffix(".tmp")
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(order, f, indent=2)
        temp_file.replace(ORDER_FILE)
        return True
    except Exception as exc:
        print(f"[registry] Error saving {ORDER_FILE}: {exc}")
        return False


def discover_modules() -> List[PortalModule]:
    """Import every module package and collect their ``MODULE`` instances."""

    import modules as modules_pkg

    found: List[PortalModule] = []
    for info in pkgutil.iter_modules(modules_pkg.__path__):
        if not info.ispkg:
            continue
        package = importlib.import_module(f"{modules_pkg.__name__}.{info.name}")
        module = getattr(package, "MODULE", None)
        if isinstance(module, PortalModule):
            module.package_dir = Path(package.__file__).resolve().parent
            found.append(module)

    saved_order = get_saved_order()
    if saved_order:
        order_map = {mod_id: idx for idx, mod_id in enumerate(saved_order)}
        found.sort(
            key=lambda m: (
                0 if m.id in order_map else 1,
                order_map.get(m.id, m.order),
                m.title,
            )
        )
    else:
        found.sort(key=lambda m: (m.order, m.title))

    return found
