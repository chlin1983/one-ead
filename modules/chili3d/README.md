# Chili3D CAD Plugin for One EAD

## 1. Upstream Origin & Attribution
This plugin integrates **[Chili3D](https://github.com/xiangechen/chili3d)** (GNU Affero General Public License v3.0), a web-based parametric 3D CAD application built on OpenCascade technology and WebAssembly.

- **Upstream Repository**: [https://github.com/xiangechen/chili3d](https://github.com/xiangechen/chili3d)
- **License**: GNU Affero General Public License v3.0 (AGPL-3.0)

---

## 2. Overview
Chili3D brings full-featured, browser-native 3D solid modeling directly into the One EAD portal:
- **Parametric 3D CAD**: Sketching, extrusion, revolving, fillets, chamfers, boolean operations, and assembly modeling.
- **WASM OpenCascade Engine**: High-performance boundary-representation (B-Rep) geometry kernel compiled to WebAssembly.
- **Dual Persistence Architecture**:
  - Browser IndexedDB for instant interactive caching.
  - Server-side disk mirror (`data/store/`) ensuring designs survive browser cache clears, port changes, and computer reboots.
- **Doc Switcher & Auto-save**: Built-in multi-document switcher and automatic background disk synchronization.

---

## 3. Directory Structure
```
modules/chili3d/
├── README.md           # This documentation
├── __init__.py         # Module package initializer
├── module.py           # One EAD plugin manifest & API router
├── chili3d.py          # Build lifecycle, installer, and disk store manager
└── web/                # Plugin frontend
    ├── index.html      # Host container with status banner & iframe loader
    ├── wrapper.js      # Host-app communication & update listener
    ├── wrapper.css     # Responsive wrapper styling
    ├── persist.js      # IndexedDB ↔ disk mirror bridge
    ├── autosave.js     # Periodic project state checkpointing
    └── doc-switcher.js # Multi-file document switching bar
```
