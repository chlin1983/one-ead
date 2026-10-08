# Excalidraw Whiteboard Plugin for One EAD

## 1. Upstream Origin & Attribution
This plugin is powered by **[Excalidraw](https://github.com/excalidraw/excalidraw)**, a virtual collaborative whiteboard tool for sketching hand-drawn like diagrams.

- **Upstream Repository**: [https://github.com/excalidraw/excalidraw](https://github.com/excalidraw/excalidraw)
- **License**: MIT License / Open Source

---

## 2. Overview
Excalidraw is an offline-first sketching and diagramming tool integrated directly into One EAD as a standalone plugin:
- **Hand-drawn feel**: Shapes, text, arrows, freethand drawing, and mathematical symbols.
- **Library of components**: Easily create architectural sketches, electroacoustic schematics, and UI flows.
- **Local persistence**: Drawings and states are saved locally in browser storage and can be exported as `.excalidraw`, `.png`, or `.svg`.
- **Zero external dependencies**: Bundled with all required fonts and static canvas assets for complete offline use.

---

## 3. Directory Structure
```
modules/excalidraw/
├── README.md           # This documentation
├── module.py           # One EAD plugin definition & metadata
└── web/                # Self-contained frontend bundle
    ├── index.html      # Host container page
    ├── style.css       # Fullscreen layout & theme styling
    └── canvas/         # Packaged Excalidraw application and web fonts
```
