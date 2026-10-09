"""MEMS Microphone Explorer — interactive engineering textbook + 3D lab.

Fully client-side. The React/TypeScript source lives in ``app-src/`` and is built
(``npm run build`` there) into ``web/``; the portal only serves ``web/``.
"""

from __future__ import annotations

from server.module import PortalModule

ICON = (
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    '<rect x="8.5" y="1.5" width="7" height="13" rx="3.5" fill="currentColor"/>'
    '<path d="M4.5 10.5v1a7.5 7.5 0 0 0 15 0v-1"/>'
    '<line x1="12" y1="19" x2="12" y2="22"/>'
    '<line x1="8" y1="22" x2="16" y2="22"/>'
    '</svg>'
)

MODULE = PortalModule(
    id="mems-microphone-explorer",
    title="MEMS Microphone Explorer",
    subtitle="Interactive MEMS microphone textbook & 3D lab",
    icon=ICON,
    accent="#0ea5a4",
    order=70,
)

