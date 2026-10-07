# Small Tools plugin

Card launcher for small standalone utilities. Plugin id `small-tools`, API under `/api/small-tools`.

| Tool         | Upstream                                   | License | Runs as                                           |
| ------------ | ------------------------------------------ | ------- | ------------------------------------------------- |
| PDF Arranger | https://github.com/pdfarranger/pdfarranger | GPL-3.0 | Desktop app streamed into the page (GTK Broadway) |
| Excalidraw   | https://github.com/excalidraw/excalidraw   | MIT     | Static web app served by the portal               |

Both work fully offline.

## Tools

### PDF Arranger

- Version: 1.14.0, Windows portable build. GPL-3.0: https://github.com/pdfarranger/pdfarranger/blob/main/COPYING
- What it is: native GTK desktop app (a front end for pikepdf) to merge, split, rotate, crop, delete and reorder PDF pages. It does not edit text inside pages.
- Offline: no network use. Everything listens on 127.0.0.1 only. A launch test showed no outbound connections.

Install (see [pdfarranger.py](pdfarranger.py)):

- On first card click the plugin downloads `pdfarranger-1.14.0-windows-portable.zip` from the project's GitHub releases and checks its SHA-256 against the pinned value before unpacking.
- It is unpacked straight into `pdfarranger/` (next to this README). Nothing is installed system-wide and no admin rights are needed. A reinstall keeps the existing `pdfarranger/config.ini`.
- `pdfarranger/` is excluded from git by [.gitignore](.gitignore). Do not copy it to other people: redistributing the GPL binary carries source-offer obligations. Internal use has none.

How it is shown in the page:

- The GTK app is run with GTK's Broadway backend. `vendor/broadwayd.exe` (GTK 3.24.52, LGPL-2.1+, from MSYS2 package `mingw-w64-x86_64-gtk3-3.24.52-1`, SHA-256 `8D00266E5A5ADAA8BDE52827229B89FB25BB1920A780B20D771CED5B08BB3E1A`) streams its window to a web page on port 8185 (display `:tcp5`, app link port 9095), which the card embeds in an iframe. Keep the broadwayd version equal to the GTK version inside the PDF Arranger bundle.
- Clicking the card starts `broadwayd.exe` and `pdfarranger.exe` (hidden, no desktop window). Both stop when One EAD exits. If you quit PDF Arranger from inside, the page offers "Reopen".
- Each launch writes `maximized = True` and `content-loss-warning = False` to `pdfarranger/config.ini` so the window fills the page and the first-run note is skipped.
- Open/Save dialogs are native Windows dialogs. [winfocus.py](winfocus.py) brings them to the front and centres them, because a background process is otherwise not allowed to take the foreground.
- Files: File > Open / Save browse this PC's disk. Dragging files in from Windows Explorer does not work.

To upgrade, change `VERSION` and `ZIP_SHA256` in [pdfarranger.py](pdfarranger.py) (the digest is shown on the GitHub release page), then delete the `pdfarranger/` folder so it is downloaded again.

### Excalidraw

- Upstream: https://github.com/excalidraw/excalidraw (npm package `@excalidraw/excalidraw` ^0.18.1). MIT: https://github.com/excalidraw/excalidraw/blob/master/LICENSE
- What it is: virtual whiteboard for hand-drawn style diagrams, wireframes, flowcharts and architecture sketches. Export to PNG, SVG and `.excalidraw` works as in upstream.
- Offline: the built app and its fonts are served from `web/excalidraw/`. Nothing is loaded from a CDN. Nothing to download or install, so the card shows as ready straight away.
- Embedded: opens in the page like the other tools, with an "Open in tab" button.

Storage (see [excalidraw.py](excalidraw.py)):

- Drawings are saved to disk as JSON in `data/drawings/<id>.json`, with a `manifest.json` listing names, timestamps and the active board. The page saves automatically while you draw, so boards survive restarts and a different browser.
- `data/` is not git-ignored and holds your drawings, so it will be committed. Add `data/` to [.gitignore](.gitignore) if drawings must stay out of version control.
- Several boards are supported: create, rename, duplicate, switch and delete. Deleting moves the file to `data/trash/` instead of erasing it, and the manifest is rebuilt from the files on disk if it is ever damaged.
- Endpoints, under `/api/small-tools/tools/excalidraw/`: `files` (GET, POST), `files/{id}` (PATCH, DELETE), `files/{id}/duplicate`, `files/{id}/active`, `scene?file=<id>` (GET, POST).

Rebuild the web app (only needed to change or upgrade Excalidraw):

1. Run `excalidraw_build/build.ps1` (needs Node.js and npm). It installs dependencies, builds into `web/excalidraw/`, copies the fonts, then deletes `node_modules`.
2. The built `web/excalidraw/` is kept in the repo, so normal use needs no Node.js.

## Adding another tool

1. Add an entry to `TOOLS` in [module.py](module.py) and register its manager in `_MANAGERS`.
2. Write a manager module exposing `TOOL_ID`, `status()`, `start_install()` and `launch()`. A tool that is served by the portal itself (like Excalidraw) returns `running` and `ready` as true and a `url` under `/modules/small-tools/`.
3. Add a card icon in `ICONS` in [web/app.js](web/app.js).
4. Add the tool's upstream URL and license to this file.
