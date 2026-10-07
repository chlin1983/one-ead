# One EAD

A modular local web portal that consolidates your electroacoustic engineering
plugins into one place. Each plugin is a **self-contained unit** loaded in an
isolated iframe, so adding a new plugin never breaks the existing ones.

Everything runs locally on `localhost` — no cloud, no external services at
runtime.

## Quick start

```powershell
pip install -r requirements.txt
python run.py
```

This starts the server and opens <http://127.0.0.1:8100> in your browser.
(Or double-click `start.bat`.)

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
│   └── balance_armature/
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

| Plugin | Type | Status |
|--------|------|--------|
| Balanced Armature Simulator | Static (HTML + Web Audio) | Live |
| HXML Viewer | Python (`xml`) + Plotly | Live |
| ITS Report Compiler | Python (`pdfplumber`) + HTML table | Live |
| F1 Filter Simulator | Python (`numpy`/`scipy`) + Plotly | Live |
| my_dashboard | Static (React + TypeScript + Tailwind + D3) | Live |

The compute-heavy plugins keep their original Python logic on the backend
unchanged; only the UI moved to the browser. Plotting uses a locally vendored
Plotly (`shared/plotly.min.js`) so the portal works fully offline.
