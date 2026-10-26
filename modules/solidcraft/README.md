# SolidCraft Module for One EAD

SolidCraft is an open-source, web-based parametric 3D CAD and solid modeling environment built with Rust and WebAssembly, integrated directly into One EAD as a first-class engineering design module.

Upstream Project: [https://github.com/tangency-labs/solidcraft](https://github.com/tangency-labs/solidcraft)

---

## Table of Contents
1. [Overview & Key Design Requirements](#overview--key-design-requirements)
2. [Architecture & Directory Structure](#architecture--directory-structure)
3. [Persistence & Autosave System](#persistence--autosave-system)
4. [Corporate Firewall & Offline Adaptation](#corporate-firewall--offline-adaptation)
5. [Release Management & Upstream Sync](#release-management--upstream-sync)
6. [Fullscreen Display Architecture](#fullscreen-display-architecture)
7. [API Endpoints Reference](#api-endpoints-reference)
8. [Privacy & Git Safety](#privacy--git-safety)

---

## Overview & Key Design Requirements

This plugin was designed to address several critical user requirements:

1. **Persistent Memory**: Projects, recovery states, and preferences must persist across One EAD restarts, browser reloads, and cache clears via automated local disk mirroring.
2. **Git Privacy**: User designs, 3D CAD models, recovery files, and installed binaries must never be uploaded to GitHub.
3. **Corporate Firewall Compatibility**: `solidcraft.io` domain calls are neutralized so the tool operates completely offline/locally without breaking under strict enterprise web proxies.
4. **Controlled Update Checks**: GitHub release check frequency is set to a 24-hour interval (daily) to minimize API usage and avoid rate limits.
5. **True Edge-to-Edge Fullscreen**: Dedicated fullscreen button and global `F11` key interceptors ensure complete immersion without portal headers or browser borders.

---

## Architecture & Directory Structure

```
modules/solidcraft/
├── __init__.py                # Module package definition
├── README.md                  # Comprehensive documentation (this file)
├── module.py                  # FastAPI router exposing /api/solidcraft/*
├── solidcraft.py              # Backend engine (release checker, installer, patcher, disk store)
├── source_sync.py             # Optional Git upstream tracking (tangency-labs & chlin1983)
├── web/                       # Frontend web assets
│   ├── index.html             # Wrapper portal page (top bar, updater, project modal)
│   ├── wrapper.js             # Wrapper controller and project management logic
│   ├── wrapper.css            # Wrapper styling and drawer layout
│   ├── persist.js             # Persistence engine injected into the WebAssembly app
│   └── app/                   # Extracted and patched SolidCraft WebAssembly bundle
└── data/                      # Local data directory (excluded from Git)
    ├── config.json            # Configuration (channel, check interval, auto-update)
    ├── installed.json         # Installed release metadata (tag, timestamp, asset)
    └── store/                 # User data store
        ├── prefs.json         # CAD preferences, theme, and UI settings mirror
        ├── projects/          # User CAD projects (*.solidcraft, recovery snapshots)
        └── trash/             # Soft-deleted designs
```

---

## Persistence & Autosave System

SolidCraft Web normally uses the browser's **Origin Private File System (OPFS)** via `navigator.storage.getDirectory()`. While fast, OPFS can be wiped if browser site data is cleared, when switching browser profiles, or between origin changes.

To solve this, One EAD implements a **Two-Layer Persistence System**:

### 1. SolidCraft Engine Autosave
- SolidCraft continuously writes snapshot files (`recovery.solidcraft` and `recovery.json`) to OPFS every **5 minutes** (configured by `autosave_minutes: 5.0`) and upon major geometric changes.
- If a crash occurs or the tab is closed, SolidCraft detects these snapshots on boot and displays a **"Recoverable Designs"** dialog (`"{file} · {features} features · autosaved {when}"`).

### 2. One EAD Continuous Disk Mirror ([persist.js](file:///c:/Users/Z00314DJ/Downloads/AntigravityProject/one-ead/modules/solidcraft/web/persist.js))
[persist.js](file:///c:/Users/Z00314DJ/Downloads/AntigravityProject/one-ead/modules/solidcraft/web/persist.js) is automatically injected into `<head>` of the SolidCraft app:
- **Recursive Polling (4-Second Heartbeat)**: Scans OPFS recursively. Whenever any design file or recovery snapshot is created or modified, it streams the binary to the FastAPI backend via `PUT /api/solidcraft/store/file/{path}`.
- **Local Disk Storage**: Files are saved to `modules/solidcraft/data/store/projects/`.
- **Event-Driven Flushing**: Triggers disk synchronizations on `visibilitychange` (switching browser tabs), `pagehide`, and `beforeunload`.
- **Preference Mirroring**: All `localStorage` preferences (`solidcraft.*` keys) are backed up to [prefs.json](file:///c:/Users/Z00314DJ/Downloads/AntigravityProject/one-ead/modules/solidcraft/data/store/prefs.json).
- **Startup Reconciliation**: On launch, [persist.js](file:///c:/Users/Z00314DJ/Downloads/AntigravityProject/one-ead/modules/solidcraft/web/persist.js) requests `/api/solidcraft/store/index`, fetches any missing or newer files from disk, and populates OPFS and `localStorage` before the CAD engine finishes initializing.

---

## Corporate Firewall & Offline Adaptation

Many corporate networks block `solidcraft.io` or third-party documentation domains. During bundle finalization (`_finalize_dist` in [solidcraft.py](file:///c:/Users/Z00314DJ/Downloads/AntigravityProject/one-ead/modules/solidcraft/solidcraft.py)):

1. **Domain Neutralization**:
   - All references to `https://solidcraft.io`, `https://docs.solidcraft.io`, and `https://solidcraft.ai` inside the bundle are stripped or replaced with safe anchors (`#`).
2. **Local Font & Asset Serving**:
   - Fonts and WebAssembly assets are loaded strictly from relative local paths (`./fonts/`, `./solidcraft-web-*.wasm`).
3. **Anonymous Read-Only GitHub API**:
   - Update checks perform an anonymous HTTP `GET` with empty payload requesting only release metadata. No project designs, names, corporate network details, or telemetry are ever sent.

---

## Release Management & Upstream Sync

SolidCraft is actively developed upstream. One EAD provides a hybrid update pipeline:

### 1. Prebuilt WebAssembly Releases (Recommended)
- **Check Interval**: Defaulted to **24 hours** (`LATEST_TTL_S = 86400`). Cached in memory to prevent rate limits.
- **Channels**:
  - `release`: Stable tagged releases from `tangency-labs/solidcraft`.
  - `nightly`: Latest development builds.
- **Atomic Swap (`_swap_into_place`)**: New releases are downloaded to a temporary folder, extracted, patched with [persist.js](file:///c:/Users/Z00314DJ/Downloads/AntigravityProject/one-ead/modules/solidcraft/web/persist.js), and swapped into `modules/solidcraft/web/app` atomically without corrupting the active session.

### 2. Source Code Sync ([source_sync.py](file:///c:/Users/Z00314DJ/Downloads/AntigravityProject/one-ead/modules/solidcraft/source_sync.py))
For developers building from source using Rust / Cargo:
- Tracks `upstream` (`https://github.com/tangency-labs/solidcraft.git`) and `origin` (`https://github.com/chlin1983/solidcraft.git`).
- Automatically manages git remotes and branches inside `modules/solidcraft/upstream/`.

---

## Fullscreen Display Architecture

Standard browser `F11` maximizes the browser window but leaves portal menus and wrappers visible. SolidCraft in One EAD achieves **true edge-to-edge canvas fullscreen**:

1. **Portal Header Button**:
   - A dedicated `[ ⛶ Full Screen ]` button on the top stage header calls `activeFrame.requestFullscreen()`.
2. **Global & Frame F11 Interceptors**:
   - `shell/portal.js` intercepts `F11` at the portal level.
   - [persist.js](file:///c:/Users/Z00314DJ/Downloads/AntigravityProject/one-ead/modules/solidcraft/web/persist.js) intercepts `F11` inside the iframe canvas and messages the parent window.
   - Both delegate directly to `requestFullscreen()` on the iframe element, completely hiding the portal navigation, sidebar, and tab bars.

---

## API Endpoints Reference

All endpoints are mounted under `/api/solidcraft/` by FastAPI:

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/status` | Current installation status, active version, update availability, and store summary |
| `POST` | `/check` | Force an immediate check for upstream releases |
| `POST` | `/install` | Trigger background download and installation of the target release |
| `POST` | `/config` | Update configuration (`channel`, `auto_update`, `check_interval_hours`) |
| `GET` | `/store/index` | List all saved CAD projects and recovery snapshots on disk |
| `GET` | `/store/file/{filename:path}` | Download a specific project file from disk store |
| `PUT` | `/store/file/{filename:path}` | Upload/sync a project file to disk store (up to 500 MB) |
| `DELETE` | `/store/file/{filename:path}` | Soft-delete a project (moves to `data/store/trash/`) |
| `GET` | `/store/prefs` | Retrieve saved CAD preferences and theme settings |
| `PUT` | `/store/prefs` | Persist CAD preferences and theme settings to disk |

---

## Privacy & Git Safety

To prevent accidental leaks of CAD models or engineering blueprints, the repository root [.gitignore](file:///c:/Users/Z00314DJ/Downloads/AntigravityProject/one-ead/.gitignore) enforces the following exclusions:

```gitignore
# SolidCraft plugin generated data, user projects, and binaries
modules/solidcraft/web/app/
modules/solidcraft/data/
modules/solidcraft/upstream/
*.solidcraft
*.solvecraft
```

* **Never Pushed to Git**: User project files, recovery snapshots, UI configurations, downloaded WebAssembly binaries, and upstream git clones remain 100% on the local computer.
