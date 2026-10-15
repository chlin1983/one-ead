# PdfCraft Plugin for One EAD

## 1. Upstream Origin & Attribution
This plugin integrates **[PdfCraft](https://github.com/storytold/pdfcraft)** (MIT / Apache-2.0), an open-source, clean-room reimplementation of Adobe Acrobat rebuilt from scratch in pure Rust by storytold / ArtCraft.

- **Upstream Repository**: [https://github.com/storytold/pdfcraft](https://github.com/storytold/pdfcraft)
- **Official Website**: [https://getartcraft.com/apps/pdfcraft](https://getartcraft.com/apps/pdfcraft)
- **License**: MIT OR Apache-2.0

---

## 2. Overview
PdfCraft is a full-featured, private, and local PDF workbench compiled to WebAssembly:

- **Faithful Rendering Engine**: Deep typography, kerning, ligatures, vertical CJK, emoji, blend modes, soft masks, and gradients running on WebGPU / WebGL2.
- **Card-Style Page Organizer**: Card grid view for quick page selection, multi-page rotation, deletion, page extraction, and inserting blank or source pages.
- **Combine & Split**: Merge multiple PDFs while preserving bookmarks and outlines; split documents cleanly by page count or custom breaks.
- **Forms, Layers & Comments**: Interactive form field filling, optional content layer visibility toggling, and review comments.
- **Command Palette**: <kbd>Ctrl+K</kbd> (or <kbd>Cmd+K</kbd>) to instantly search and launch every tool and action.
- **Fearless Undo**: Deep multi-level undo (<kbd>Ctrl+Z</kbd>) that stays functional even after saving.
- **One EAD Local Workbench Library**:
  - Local disk storage under `data/docs/` for engineering reports and datasheets.
  - Seamless document selector and 1-click PDF upload.
  - Quick "Pop Out" to a dedicated browser tab.
  - Collapsible distraction-free toolbar with full-screen mode.

---

## 3. Directory Structure
```
modules/pdfcraft/
├── README.md           # Plugin documentation
├── __init__.py         # Package entrypoint exposing MODULE
├── module.py           # PortalModule manifest & FastAPI endpoints (/api/pdfcraft)
├── pdfcraft.py         # Lifecycle manager, version checker, and document library
├── data/
│   ├── config.json     # User preferences & channel config
│   ├── installed.json  # Installed version signature
│   └── docs/           # Local PDF library & specimens
└── web/
    ├── index.html      # Host container with workbench bar & iframe
    ├── wrapper.css     # Responsive workbench styling (light & dark)
    ├── wrapper.js      # Document switching, upload, fullscreen, and update client
    └── app/            # Extracted upstream WebAssembly bundle (WASM + JS + HTML)
```
