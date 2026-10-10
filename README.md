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

This starts the server and opens <http://127.0.0.1:8100> in Google Chrome (or system default browser).

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

## Adding a new plugin

A plugin is one folder under `modules/`. Two kinds:

### 1. Static / client-side plugin (like the BA simulator)

```
modules/my_tool/
├── __init__.py            # from .module import MODULE
├── module.py              # MODULE = PortalModule(id="my-tool", title="My Tool", ...)
└── web/
    └── index.html         # (+ any css/js it needs)
```

### 2. Plugin with Python compute (e.g. numpy/scipy)

Add a FastAPI router in `module.py` and attach it:

```python
from fastapi import APIRouter
from server.module import PortalModule

router = APIRouter()

@router.get("/compute")
def compute():
    ...  # numpy / scipy lives here, unchanged from your original script
    return {"x": [...], "y": [...]}

MODULE = PortalModule(
    id="my-tool",
    title="My Tool",
    subtitle="What it does",
    router=router,     # mounted at /api/my-tool
)
```

Its frontend (`web/index.html`) calls `fetch('/api/my-tool/compute')` and plots
the result. The plugin appears in the sidebar automatically — no changes to the
core or any other plugin.

## Plugins

All plugins run 100% locally and offline.

| Plugin | ID | Type | Description | Status |
|--------|----|------|-------------|--------|
| **Executive Dashboard** | `my_dashboard` | React + TypeScript + D3 | High-level metrics, acoustic overview, and tool launcher | Live |
| **LLM Course & Fundamentals** | `llm-course` | Interactive Web + FastAPI | Step-by-step master roadmap & interactive guide based on Maxime Labonne's llm-course | Live |
| **HXML Viewer** | `hxml-viewer` | Python (`xml`) + Plotly | Hearing aid XML frequency response analyzer | Live |
| **ITS Report Compiler** | `its-report-compiler` | Python (`pdfplumber`) | Automated parsing and table compilation of ITS test reports | Live |
| **Component Database** | `component_database` | Python (`sqlite`/FastAPI) + Web | Searchable repository of electroacoustic components and datasheets | Live |
| **F1 Filter Simulator** | `f1-ipp-filter-simulator` | Python (`numpy`/`scipy`) + Plotly | Interactive digital and acoustic filter simulation | Live |
| **MEMS Microphone Explorer** | `mems-microphone-explorer` | Python + Plotly | MEMS microphone specifications, directivity, and frequency response | Live |
| **Balance Armature Receiver Explorer** | `balance-armature-receiver-explorer` | Static (HTML + Web Audio) | Real-time receiver modeling and acoustic simulation | Live |
| **Say (Speech-to-Text)** | `say` | ONNX Runtime (WebGPU / WASM) | Real-time, offline voice dictation and transcription powered by Whisper | Live |
| **Excalidraw Whiteboard** | `excalidraw` | Standalone Web Bundle | Offline hand-drawn diagramming, schematics, and brainstorming whiteboard | Live |
| **PDF Arranger** | `pdfarranger` | Python + GTK3 Broadway Daemon | Visual PDF page reordering, merging, splitting, cropping, and native file dialogs | Live |
| **Chili3D CAD** | `chili3d` | WebAssembly + OpenCascade | Browser-native parametric 3D CAD modeling with dual local persistence | Live |

---

### Featured Standalone Utilities

#### 1. PDF Arranger (`modules/pdfarranger/`)
Powered by [PDF Arranger](https://github.com/pdfarranger/pdfarranger), streamed seamlessly via GTK3 Broadway HTML5 daemon on `127.0.0.1:8185`:
- **Visual Drag & Drop Reordering**: High-contrast Cairo-rendered insertion guides and live drag badges.
- **Dedicated Toolbar Controls**: Instant **Undo** (`↶`), **Redo** (`↷`), **Move Left** (`◀`), and **Move Right** (`▶`) buttons directly in the header bar.
- **Native Windows 11 Dialogs**: Uses system `IFileOpenDialog` and `IFileSaveDialog` with Quick Access and search.
- **Streamlined Interface**: Clean layout without duplicate title headers, redundant import buttons, or extraneous window controls.
- **Smooth White Screen Restarts**: Broadway display styled to maintain a clean white background during reloads.
- **Tracked Customizations**: Custom patches and UI definitions are maintained in `modules/pdfarranger/overrides/`, keeping heavy portable binaries out of Git.

#### 2. Excalidraw Whiteboard (`modules/excalidraw/`)
Powered by [Excalidraw](https://github.com/excalidraw/excalidraw):
- **100% Offline Canvas**: Packaged with all fonts, assets, and local persistence.
- **Clean Workspace**: Streamlined toolbar without redundant branding headers for maximum drawing canvas space.

#### 3. Chili3D CAD (`modules/chili3d/`)
Powered by [Chili3D](https://github.com/xiangechen/chili3d):
- **Parametric 3D Solid Modeling**: Full CAD capabilities with sketches, extrusions, revolutions, fillets, and booleans in WebAssembly.
- **Dual Persistence Mirror**: Saves instantaneously to browser IndexedDB and mirrors projects to server disk (`data/store/`) so models persist across cache clears and restarts.
- **Document Switcher & Auto-save**: Multi-document tab bar with automatic background saving.
- **Full Screen CAD Workflow**: Locks Escape key via Keyboard Lock API so pressing Esc deselects objects without exiting fullscreen.

#### 4. Say Dictation (`modules/say/`)
- **Offline Speech-to-Text**: Runs Whisper models locally in the browser using ONNX Runtime WebGPU and WASM SIMD.
- **Domain Biasing & VAD**: Built-in voice activity detection and audio chunk streaming.

#### 5. LLM Fundamentals & Course Guide (`modules/llm_course_guide/`)
Powered by [mlabonne/llm-course](https://github.com/mlabonne/llm-course) by Maxime Labonne:
- **Comprehensive 4-Track Curriculum**: Fundamentals (Math, Python, Neural Nets, NLP), Scientist (Architecture, Pre-training, SFT/LoRA, Alignment, Quantization, Merging), Engineer (vLLM serving, Vector DBs, RAG, Agents), and 1-Click Colab tools.
- **5 Interactive Simulators**: Subword Tokenizer, Temperature & Top-P Sampling, Quantization VRAM Calculator, Embedding Cosine Similarity, and Attention Heatmap.
- **Local Disk Persistence**: Progress, quiz answers, and personal study notes are auto-saved to disk at `modules/llm_course_guide/data/progress.json`.
- **Default Light Theme**: Styled to seamlessly match the One EAD portal interface with instant theme switching.


