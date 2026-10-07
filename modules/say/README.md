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

## 2. Technical Implementation Summary

### A. Core Engine (`worker.js`)
- Runs in a dedicated background Web Worker to keep the 60fps main UI completely fluid.
- Dynamically loads `@huggingface/transformers` v3.8.1 with ONNX WebGPU runtime.
- Employs long-form sliding window audio processing (`chunk_length_s: 30`, `stride_length_s: 5`) for arbitrary audio durations.
- Graceful hardware fallback: automatically tests `navigator.gpu` and switches to WebAssembly (CPU) if the client device lacks WebGPU.

### B. Audio Preprocessing Pipeline (`audio-utils.js`)
- **Microphone Capture**: Captures 16kHz mono audio stream with built-in echo cancellation and noise suppression.
- **Hardware-Accelerated Resampling**: Uses `OfflineAudioContext` for anti-aliased sample-rate conversion to 16,000 Hz `Float32Array`.
- **Live Canvas Visualizer**: Connected to an `AnalyserNode` rendering real-time frequency waves while dictating.
- **Universal Audio Decoder**: Supports drag-and-drop decoding for `.mp3`, `.wav`, `.m4a`, `.aac`, `.flac`, `.ogg`, and `.webm`.

### C. Document Workspace & Storage (`index.html`, `app.js`, `styles.css`)
- **Notion-Style Writing Canvas**: Rich text formatting (Bold, Italic, Strikethrough, Headings, Bullet Lists, Blockquotes).
- **Interactive Timestamps**: Segment chips `[00:03 → 00:08]` that allow seeking the built-in audio player directly to that spoken segment.
- **Local Persistence**: Saves all notes to `localStorage` (`say_notes_v1`) with instant search and restore.
- **Multi-Format Export**: Export to Markdown (`.md`), Plain Text (`.txt`), JSON with timestamped segments (`.json`), or save directly to local disk via `/api/say/export`.

### D. Portal Integration (`server/`, `shell/`)
- Module registered in `modules/say/module.py` and `server/plugin_order.json`.
- Iframe sandbox permissions configured with `allow="microphone; ..."` in `shell/portal.js`.
- Portal shell automatically syncs themes (dark/light) with the plugin.

---

## 3. Directory Layout

```
modules/say/
├── __init__.py                  # Exposes PortalModule MODULE
├── module.py                    # PortalModule metadata & FastAPI backend router
├── README.md                    # Technical documentation & implementation reference
└── web/
    ├── index.html               # Semantic UI, audio player, editor canvas, modals
    ├── styles.css               # Styling, dark/light theme tokens, animations
    ├── app.js                   # UI logic, audio capture, WebGPU diagnostics, editor
    ├── worker.js                # Web Worker for WebGPU Whisper inference
    ├── audio-utils.js           # 16kHz resampler, audio decoder, visualizer
    └── vendor/
        └── transformers.web.js  # Vendored @huggingface/transformers v3.8.1
```

---

## 4. Future Roadmap & Improvement Plan

### Phase 1: Real-Time Interim Streaming (Voice Activity Detection)
- Integrate client-side **Silero VAD** (or WebRTC VAD) to segment speech dynamically at natural pauses.
- Stream interim live transcriptions into the document as the user is speaking, updating the paragraph in real time.

### Phase 2: Domain-Specific Vocabulary Prompting
- Supply initial prompt biasing tokens to Whisper's decoder (e.g., electroacoustic terms like *THD*, *MEMS*, *balanced armature*, *dBSPL*, *impedance curve*).
- Greatly increases transcription accuracy for specialized engineering acronyms.

### Phase 3: Text-to-Speech (TTS) Verification
- Add an in-browser neural TTS engine (such as Kokoro or Supertonic ONNX) to read back dictated notes or meeting action items directly from the document editor.

### Phase 4: Local Model Caching & Air-Gapped Deployment
- Provide a CLI utility (`python -m modules.say.download_weights`) allowing air-gapped engineering environments to download ONNX checkpoints directly onto local disk for 100% offline distribution.
