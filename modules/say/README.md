# Say — High-Accuracy Local Voice Dictation & Transcription Plugin

> **100% Client-Side & Private** • **WebGPU Hardware Accelerated** • **Whisper Large-v3-Turbo** • **Mixed Precision (FP16/Q4)**

---

## 1. Overview & Architecture

**Say** is a local speech-to-text dictation and transcription plugin built for the **One EAD** engineering suite. Inspired by Addy Osmani's original [Say](https://github.com/addyosmani/say) experiment, this version is re-engineered with modern web capabilities and neural model optimizations:

1. **Transformers.js v3 + WebGPU**: Replaces legacy WASM CPU execution with native WebGPU shaders, accelerating inference speeds up to 10×–15× real-time.
2. **Whisper Large-v3-Turbo**: Upgrades from tiny baseline models to OpenAI's optimized 809M parameter architecture (`onnx-community/whisper-large-v3-turbo`), dramatically cutting word error rates on accents, jargon, and noisy audio.
3. **Mixed-Precision Quantization (FP16 / Q4)**: Compresses decoder weights to 4-bit while preserving 16-bit encoder fidelity. Keeps browser memory consumption well below allocations and total payload size to ~880 MB.
4. **Complete Privacy**: Audio capture, decoding, and AI inference execute 100% inside the browser sandbox. No audio or text ever leaves the user's computer.

---

## 2. Advanced Features Implemented

### Phase 1: Real-Time Streaming Dictation (In-Browser VAD)
- **Voice Activity Detection (`VoiceActivityDetector`)**: Operates on live audio frames (2048 samples, ~128ms) measuring RMS energy and tracking dynamic noise floors.
- **Natural Sentence Slicing**: When the speaker takes a breath (silence threshold 650ms), VAD detects the sentence boundary and dispatches the accumulated slice to the Web Worker.
- **Pre-Roll Ring Buffer**: Retains 250ms of audio prior to speech onset so opening plosives and consonants are never clipped.
- **Live Visual Activity Badge**: Header badge lights up green with `Speaking...` during speech and transitions to `VAD Listening` during pauses.

### Phase 2: Domain-Specific Vocabulary Biasing (Electroacoustics)
- **Prompt Biasing**: Injects domain-specific acoustic engineering keywords into Whisper's decoder conditioning tokens.
- **Electroacoustic Normalizer**: Automatically recognizes and formats specialized audio engineering acronyms and terms:
  - Distortion & Levels: `THD`, `THD+N`, `SPL`, `dBSPL`, `SNR`, `Rub & Buzz`
  - Transducers: `Balanced Armature`, `MEMS`, `ECM`, `PZT`, `F0`
  - Thiele-Small Parameters: `Qts`, `Qms`, `Qes`, `Vas`, `Bl`, `Mms`, `Cms`, `Re`, `Le`
  - Interfaces & Test Standards: `I2S`, `TDM`, `PDM`, `ANC`, `PNC`, `HRTF`, `IEC 60318-4`, `711 coupler`
- **Custom Glossary Support**: Selectable custom dropdown allowing users to input their own comma-separated project acronyms.

### Phase 4: Air-Gapped Model Bundling & Offline Disk Serving
- **CLI Pre-caching Script (`download_model.py`)**:
  - Run `python modules/say/download_model.py --model whisper-large-v3-turbo` (or `--model whisper-tiny`).
  - Downloads all required ONNX weights directly from Hugging Face into `modules/say/web/models/`.
- **Offline Local FastAPI Serving**:
  - Local models are served directly through One EAD at `/modules/say/models/<model_dir>/`.
  - Endpoint `GET /api/say/models` provides instant on-disk readiness and file size diagnostics.
  - One-click "Download to Disk" button right in the Settings drawer for effortless in-browser caching.
  - Zero internet access required once models are saved to disk.

### Permanent Disk Persistence (Audio & Transcripts)
- **100% Crash-Proof & Restart-Proof**: All recorded audio clips and transcripts are saved directly to the local server disk.
- **Dedicated On-Disk Storage**:
  - Transcripts & Note Metadata: `modules/say/data/notes/{note_id}.json`
  - Raw Audio Files: `modules/say/data/recordings/{note_id}.webm`
- **Dual-Layer Auto-Sync**:
  - In-browser `localStorage` provides instant 0ms startup rendering.
  - Background asynchronous sync persists all changes to the FastAPI disk backend.
  - When One EAD restarts, `initApp()` automatically rehydrates all notes and recordings from disk.
- **Integrated Audio Playback & Timestamp Scrubbing**:
  - Dedicated note audio bar appears with seekable `<audio>` controls for each recorded session.
  - Clicking any timestamp badge (`[00:04]`) in the transcript immediately jumps the audio player to that exact moment and plays it back.
  - Past recordings can be replayed anytime across application and system restarts.

---

## 3. Directory Layout

```
modules/say/
├── __init__.py                  # Exposes PortalModule MODULE
├── module.py                    # PortalModule metadata & FastAPI backend router (CRUD & audio streaming)
├── download_model.py            # CLI script to download ONNX weights for air-gapped setups
├── README.md                    # Technical documentation & implementation reference
├── data/                        # Persistent disk storage (gitignored)
│   ├── notes/                   # JSON notes with timestamps and chunk metadata
│   └── recordings/              # WebM audio recordings
└── web/
    ├── index.html               # Semantic UI, note audio player, editor canvas, modals
    ├── styles.css               # Styling, dark/light theme tokens, animations
    ├── app.js                   # UI logic, audio capture, WebGPU diagnostics, editor
    ├── worker.js                # Web Worker for WebGPU Whisper inference & normalizer
    ├── audio-utils.js           # 16kHz resampler, audio decoder, VAD, visualizer
    ├── models/                  # Offline cached ONNX weights (gitignored)
    └── vendor/
        ├── transformers.min.js  # Vendored @huggingface/transformers v3.8.1 (ORT bundled)
        └── ort-wasm-simd-threaded.jsep.{mjs,wasm}  # ONNX Runtime WASM
```

---

## 4. How to Use

1. Launch One EAD: `python run.py` (or `start.bat`).
2. Open `http://127.0.0.1:8100/` and navigate to **Say — Voice Dictation**.
3. Choose your engine mode:
   - **Live Streaming (VAD)**: Real-time sentence-by-sentence streaming into your document.
   - **Batch Record**: Standard voice memo mode (record, review, and transcribe).
4. Select your **Domain Vocabulary**:
   - Default: **Electroacoustics (THD, MEMS, dBSPL, etc.)**
   - Or enter custom terms in the input box.
5. In air-gapped lab environments, run:
   ```bash
   python modules/say/download_model.py --model whisper-large-v3-turbo
   ```
   to permanently bundle the model weights on disk with zero external network dependency.
