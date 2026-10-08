# PDF Arranger Plugin for One EAD

## 1. Upstream Origin & Attribution
This plugin is powered by **[PDF Arranger](https://github.com/pdfarranger/pdfarranger)** (version 1.14.0, GNU General Public License v3.0).

- **Upstream Repository**: [https://github.com/pdfarranger/pdfarranger](https://github.com/pdfarranger/pdfarranger)
- **Official Releases**: [https://github.com/pdfarranger/pdfarranger/releases](https://github.com/pdfarranger/pdfarranger/releases)
- **License**: GNU General Public License v3.0 (GPL-3.0)

---

## 2. Overview
PDF Arranger is a standalone, offline PDF layout and page manipulation tool that allows you to:
- **Merge & Split** PDF documents.
- **Rearrange & Reorder** pages visually.
- **Rotate** pages clockwise (90°), counter-clockwise, or 180°.
- **Crop, Delete, & Duplicate** individual or multiple pages.
- **Export** selected pages or full documents into single/multiple PDFs or images (PNG/JPG).
- **100% Offline & Private**: All document operations execute locally on `127.0.0.1` without sending files over the network.

---

## 3. Architecture in One EAD
PDF Arranger is a native GTK3 application. Within One EAD, it is streamed to your browser via GTK's Broadway HTML5/WebSocket display daemon:

```
+-------------------------------------------------------------+
|                      Browser / Chrome                       |
|           One EAD Portal (http://127.0.0.1:8100/)           |
|                                                             |
|   +-----------------------------------------------------+   |
|   |         PDF Arranger Tab (<iframe>)                 |   |
|   |         Streams from http://127.0.0.1:8185/         |   |
|   +--------------------------^--------------------------+   |
+------------------------------|------------------------------+
                               | HTML5 / WebSockets
+------------------------------v------------------------------+
|               Local Background Daemons                      |
|   - Broadway Daemon (vendor/broadwayd.exe) on :8185         |
|   - PDF Arranger Process (pdfarranger.exe with GTK3)        |
+-------------------------------------------------------------+
```

---

## 4. How to Reorder Pages

### A. Visual Drag & Drop (Mouse)
1. **Click and drag** any page (or multiple selected pages).
2. **Visual Feedback**:
   - **Glowing Insertion Line**: A high-contrast blue vertical line with top (`▼`) and bottom (`▲`) triangle arrows indicates the exact seam where the page will drop.
   - **Floating Badge**: A translucent badge (`Move page X ➔` or `Move N pages ➔`) follows your mouse cursor.
   - **Grabbing Cursor**: Cursor shifts to a hand grip (`grabbing`) during drag motion.
3. **Release** the mouse button to drop the page into place. Full undo history (`Ctrl+Z`) is supported.

### B. Header Bar Buttons
- **`↶` (Undo)**: Revert the previous page reordering, rotation, deletion, or modification (<kbd>Ctrl+Z</kbd>).
- **`↷` (Redo)**: Re-apply the undone action (<kbd>Ctrl+Y</kbd> or <kbd>Ctrl+Shift+Z</kbd>).
- **`◀` (Move Page Left)**: Nudge selected page(s) one position to the left (<kbd>Alt+Left</kbd>).
- **`▶` (Move Page Right)**: Nudge selected page(s) one position to the right (<kbd>Alt+Right</kbd>).

### C. Right-Click Context Menu
- Right-click any slide and select **Move Page**:
  - **Move Left (Alt+Left)**
  - **Move Right (Alt+Right)**
  - **Move to Beginning**
  - **Move to End**

### D. Keyboard Shortcuts
- **`Alt + Left`** or **`Ctrl + Left`**: Move selected page(s) one position to the left.
- **`Alt + Right`** or **`Ctrl + Right`**: Move selected page(s) one position to the right.
- **`Ctrl + X` (Cut)** / **`Ctrl + V` (Paste)**: Cut pages from their current position and paste them after/before any chosen slide.
- **`Delete`**: Remove selected pages.
- **`Ctrl + Z` / `Ctrl + Y`**: Undo / Redo any page reordering or edit.

---

## 5. File Dialogs
- **Open**: Uses the standard native **Windows 11 File Explorer** dialog (`IFileOpenDialog`) with Quick Access, search, and multi-selection support (can open or import multiple PDFs at once).
- **Export / Save As**: Uses the native Windows 11 Save Dialog (`IFileSaveDialog`).

---

## 6. Directory Structure
```
modules/pdfarranger/
├── README.md               # This documentation
├── module.py               # One EAD portal integration & API endpoints
├── pdfarranger.py          # Process manager & Broadway daemon launcher
├── overrides/              # Git-tracked custom enhancements & patches
│   ├── lib/pdfarranger/    # Native Windows dialogs, Cairo drag overlay
│   └── share/pdfarranger/  # Streamlined toolbar & menu definitions
├── vendor/
│   └── broadwayd.exe       # GTK3 Broadway display daemon
└── pdfarranger/            # Portable PDF Arranger build (runtime, gitignored)
    ├── pdfarranger.exe     # Application binary
    └── lib/pdfarranger/    # Core application logic & UI handlers
```
