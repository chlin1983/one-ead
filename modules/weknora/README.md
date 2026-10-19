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

### Active Configuration (Your Setup)
Configured by default in `.env.lite` and `config/builtin_models.yaml`:
```bash
ollama pull qwen3:8b
ollama pull nomic-embed-text
```
* **Chat Model**: `qwen3:8b` (Local Ollama on loopback)
* **Embedding Model**: `nomic-embed-text` (768 dimensions)

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

---

## 5. Security & Privacy Architecture

WeKnora Lite is configured with a **local-first architecture**: by default, it uses embedded local storage (SQLite), in-memory task queues, and local Ollama on loopback (`127.0.0.1`). External connectivity depends on the configured endpoints and enabled features. Review network access, endpoint configurations, and security settings before processing confidential documents.

### Local-First Component Architecture

| Component | Default Target / Driver | Network Scope |
| :--- | :--- | :--- |
| **LLM Inference** | `http://127.0.0.1:11434` (`qwen3:8b` / `qwen2.5`) | **Local Loopback** (Local Ollama daemon) |
| **Vector Embeddings** | `http://127.0.0.1:11434` (`nomic-embed-text` / `bge-m3`) | **Local Loopback** (Local Ollama daemon) |
| **Document Extraction** | [`scripts/doc_extractor.py`](./scripts/doc_extractor.py) (PyMuPDF, python-docx, openpyxl, python-pptx) | **Local Subprocess** (Direct file parsing, zero external APIs) |
| **Relational Database** | [`data/weknora.db`](./data/weknora.db) | **Local Embedded** (SQLite with FTS5) |
| **Vector Index** | `sqlite-vec` extension inside `data/weknora.db` | **Local Embedded** (Zero external vector services) |
| **File Storage** | [`data/files/`](./data/files) | **Local Disk** (Local directory storage) |
| **Task / Stream Queue** | In-Memory (`STREAM_MANAGER_TYPE=memory`) | **Local Process Memory** (Zero Redis dependency) |
| **Frontend Web Assets** | [`WeKnora/web/assets`](./WeKnora/web/assets) | **Local Static** (Embedded assets) |
| **Telemetry & Tracking** | Disabled | **Zero telemetry, zero update checks** |

### Security & Isolation Controls

1. **Origin & CSRF Defense**: All portal management and proxy APIs verify request origin and fetch metadata. Requests are validated using exact URL parsing (`urllib.parse.urlsplit`), requiring loopback hostnames (`127.0.0.1`, `localhost`, `::1`) and approved portal ports (`8100`, `8082`). Hostname prefix tricks (`127.0.0.1.attacker.com`) and cross-site requests (`Sec-Fetch-Site: cross-site`) are rejected with HTTP 403. An explicit safe policy requires valid origin/referer headers on all mutating operations (`POST`, `PUT`, `DELETE`).
2. **Desktop Auto-Setup Authentication Barrier**: The auto-setup endpoint requires a high-entropy, 256-bit setup token (`WEKNORA_LITE_SETUP_TOKEN`) generated at startup and compared in constant time (`subtle.ConstantTimeCompare` / `secrets.compare_digest`). The reverse proxy strictly verifies caller possession of the token before proxying auto-setup requests, preventing authorization bypasses while preserving the automated first-run setup for the local portal.
3. **SSRF Mitigation & Approved Ports**: Ollama health checks and endpoints are strictly validated and canonicalized against loopback hosts (`127.0.0.1`, `localhost`, `::1`) and explicitly approved ports (`11434`, `11435`). Credentials, userinfo tricks (`user@host`), unexpected ports (such as SSH, MySQL, or web admin ports), and path injection are strictly rejected.
4. **Configuration Allowlist & Preset Integrity**: Status responses strictly filter out sensitive credentials (`OPENAI_API_KEY`, `JWT_SECRET`, `SYSTEM_AES_KEY`). Configuration updates are validated against a strict key allowlist, rejecting arbitrary keys and verifying values against strict schemas before writing to prevent configuration corruption. The 6GB preset keys (`STREAM_MANAGER_TYPE`, `DB_DRIVER`, `RETRIEVE_DRIVER`, `STORAGE_TYPE`) are strictly validated against their Lite runtime drivers (`memory`, `sqlite`, `local`).
5. **Deterministic Builds & Pinned Upstream Enforcement**: Build scripts pin the reviewed upstream WeKnora revision (`2fbfb4471581cd5e7d731bc7a2d443fe7d8e95b5`). Build pipelines halt by default with exit code 1 if the checked-out upstream commit differs from the reviewed pin or if patches do not apply cleanly. Frontend dependencies are installed using `--ignore-scripts`.
6. **Content Security Policy Preservation**: When proxying WeKnora through One EAD, upstream CSP directives (`default-src`, `script-src`, `style-src`, etc.) are preserved intact while dynamically adapting `frame-ancestors` (`'self' http://127.0.0.1:* http://localhost:*`) to permit local portal embedding without degrading security posture.

---

## 6. Upstream Advisory Review & Scope

| Advisory / CVE | Upstream Context | One EAD / WeKnora Lite Applicability |
| :--- | :--- | :--- |
| **CVE-2026-30860** (PostgreSQL RCE) | Unsanitized child nodes in PostgreSQL row/array expressions in `<= 0.2.11` | **Not Applicable in Lite**: Lite mode completely eliminates PostgreSQL and runs on embedded SQLite. |
| **CVE-2026-108821** (Subquery SQLi) | SQL injection in subquery validation (`<= 0.8.1`) | **Mitigated**: Upstream pinned commit (`2fbfb44`) contains post-0.8.x tree revisions, and Lite runs strictly local SQLite queries. |
| **CVE-2026-30861** (MCP Command Injection) | Unsanitized argument injection in MCP stdio configurations (`0.2.5` - `0.2.10`) | **Mitigated**: Upstream revision is pinned past the affected branch; external MCP processes are disabled in Lite configuration. |
| **CVE-2026-91750 / CVE-2026-30247** (URL Ingestion SSRF) | SSRF via HTTP redirects when ingesting external URLs (`< 0.7.0`) | **Mitigated by Local-First Policy**: External URL ingestion is not used for local document workflows. Python `doc_extractor.py` parses local files directly without outbound HTTP requests. |

---

## 7. Operational Boundaries & Threat Model

* **Loopback Limitation**: Loopback binding (`127.0.0.1`) protects the application from incoming requests from external local area networks (LAN) or the internet. However, loopback binding **does not** protect against other unprivileged or malicious processes running locally under the same OS user.
* **No LAN Exposure**: Do not expose One EAD or WeKnora to a local area network (e.g. by binding to `0.0.0.0` or using port forwarding) unless a full multi-user authentication, authorization, and session management architecture is explicitly implemented and verified.
* **Updating the Pinned Upstream Commit Safely**:
  To update to a newer upstream WeKnora commit:
  1. Fetch and inspect commits: `git -C modules/weknora/WeKnora fetch origin`
  2. Perform a security diff review: `git -C modules/weknora/WeKnora diff <OLD_PIN> <NEW_PIN>`
  3. Verify clean application of `modules/weknora/patches/weknora_lite.patch` or rebase the patch.
  4. Update `PINNED_COMMIT` in `modules/weknora/scripts/build_lite.bat`.
  5. Run automated tests and recompile binary.

