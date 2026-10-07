"""Balanced Armature receiver simulator — first portal module.

This is a fully client-side tool (HTML + JS + Web Audio), so it has no backend
router; the portal simply serves its ``web/`` folder. It is exposed to the shell
through the module-level ``MODULE`` instance below.
"""

from __future__ import annotations

from server.module import PortalModule

# Speaker/driver icon - a balanced armature is a miniature speaker/receiver, so this
# reads more intuitively than a generic waveform (which was indistinguishable from the
# F1 IPP Filter Simulator's icon).
ICON = (
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    '<path d="M11 5 6 9H3v6h3l5 4V5z"/>'
    '<path d="M16 9a3 3 0 0 1 0 6"/>'
    '<path d="M18.5 7a7 7 0 0 1 0 10"/>'
    '</svg>'
)

MODULE = PortalModule(
    id="balance-armature",
    title="Balanced Armature Simulator",
    subtitle="Electromechanical & acoustic physics engine",
    icon=ICON,
    accent="#4f8cff",
    order=20,
)
