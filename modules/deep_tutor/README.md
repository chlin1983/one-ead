# DeepTutor Plugin for One EAD

This plugin embeds **[DeepTutor](https://github.com/HKUDS/DeepTutor)** (Apache License 2.0), an agent-native
tutoring workspace (chat, quizzes, research, books, knowledge bases, memory) from the HKU Data Intelligence Lab.

## Where the plugin comes from

| | |
|---|---|
| **Upstream project** | [github.com/HKUDS/DeepTutor](https://github.com/HKUDS/DeepTutor) |
| **Upstream docs** | [deeptutor.info](https://deeptutor.info/) |
| **License** | Apache-2.0 ([LICENSE](https://github.com/HKUDS/DeepTutor/blob/main/LICENSE)) |
| **Distribution used** | PyPI package [`deeptutor`](https://pypi.org/project/deeptutor/), the upstream's own "Option 1 - Install From PyPI" path in its README |
| **Maintainers** | Led by [Bingxi Zhao](https://github.com/pancacake) within [HKUDS](https://github.com/HKUDS) |
| **Paper** | [arXiv:2604.26962](https://arxiv.org/abs/2604.26962) |

**No upstream code is copied into this repository.** Everything the plugin downloads lands in
`modules/deep_tutor/data/`, which is git-ignored. Only the thin glue code in this folder is ours:

| File | Role |
|---|---|
| `module.py` | Plugin registration and `/api/deep-tutor/*` endpoints |
| `deep_tutor.py` | Install / update / start / stop manager |
| `_serve.py` | Runs upstream's launcher, forced to loopback only (see Security) |
| `setup_local_ai.py` | One-command local AI setup (Ollama, models, DeepTutor settings); also behind the plugin's setup button |
| `web/` | Wrapper page: status bar, installer, embeds the DeepTutor web app |

## How it stays up to date

Upstream releases often (roughly every few days), so nothing is pinned:

1. Opening the plugin looks up the newest version on PyPI (cached 30 min; menu → **Check for updates** forces it).
2. If it is newer than the installed one and **Auto-update** is on (default), the plugin stops the service,
   runs `pip install deeptutor==<latest>` in its private venv, restarts the service and reloads the page.
   With Auto-update off, an **Update** button appears instead.
3. If an install fails, the previous version is reinstalled.

Your data is never touched by updates (see below).

## First run

Needs internet, **Node.js 20+** on `PATH` (upstream's web server), and either [`uv`](https://docs.astral.sh/uv/)
or a system Python 3.11-3.14 (the portal's own Python may be older; the plugin builds its own venv).
The first install downloads a few hundred MB and the first start takes a minute or two.

Then configure a model provider inside DeepTutor: **Settings → Providers**, then **Language models**.
Without one the app opens but cannot answer.

### Local AI setup (private models on this PC)

For a fresh PC (or a fresh clone) there is a one-command setup that installs Ollama, downloads the models and
applies the same DeepTutor configuration. It **asks before every install and download**, because it needs real
hardware and disk space:

```powershell
python modules\deep_tutor\setup_local_ai.py            # interactive, asks before each step
python modules\deep_tutor\setup_local_ai.py --check    # only reports your PC and what is missing
```

| Model set | Models | Download | Suggested PC |
|---|---|---|---|
| **Standard** | `gemma4:e4b` (active) + `gemma4:12b` + `qwen3:8b` + `nomic-embed-text` | about 23 GB | 16 GB RAM, GPU with 6 GB+ memory, about 30 GB free disk |
| **Light** | `qwen3:4b` + `nomic-embed-text` | about 3 GB | 8 GB RAM, no GPU needed, about 6 GB free disk |

What it can do, each step optional: install Node.js, `uv` and Ollama (via `winget`; Windows may ask for
permission), set the Ollama environment variables from the handover notes (restarts Ollama), download the models,
install DeepTutor if needed, and apply the provider settings. Non-interactive use needs explicit consent flags:
`--yes --preset light --install-ollama --install-node --install-uv --ollama-env` (installs happen only for the
flags you pass). DeepTutor must be stopped while it runs (plugin menu → **Stop service**), and chats stay local.

**Not ready to install Ollama yet?** Click **Not now** on the banner. The same setup stays available any time from
the plugin menu → **Local AI setup…**, which shows your PC's RAM, disk and GPU against the requirements, lets you
pick a model set and tick what to install, and has a **Run setup now** button plus the terminal command to copy.
The banner only shows while no chat model is configured.

## Where things live (all under `modules/deep_tutor/data/`)

| Path | Contents |
|---|---|
| `venv/` | Private Python environment with the `deeptutor` package (safe to delete; it is re-created) |
| `home/` | Upstream runtime home: `data/user/settings/` (**API keys**), chats, knowledge bases, memory, notebooks |
| `config.json` | Plugin settings (auto-update) |
| `service.log` | Output of the DeepTutor service |

Back up `home/` to keep your DeepTutor data. Do not commit or share it: it contains your API keys.

## Ports and security

- DeepTutor uses ports **3782** (web) and **8001** (API) by default; if either is busy the plugin picks the next
  free one and records it in upstream's own `system.json`.
- Upstream's launcher binds to `0.0.0.0` (the whole network) and has authentication off by default, which would let
  anyone on the LAN spend your LLM keys. `_serve.py` rewrites that to `127.0.0.1`, so the app is reachable from
  this machine only.
- The service starts with the plugin page and stops when One EAD exits (or via menu → **Stop service**).

## Troubleshooting

- **Setup failed:** the page shows the install log. Common causes: no network, no `uv`/Python 3.11-3.14, no Node.js.
- **Stuck on "Starting":** see `data/service.log`; use menu → **Restart service**.
- **Start over:** stop One EAD, delete `data/venv`, reopen the plugin (keeps `data/home`).

---

# Handover notes (state of the groundwork, for picking this up later)

## Current state (2026-10-10)

- Plugin id `deep-tutor`, sidebar order 88, folder `modules/deep_tutor/`. Tested: fresh install (~3 min), start
  (~45 s to ready), loopback-only binding, clean stop, and a real chat turn against a local model.
- Installed upstream version at the time of writing: **v1.6.14**.
- Privacy-first local setup is configured in `data/home` (see below). Nothing is sent to a cloud LLM and web search is off.
- Not verified: the wrapper page was tested only through the backend API, plus the user's own browser
  (page loads, status shows Running, Settings opens inside the iframe). Knowledge-base ingestion with the embedding
  model and Qwen3's reasoning output have not been exercised.

## Local model setup (Ollama)

| Service | Provider name in UI | Model | Endpoint |
|---|---|---|---|
| Chat | Ollama – Gemma | `gemma4:e4b` (active), `gemma4:12b`, `qwen3:8b` | `http://127.0.0.1:11434/v1` |
| Embedding | Ollama – Embeddings | `nomic-embed-text` (768 dims) | `http://127.0.0.1:11434/api/embed` |
| Search | Search (disabled) | none | n/a |

- Applied non-interactively with `data/setup-ollama.json` through upstream's `deeptutor config apply`. That command
  creates profiles named "Agent Setup"; they were renamed by editing `data/home/data/user/settings/model_catalog.json`
  (stop the service first, edit, then start it, otherwise the running app can overwrite the file).
- Switch chat model in the DeepTutor UI: **Settings → Language models**.
- Hardware: 6 GB VRAM, 16 GB RAM. `gemma4:e4b` is 9.6 GB so it partly runs on CPU; `qwen3:8b` (5.2 GB) is the likely
  better fit. Ollama's default 4096-token context is too small (DeepTutor prompts alone reach ~4000 tokens, which
  ends turns with "model exhausted its output budget on internal reasoning"). User-level Ollama environment
  variables now set: `OLLAMA_CONTEXT_LENGTH=8192`, `OLLAMA_FLASH_ATTENTION=1`, `OLLAMA_KV_CACHE_TYPE=q8_0`
  (restart Ollama after changing them). With these `gemma4:e4b` stays 100% on a 6 GB GPU (3.2 GB); 16384
  pushed it to 9.5 GB and about two thirds onto the CPU. Check with `ollama ps`. Optionally add
  `OLLAMA_KEEP_ALIVE=30m` to avoid slow reloads.
- A **Task model** (for naming chats and other background jobs) is not set. `qwen3:4b` would suit; it must be set in
  the UI because `config apply` does not cover it.
- Removing a provider in the UI is blocked while any model still uses it; remove its models first.

## How the plugin works (so you can change it safely)

| Concern | Where / how |
|---|---|
| Latest version lookup | `deep_tutor.py` `check_latest()`: PyPI JSON for `deeptutor`, cached 30 min |
| Install / upgrade | `start_install()` runs a background job: stop service, create venv if needed (`uv venv --python ">=3.11,<3.15" --seed`, or a system Python 3.11-3.14 if `uv` is missing), `pip install deeptutor==<latest>`, restart. On failure the previous version is reinstalled |
| Run | `start_service()` spawns `python _serve.py data/home`, which calls upstream's `deeptutor.runtime.launcher.start()` after rewriting `0.0.0.0` to `127.0.0.1` |
| Stop | `stop_service()`: Ctrl+Break for a clean shutdown, `taskkill /T /F` after 20 s; also registered with `atexit` |
| Orphans | `data/run.json` holds the launcher PID. If One EAD died without stopping it, the next start adopts it only if its web port answers |
| Ports | Defaults 3782 / 8001; moved to the next free ones and written to upstream's `system, `local-ai`, `local-ai/setup`.json` |
| API | `/api/deep-tutor/` `status`, `check`, `install`, `config`, `start`, `stop`, `restart` (see `module.py`) |
| UI | `web/wrapper.js` polls `/status` every 2 s, shows installer/starting states, otherwise iframes `http://127.0.0.1:<port>/?oe=<version>` (the query forces a reload after an upgrade) |

Gotchas found while building it:
- The portal's own Python is 3.10; DeepTutor needs 3.11-3.14, hence the private venv.
- The first backend start can exceed upstream's default 60 s readiness wait, so `DEEPTUTOR_BACKEND_READY_TIMEOUT=600` is set.
- Upstream's launcher ignores the `BACKEND_HOST` / `FRONTEND_HOST` variables mentioned in its README (version 1.6.14), hence the shim.
- Killing a terminal running `deeptutor start` leaves its backend and frontend running; end them with `taskkill /PID <pid> /T /F`.
- The setup job (`start_local_ai_setup`) stops the service, runs `setup_local_ai.py --yes ...` and restarts the service.
  `deeptutor config apply` normally takes 2-12 s but hung once for over 6 minutes when launched from the portal
  (not reproduced in 4 later runs). Child processes now get `stdin=DEVNULL` and `config apply` has a 4-minute timeout.
  The winget install paths (Ollama, Node.js, uv) were written but not exercised, since all three were already installed.
- `deeptutor doctor --online` fails with `'ResolvedLLMConfig' object has no attribute 'get_api_key'` for a local provider
  (upstream bug, 1.6.14). A real chat turn works: `deeptutor run chat "ping" --format json` with `DEEPTUTOR_HOME` set to `data/home`.
- The shim relies on the private function `launcher._spawn`. If an upstream update renames it, the shim prints
  `loopback-only binding: UNAVAILABLE` in `data/service.log` and the app would listen on all interfaces.
  Check that line after upgrades, and check `Get-NetTCPConnection -State Listen -LocalPort 3782,8001` shows `127.0.0.1`.

## Useful commands

Run from the repo root. `$d` is `modules\deep_tutor\data`.

```powershell
$d = "modules\deep_tutor\data"; $env:DEEPTUTOR_HOME = "$d\home"
& "$d\venv\Scripts\deeptutor.exe" config show          # resolved settings, credentials redacted
& "$d\venv\Scripts\deeptutor.exe" doctor --format json # local readiness
& "$d\venv\Scripts\deeptutor.exe" --help               # upstream CLI
Invoke-RestMethod -Method Post http://127.0.0.1:8100/api/deep-tutor/restart
Invoke-RestMethod http://127.0.0.1:8100/api/deep-tutor/status
```

## Possible next steps

- Set a Task model (`qwen3:4b`) and compare `gemma4:e4b` with `qwen3:8b` on real tutoring questions.
- Test a knowledge base end to end (upload a small PDF, ask about it) with `nomic-embed-text`.
- Optional "track `main`" channel: needs a source install plus a Next.js build, as the Chili3D plugin does. Not built.
- Optional privacy hardening: set `"version_check_enabled": false` in `data/home/data/user/settings/system.json`
  and turn off Auto-update in the plugin menu to remove routine outbound requests.
- Optional: back up `data/home` on a schedule; it holds all chats, knowledge bases and API keys.
- Upstream changes quickly. After an update, re-check the gotchas above (shim, readiness timeout, port keys in `system.json`).
