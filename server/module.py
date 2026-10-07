"""The portal module contract.

A *module* is a self-contained tool that plugs into the portal. Each module lives
in its own package under :mod:`modules` and exposes a module-level
``MODULE`` instance. Keeping the contract tiny (identity + an optional static web
folder + an optional API router) is what lets new tools be added without touching
the core or any existing module.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from fastapi import APIRouter


@dataclass
class PortalModule:
    """Describes one tool hosted by the portal.

    A module contributes a sidebar entry and, when opened, an isolated page loaded
    in an iframe from :attr:`web_dir`. Modules that need Python compute expose an
    :attr:`router`; those endpoints are mounted under ``/api/<id>``.
    """

    #: Stable, unique identifier (used in URLs). Lowercase, no spaces.
    id: str
    #: Human readable name shown in the sidebar.
    title: str
    #: Short one-line description shown under the title.
    subtitle: str = ""
    #: Inline SVG markup for the sidebar icon (24x24 viewBox recommended).
    icon: str = ""
    #: Accent colour (CSS colour) used to theme the module in the shell.
    accent: str = "#4f8cff"
    #: Sort order in the sidebar; lower numbers appear first.
    order: int = 100
    #: Folder (relative to the module package) holding the module's web assets.
    #: Its ``index.html`` is served at ``/modules/<id>/``.
    web_dir: str = "web"
    #: Optional FastAPI router for the module's backend endpoints.
    router: Optional[APIRouter] = None
    #: Populated by the registry: absolute path to this module's package.
    package_dir: Optional[Path] = field(default=None, repr=False)

    @property
    def entry_url(self) -> str:
        """URL the shell loads in the iframe when this module is opened."""
        return f"/modules/{self.id}/"

    @property
    def web_path(self) -> Optional[Path]:
        """Absolute path to the module's web asset folder, if it exists."""
        if not self.package_dir or not self.web_dir:
            return None
        candidate = self.package_dir / self.web_dir
        return candidate if candidate.is_dir() else None

    def manifest(self) -> dict:
        """JSON-serialisable summary sent to the shell frontend."""
        return {
            "id": self.id,
            "title": self.title,
            "subtitle": self.subtitle,
            "icon": self.icon,
            "accent": self.accent,
            "order": self.order,
            "entry": self.entry_url,
            "hasApi": self.router is not None,
        }
