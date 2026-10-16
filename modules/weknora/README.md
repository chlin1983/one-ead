# WeKnora (Lite Mode) — One EAD Plugin

[Tencent WeKnora](https://github.com/Tencent/WeKnora) is an open-source, enterprise-grade LLM document understanding and knowledge retrieval (RAG) platform.

This plugin integrates WeKnora into **One EAD** in **Lite Mode**, an isolated single-binary architecture with **zero external dependencies** (no PostgreSQL, no Redis, no Milvus/Qdrant).

---

## 1. Hardware Tuning (6GB VRAM / 16GB RAM)

When using a local GPU with **6GB VRAM** and a system with **16GB RAM**, running full-stack RAG plus local LLMs requires strict memory budgeting to avoid CUDA Out-Of-Memory (`CUDA OOM`) and system thrashing:

### VRAM Budget Breakdown (6,144 MB Total)
| Component | Memory | Note |
| :--- | :--- | :--- |
| **Windows DWM / Display** | ~800 MB | Reserved for OS UI, monitor display buffers |
| **Embedding Model** | ~130 – 275 MB | `nomic-embed-text` (~275MB) or `bge-small-zh-v1.5` (~130MB) |
| **Chat LLM Weights** | ~2,000 – 4,400 MB | `qwen2.5:3b` (~2.0GB) or `qwen2.5:7b-instruct-q4_K_M` (~4.4GB) |
| **KV Cache & Working VRAM** | ~600 – 1,200 MB | Dynamic context window (2k - 4k tokens) |
| **Safety Headroom** | ~600 MB | Prevents CUDA driver crashes |

### Tuned Parameters in `.env.lite`
* **`CONCURRENCY_POOL_SIZE=2`**: Limits simultaneous pipeline tasks so document parsing doesn't overwhelm memory.
* **`WEKNORA_CHAT_ATTACHMENT_OCR_CONCURRENCY=1`**: Disables high-parallel OCR on attachments to prevent vision models from spiking VRAM.
* **`WEKNORA_CHAT_ATTACHMENT_OCR_MAX_PAGES=4`**: Limits OCR depth for multi-page scans.
* **`STREAM_MANAGER_TYPE=memory`**: In-memory queue (no Redis needed).
* **`DB_DRIVER=sqlite` & `RETRIEVE_DRIVER=sqlite`**: Uses SQLite with `FTS5` full-text search and `sqlite-vec` vector extension (no external database needed).
* **`SERVER_PORT=8082`**: Runs on port 8082 (avoiding conflicts with One EAD on 8100 and DeepTutor on 8001).

---

## 2. Recommended Local Models (Ollama)

When you run WeKnora on your real hardware machine with Ollama, run one of the following model setups:

### Tier 1: Ultra-Fast & Safe (Zero Risk of OOM)
Best for rapid testing, large document contexts, and lowest latency:
```bash
ollama pull qwen2.5:3b
ollama pull nomic-embed-text
```
* **Chat VRAM**: ~2.0 GB
* **Embedding VRAM**: ~275 MB
* **Total VRAM**: **~2.5 GB** (Leaves ~3.6 GB free headroom!)

### Tier 2: Recommended High Intelligence (Fits in 6GB)
Best balance of reasoning capability, formatting adherence, and knowledge retrieval:
```bash
ollama pull qwen2.5:7b-instruct-q4_K_M
ollama pull bge-small-zh-v1.5
```
* **Chat VRAM**: ~4.4 GB
* **Embedding VRAM**: ~130 MB
* **Total VRAM**: **~4.85 GB** (Leaves ~1.2 GB headroom for display and context cache)

### Tier 3: Chain-of-Thought Reasoning
For deep multi-step thinking:
```bash
ollama pull deepseek-r1:7b
ollama pull nomic-embed-text
```
* **Total VRAM**: **~5.1 GB** (Recommended context length: 4k)

---

## 3. Windows Compilation & Build Guide

### Step 1: Upstream Repository
The repository is cloned inside `modules/weknora/WeKnora`:
```bash
git clone https://github.com/Tencent/WeKnora.git modules/weknora/WeKnora
```

### Step 2: Build Frontend Assets
In PowerShell or Command Prompt:
```powershell
cd modules/weknora/WeKnora/frontend
npm install
npm run build
cd ..
# Copy dist to web directory
xcopy /E /I /Y frontend\dist web
```

### Step 3: Build the Go Lite Binary
WeKnora Lite requires CGO enabled for SQLite FTS5 and vector bindings:
1. Install **Go 1.23+**: [https://go.dev/dl/](https://go.dev/dl/)
2. Install a C compiler (GCC/MinGW). Recommended:
   - [w64devkit](https://github.com/skeeto/w64devkit/releases) (Portable standalone GCC for Windows, extract and add to PATH)
3. Run the automated build script:
```powershell
modules\weknora\scripts\build_lite.bat
```
This produces `modules/weknora/WeKnora-lite.exe`.

---

## 4. Launching the Application

### Option A: From One EAD Portal (Recommended)
1. Start One EAD (`python run.py`).
2. Click **WeKnora** in the sidebar.
3. Use the integrated control toolbar to click **Start Service**.
4. The WeKnora UI embeds automatically inside One EAD via the built-in reverse proxy (bypassing `X-Frame-Options` restrictions), or click **Open in New Tab**.

### Option B: Standalone Launcher
Run the native Windows launcher:
```powershell
modules\weknora\scripts\run_lite.bat
```
Navigate to [http://127.0.0.1:8082](http://127.0.0.1:8082).
