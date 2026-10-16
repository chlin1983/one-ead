, 

# One EAD

A modular local web portal that consolidates your electroacoustic engineering
plugins into one place. Each plugin is a **self-contained unit** loaded in an
isolated iframe, so adding a new plugin never breaks the existing ones.

Everything runs locally on `localhost` — no cloud, no external services at
runtime.

## Quick start

Simply double-click **`start.bat`** (or run `start.bat` from a terminal).

`start.bat` handles everything automatically:

1. **Python Check**: Verifies Python 3.10+ is accessible in system PATH (displays helpful instructions if not found).
2. **Smart Dependency Check**: On a fresh PC / initial clone, it automatically installs all required dependencies (`requirements.txt`, including `pymupdf`, `fastapi`, `uvicorn`, `pdfplumber`, `numpy`, `scipy`, etc.).
3. **Instant Subsequent Launches**: Caches the verification signature in `.deps_ok` so subsequent launches skip pip checks entirely and start immediately.

Alternatively, you can install and launch manually:

```powershell
pip install -r requirements.txt
python run.py
```

This starts the server and opens [http://127.0.0.1:8100](http://127.0.0.1:8100) in Google Chrome (or system default browser).

Options:

```powershell
python run.py --port 9000     # different port
python run.py --no-browser    # don't auto-open a browser
python run.py --reload        # auto-reload while developing
```

## Architecture

```
one-ead/
├── run.py                 # entry point (starts Uvicorn, opens browser)
├── server/
│   ├── app.py             # FastAPI app: /api/modules, mounts modules + shell
│   ├── registry.py        # auto-discovers modules in modules/
│   └── module.py          # PortalModule contract (the plugin interface)
├── modules/               # one folder per plugin — drop-in, auto-registered
│   └── balance_armature_receiver_explorer/
│       ├── module.py      # MODULE manifest (id, title, icon, ...)
│       └── web/           # the plugin's HTML/JS/CSS (served at /modules/<id>/)
├── shared/                # vendored libraries (Plotly) + common module.css
└── shell/                 # the portal launcher UI (sidebar + iframe host)
    ├── index.html
    ├── portal.css
    └── portal.js
```

The shell (frontend) is intentionally framework-free vanilla JavaScript, so the
only prerequisite is Python. Compute-heavy plugins keep their Python logic on the
backend and expose it through the plugin's optional API router.

## Plugins (Modules)

All plugins (modules) run 100% locally and offline.

| Plugin                                       | ID                                     | Type                                                    | Description                                                                          | Status |
| -------------------------------------------- | -------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------ |
| **Executive Dashboard**                | `my_dashboard`                       | React + TypeScript + D3                                 | High-level metrics, acoustic overview, and tool launcher                             | Live   |
| **HXML Viewer**                        | `hxml-viewer`                        | Python (`xml`) + Plotly                               | Hearing aid XML frequency response analyzer                                          | Live   |
| **ITS Report Compiler**                | `its-report-compiler`                | Python (`pdfplumber`)                                 | Automated parsing and table compilation of ITS test reports                          | Live   |
| **Component Database**                 | `component_database`                 | Python (`sqlite`/FastAPI) + Web                       | Searchable repository of electroacoustic components and datasheets                   | Live   |
| **F1 Filter Simulator**                | `f1-ipp-filter-simulator`            | Python (`numpy`/`scipy`) + Plotly                   | Interactive digital and acoustic filter simulation                                   | Live   |
| **MEMS Microphone Explorer**           | `mems-microphone-explorer`           | Python + Plotly                                         | MEMS microphone specifications, directivity, and frequency response                  | Live   |
| **Balance Armature Receiver Explorer** | `balance-armature-receiver-explorer` | Static (HTML + Web Audio)                               | Real-time receiver modeling and acoustic simulation                                  | Live   |
| **Excalidraw Whiteboard**              | `excalidraw`                         | Standalone Web Bundle                                   | Offline hand-drawn diagramming, schematics, and brainstorming whiteboard             | Live   |
| **PdfCraft**                           | `pdfcraft`                           | Pure Rust WebAssembly                                   | Open-source PDF workbench & editor with card page organizer, forms, combine & split | Live   |
| **Chili3D CAD**                        | `chili3d`                            | WebAssembly + OpenCascade                               | Browser-native parametric 3D CAD modeling with dual local persistence                | Live   |
| **DeepTutor**                          | `deep-tutor`                         | Upstream PyPI package (`deeptutor`) in a private venv | AI tutoring workspace that always tracks the newest upstream release                 | Live   |
| **GPT Researcher**                     | `gpt-researcher`                     | `gpt-researcher` in private venv + local Ollama       | Offline-first engineering research assistant driven by local Ollama models           | Live   |
| **WeKnora**                            | `weknora`                            | Standalone Lite Binary (Go/SQLite) + Local LLM          | Document understanding & RAG knowledge base optimized for 6GB VRAM / 16GB RAM       | Live   |


---

### Featured Standalone Utilities

#### 1. Excalidraw Whiteboard (`modules/excalidraw/`)

Powered by [Excalidraw](https://github.com/excalidraw/excalidraw):

- **100% Offline Canvas**: Packaged with all fonts, assets, and local persistence.
- **Clean Workspace**: Streamlined toolbar without redundant branding headers for maximum drawing canvas space.

#### 2. Chili3D CAD (`modules/chili3d/`)

Powered by [Chili3D](https://github.com/xiangechen/chili3d):

- **Parametric 3D Solid Modeling**: Full CAD capabilities with sketches, extrusions, revolutions, fillets, and booleans in WebAssembly.
- **Dual Persistence Mirror**: Saves instantaneously to browser IndexedDB and mirrors projects to server disk (`data/store/`) so models persist across cache clears and restarts.
- **Document Switcher & Auto-save**: Multi-document tab bar with automatic background saving.
- **Full Screen CAD Workflow**: Locks Escape key via Keyboard Lock API so pressing Esc deselects objects without exiting fullscreen.

#### 3. PdfCraft Workbench (`modules/pdfcraft/`)

Powered by [PdfCraft](https://github.com/storytold/pdfcraft) (MIT / Apache-2.0) by storytold:

- **Pure Rust WebAssembly Engine**: Clean-room, high-performance reimplementation of Adobe Acrobat compiled directly to WebAssembly with WebGPU / WebGL2 rendering.
- **Card-Style Page Organizer**: Interactive page grid to rotate, reorder, extract, delete, or insert blank and file pages with deep undo history (<kbd>Ctrl+Z</kbd>).
- **Combine & Split**: Merge multiple PDFs while preserving nested outlines/bookmarks, or split documents by page intervals.
- **Form Filling, Layers & Comments**: Interactive form field filling, optional content layer toggling, and review comments.
- **Integrated Local Library**: Browse, switch, and upload PDFs into your workbench library with instant rendering and pop-out support.

#### 4. DeepTutor (`modules/deep_tutor/`)

Powered by [DeepTutor](https://github.com/HKUDS/DeepTutor) (Apache-2.0) from the HKU Data Intelligence Lab, installed from its upstream PyPI package (`deeptutor`) into a private venv:

- **Agent-Native Tutoring Workspace**: Chat, quizzes, research, books, knowledge bases, and memory in one embedded web app.
- **Always Up to Date**: Nothing is pinned; the plugin checks PyPI for the newest release and auto-updates (or offers an **Update** button), reinstalling the previous version if an install fails. User data is never touched by updates.
- **No Upstream Code in Git**: Downloads land in git-ignored `modules/deep_tutor/data/`; only thin glue code (installer, launcher, wrapper page) is tracked here.
- **Loopback-Only Security**: Upstream's `0.0.0.0` binding is rewritten to `127.0.0.1` so the app and your API keys are reachable from this machine only (ports `3782` web / `8001` API by default).
- **One-Command Local AI Setup**: `setup_local_ai.py` (also in the plugin menu → **Local AI setup…**) installs Ollama and models (Standard: `gemma4:e4b` + `qwen3:8b`; Light: `qwen3:4b`) with `nomic-embed-text` embeddings, asking before every install or download.
- **Knowledge Base Renaming**: Injected pencil button on Knowledge Center cards sets a display name without changing the underlying folder identity.
- **Prerequisites**: Internet for first install, Node.js 20+, and `uv` or Python 3.11-3.14. See [modules/deep_tutor/README.md](modules/deep_tutor/README.md) for details.

#### 6. GPT Researcher (`modules/gpt_researcher/`)

Powered by [gpt-researcher](https://github.com/assafelovic/gpt-researcher) driven by local [Ollama](https://ollama.com):

- **100% Offline & Private AI Research**: Runs on local Ollama models (e.g. Gemma, Qwen) with loopback enforcement and whitelisted environment variables.
- **Sectioned In-Depth Technical Reports**: Generates comprehensive, multi-section engineering reports (up to 2,500+ words) even within compact 8k-token model context windows.
- **Polite & Rate-Limited Research Sources**: Supports local document archives (PDF, DOCX, XLSX, TXT) alongside rate-limited academic endpoints (arXiv, Semantic Scholar, OpenAlex, PubMed Central).
- **Report & Document Management**: File reports into custom folders, rename reports, inspect interactive citation jumps, and export publication-ready A4 PDFs.
