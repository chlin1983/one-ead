/**
 * Say — Voice Dictation & Audio Transcription App
 * High-accuracy local Whisper Large-v3-Turbo with WebGPU acceleration
 *
 * Supported Capabilities:
 * - Phase 1: Real-time streaming dictation via in-browser Voice Activity Detection (VAD)
 * - Phase 2: Domain-specific vocabulary prompt biasing for electroacoustic engineering
 * - Phase 4: Air-gapped offline model status & local disk management
 */

import {
  decodeAudioBlob,
  formatTime,
  formatTimestampRange,
  AudioVisualizer,
  VoiceActivityDetector,
  pcmToWavBlob,
} from './audio-utils.js';

// Domain Presets for Phase 2
const VOCABULARY_PRESETS = {
  electroacoustics: {
    prompt: 'Electroacoustic engineering: THD, MEMS, SPL, SNR, F0, Qts, ANC, IEC 60318-4.',
    terms: [
      'THD', 'THD+N', 'MEMS', 'SPL', 'dBSPL', 'FR', 'SNR', 'Rub & Buzz',
      'F0', 'Qms', 'Qes', 'Qts', 'Vas', 'Bl', 'Mms', 'Cms', 'Re', 'Le',
      'Balanced Armature', 'IEC 60318-4', '711 coupler', 'Helmholtz resonator',
      'PZT', 'ECM', 'PDM', 'I2S', 'TDM', 'ANC', 'PNC', 'HRTF'
    ],
  },
  general: {
    prompt: '',
    terms: [],
  },
};

// DOM Elements
const el = {
  // Badges & Header
  gpuBadge: document.getElementById('gpu-badge'),
  gpuBadgeText: document.getElementById('gpu-badge-text'),
  vadBadge: document.getElementById('vad-badge'),
  vadText: document.getElementById('vad-text'),
  engineStatusText: document.getElementById('engine-status-text'),
  newNoteBtn: document.getElementById('new-note-btn'),
  historyBtn: document.getElementById('history-btn'),
  settingsBtn: document.getElementById('settings-btn'),

  // Mode Switcher Tabs
  tabMicBtn: document.getElementById('tab-mic-btn'),
  tabUploadBtn: document.getElementById('tab-upload-btn'),
  micSection: document.getElementById('mic-section'),
  uploadSection: document.getElementById('upload-section'),

  // Engine Mode: Stream vs Batch
  modeStreamBtn: document.getElementById('mode-stream-btn'),
  modeBatchBtn: document.getElementById('mode-batch-btn'),

  // Microphone Controls
  recordWrapper: document.getElementById('record-wrapper'),
  toggleRecordBtn: document.getElementById('toggle-record-btn'),
  recordMicIcon: document.getElementById('record-mic-icon'),
  recordStopIcon: document.getElementById('record-stop-icon'),
  recordTimerDisplay: document.getElementById('record-timer-display'),
  recordStatusLabel: document.getElementById('record-status-label'),
  recordControlsRow: document.getElementById('record-controls-row'),
  pauseRecordBtn: document.getElementById('pause-record-btn'),
  pauseBtnText: document.getElementById('pause-btn-text'),
  finishTranscribeBtn: document.getElementById('finish-transcribe-btn'),
  visualizerCanvas: document.getElementById('visualizer-canvas'),

  // File Upload
  audioFileInput: document.getElementById('audio-file-input'),
  dropzone: document.getElementById('dropzone'),
  audioPreviewCard: document.getElementById('audio-preview-card'),
  fileNameLabel: document.getElementById('file-name-label'),
  fileDurationLabel: document.getElementById('file-duration-label'),
  audioPlayer: document.getElementById('audio-player'),
  transcribeUploadedBtn: document.getElementById('transcribe-uploaded-btn'),

  // Configuration
  languageSelect: document.getElementById('language-select'),
  taskSelect: document.getElementById('task-select'),
  modelQuickSelect: document.getElementById('model-quick-select'),

  // Glossary & Custom Vocabulary
  glossaryBtn: document.getElementById('glossary-btn'),
  glossaryDrawer: document.getElementById('glossary-drawer'),
  glossaryBackdrop: document.getElementById('glossary-backdrop'),
  closeGlossaryBtn: document.getElementById('close-glossary-btn'),
  customTermInput: document.getElementById('custom-term-input'),
  addCustomTermBtn: document.getElementById('add-custom-term-btn'),
  customTermsContainer: document.getElementById('custom-terms-container'),
  customTermsCount: document.getElementById('custom-terms-count'),
  builtinTermsGrid: document.getElementById('builtin-terms-grid'),

  // Status & Metrics
  progressStatusTitle: document.getElementById('progress-status-title'),
  progressPercentage: document.getElementById('progress-percentage'),
  progressBarFill: document.getElementById('progress-bar-fill'),
  metricInferTime: document.getElementById('metric-infer-time'),
  metricSpeed: document.getElementById('metric-speed'),

  // Document Editor
  noteTitle: document.getElementById('note-title'),
  timestampsToggleBtn: document.getElementById('timestamps-toggle-btn'),
  timestampsToggleText: document.getElementById('timestamps-toggle-text'),
  copyBtn: document.getElementById('copy-btn'),
  exportBtn: document.getElementById('export-btn'),
  clearEditorBtn: document.getElementById('clear-editor-btn'),
  editorCanvas: document.getElementById('editor-canvas'),
  statWords: document.getElementById('stat-words'),
  statChars: document.getElementById('stat-chars'),
  statReadTime: document.getElementById('stat-read-time'),
  saveStatus: document.getElementById('save-status'),
  noteAudioBar: document.getElementById('note-audio-bar'),
  noteAudioPlayer: document.getElementById('note-audio-player'),
  noteAudioStatus: document.getElementById('note-audio-status'),
  retranscribeNoteAudioBtn: document.getElementById('retranscribe-note-audio-btn'),

  // Drawers & Modals
  settingsBackdrop: document.getElementById('settings-backdrop'),
  settingsDrawer: document.getElementById('settings-drawer'),
  closeSettingsBtn: document.getElementById('close-settings-btn'),
  modelPresetSelect: document.getElementById('model-preset-select'),
  deviceSelect: document.getElementById('device-select'),
  dtypeSelect: document.getElementById('dtype-select'),
  preloadModelBtn: document.getElementById('preload-model-btn'),
  clearCacheBtn: document.getElementById('clear-cache-btn'),

  // Phase 4 Offline Models Elements
  offlineMoonshineTinyStatus: document.getElementById('offline-moonshine-tiny-status'),
  offlineMoonshineBaseStatus: document.getElementById('offline-moonshine-base-status'),
  offlineLargeStatus: document.getElementById('offline-large-status'),
  offlineTinyStatus: document.getElementById('offline-tiny-status'),
  downloadOfflineBtn: document.getElementById('download-offline-btn'),

  historyBackdrop: document.getElementById('history-backdrop'),
  historyDrawer: document.getElementById('history-drawer'),
  closeHistoryBtn: document.getElementById('close-history-btn'),
  searchHistoryInput: document.getElementById('search-history-input'),
  historyList: document.getElementById('history-list'),

  exportBackdrop: document.getElementById('export-backdrop'),
  exportDrawer: document.getElementById('export-drawer'),
  closeExportBtn: document.getElementById('close-export-btn'),
  exportMdBtn: document.getElementById('export-md-btn'),
  exportTxtBtn: document.getElementById('export-txt-btn'),
  exportJsonBtn: document.getElementById('export-json-btn'),
  exportServerBtn: document.getElementById('export-server-btn'),

  toastContainer: document.getElementById('toast-container'),
};

// Application State
const state = {
  currentNoteId: null,
  currentChunks: [],
  timestampsEnabled: false,
  engineMode: 'stream', // 'stream' (Real-time VAD) or 'batch' (Record & Stop)
  isRecording: false,
  isPaused: false,
  recordStartTime: 0,
  recordElapsedMs: 0,
  recordTimerInterval: null,
  mediaRecorder: null,
  mediaStream: null,
  recordedAudioChunks: [],
  audioContext: null,
  analyserNode: null,
  sourceNode: null,
  visualizer: null,
  vad: null,
  activeStreamingParagraph: null,
  streamChunkCounter: 0,
  uploadedFile: null,
  activeAudioUrl: null,
  currentNoteAudioBlob: null,

  // Hardware & Model Configuration
  webgpuAvailable: false,
  gpuAdapterName: '',
  hasFp16: false,
  selectedModel: 'onnx-community/moonshine-tiny-ONNX', // Default: Lightweight CPU-First
  selectedDevice: 'wasm',
  selectedDtype: 'auto',
  worker: null,
  isWorkerBusy: false,
};

/**
 * Checks hardware WebGPU support and capabilities
 */
async function detectHardwareAcceleration() {
  if (!navigator.gpu) {
    state.webgpuAvailable = false;
    state.selectedDevice = 'wasm';
    el.deviceSelect.value = 'wasm';
    updateGpuBadge(false, 'CPU WASM (Low Footprint)');
    return;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (adapter) {
      state.webgpuAvailable = true;
      state.hasFp16 = adapter.features.has('shader-f16');
      state.gpuAdapterName = adapter.info?.device || adapter.info?.description || 'GPU Accelerator';

      if (state.selectedModel.includes('turbo')) {
        state.selectedDevice = 'webgpu';
        el.deviceSelect.value = 'webgpu';
        updateGpuBadge(
          true,
          `WebGPU Active (${state.hasFp16 ? 'FP16' : 'FP32'})`,
          `Adapter: ${state.gpuAdapterName}\nFP16 Shader Support: ${state.hasFp16 ? 'Yes' : 'No'}`
        );
      } else {
        updateGpuBadge(
          false,
          'CPU WASM (Low Footprint)',
          `Adapter: ${state.gpuAdapterName} (Available for WebGPU models)`
        );
      }
    } else {
      state.webgpuAvailable = false;
      state.selectedDevice = 'wasm';
      el.deviceSelect.value = 'wasm';
      updateGpuBadge(false, 'CPU WASM (Low Footprint)');
    }
  } catch (err) {
    console.warn('[Say] WebGPU detection error:', err);
    state.webgpuAvailable = false;
    state.selectedDevice = 'wasm';
    el.deviceSelect.value = 'wasm';
    updateGpuBadge(false, 'CPU WASM (Low Footprint)');
  }
}

function updateGpuBadge(active, text, title = '') {
  el.gpuBadge.classList.toggle('inactive', !active);
  el.gpuBadgeText.textContent = text;
  if (title) el.gpuBadge.title = title;
}

/**
 * Electroacoustic Terms & Custom User Vocabulary Storage
 */
const CUSTOM_TERMS_KEY = 'say_custom_terms_v1';

function getCustomTerms() {
  try {
    const raw = localStorage.getItem(CUSTOM_TERMS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function saveCustomTerms(terms) {
  try {
    localStorage.setItem(CUSTOM_TERMS_KEY, JSON.stringify(terms));
  } catch (_) {}
}

function addCustomTerm(term) {
  const clean = term.trim();
  if (!clean) return;
  const terms = getCustomTerms();
  if (!terms.some((t) => t.toLowerCase() === clean.toLowerCase())) {
    terms.push(clean);
    saveCustomTerms(terms);
    renderGlossaryUI();
    showToast(`Added custom term: "${clean}"`, 'success');
  } else {
    showToast(`Term "${clean}" already in glossary.`, 'info');
  }
}

function removeCustomTerm(termToRemove) {
  let terms = getCustomTerms();
  terms = terms.filter((t) => t.toLowerCase() !== termToRemove.toLowerCase());
  saveCustomTerms(terms);
  renderGlossaryUI();
  showToast(`Removed "${termToRemove}"`, 'info');
}

function renderGlossaryUI() {
  if (!el.customTermsContainer || !el.builtinTermsGrid) return;

  const customTerms = getCustomTerms();
  if (el.customTermsCount) {
    el.customTermsCount.textContent = `${customTerms.length} term${customTerms.length === 1 ? '' : 's'}`;
  }

  // Render user custom pills
  if (customTerms.length === 0) {
    el.customTermsContainer.innerHTML = `<span style="font-size: 12px; color: var(--text-mute); font-style: italic;">No custom terms added yet. Add one above.</span>`;
  } else {
    el.customTermsContainer.innerHTML = customTerms
      .map(
        (t) => `
        <span class="term-pill custom">
          <span>${escapeHtml(t)}</span>
          <button class="term-pill-remove" data-term="${escapeHtml(t)}" title="Remove term">&times;</button>
        </span>
      `
      )
      .join('');

    el.customTermsContainer.querySelectorAll('.term-pill-remove').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeCustomTerm(btn.dataset.term);
      });
    });
  }

  // Render built-in terms
  const builtin = VOCABULARY_PRESETS.electroacoustics.terms;
  el.builtinTermsGrid.innerHTML = builtin
    .map(
      (t) => `
      <span class="term-pill">
        <span>${escapeHtml(t)}</span>
      </span>
    `
    )
    .join('');
}

/**
 * Resolves vocabulary prompting & domain terms.
 * Automatically recognizes all electroacoustic terms by default, merged with any custom user terms.
 */
function getVocabularyConfiguration() {
  const basePrompt = VOCABULARY_PRESETS.electroacoustics.prompt;
  const baseTerms = VOCABULARY_PRESETS.electroacoustics.terms;
  const customTerms = getCustomTerms();

  const allTerms = Array.from(new Set([...baseTerms, ...customTerms]));
  const extraPrompt = customTerms.length > 0 ? ` Custom project terms: ${customTerms.join(', ')}.` : '';

  return {
    initial_prompt: basePrompt + extraPrompt,
    customTerms: allTerms,
  };
}

/**
 * Initializes the Web Worker running Transformers.js v3
 */
function initWorker() {
  if (state.worker) {
    state.worker.terminate();
  }

  state.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

  state.worker.addEventListener('message', (event) => {
    const { type, status, message, data, output, stats, durationSec, modelId, device, chunkId } = event.data;

    if (type === 'progress') {
      handleDownloadProgress(data);
    } else if (type === 'status') {
      handleStatusUpdate(status, message, durationSec, modelId, device);
    } else if (type === 'complete') {
      handleTranscriptionComplete(output, stats);
    } else if (type === 'stream_chunk_complete') {
      handleStreamChunkComplete(chunkId, output, stats);
    } else if (type === 'error') {
      handleWorkerError(event.data);
    }
  });

  state.worker.addEventListener('error', (err) => {
    console.error('[Say Worker Thread Error]', err);
    state.isWorkerBusy = false;
    el.progressStatusTitle.textContent = `Worker Error: ${err.message || 'Worker thread execution error'}`;
    el.progressBarFill.style.width = '0%';
    el.progressPercentage.textContent = 'Error';
    el.engineStatusText.textContent = 'Engine Error';
    showToast(`Worker error: ${err.message || 'Check browser console'}`, 'error');
  });
}

function handleDownloadProgress(data) {
  if (!data) return;

  if (data.status === 'progress' && data.progress !== undefined) {
    const pct = Math.round(data.progress);
    el.progressBarFill.style.width = `${pct}%`;
    el.progressPercentage.textContent = `${pct}%`;

    const fileName = data.file ? data.file.split('/').pop() : 'model weights';
    el.progressStatusTitle.textContent = `Downloading ${fileName}...`;
  } else if (data.status === 'initiate') {
    const fileName = data.file ? data.file.split('/').pop() : 'file';
    el.progressStatusTitle.textContent = `Fetching ${fileName}...`;
  } else if (data.status === 'done') {
    el.progressStatusTitle.textContent = `Loaded ${data.file ? data.file.split('/').pop() : ''}`;
  }
}

function handleStatusUpdate(status, message, durationSec, modelId, device) {
  if (status === 'loading') {
    state.isWorkerBusy = true;
    el.progressStatusTitle.textContent = message || 'Loading model weights...';
    el.engineStatusText.textContent = 'Loading Model...';
  } else if (status === 'ready') {
    state.isWorkerBusy = false;
    el.progressBarFill.style.width = '100%';
    el.progressPercentage.textContent = '100%';
    el.progressStatusTitle.textContent = `Status: Ready (${device ? device.toUpperCase() : 'AI Engine'})`;
    const isTiny = (modelId || state.selectedModel).includes('whisper-tiny');
    el.engineStatusText.textContent = isTiny ? 'Whisper Tiny (Instant)' : 'Whisper Turbo';
    if (durationSec) {
      showToast(`Model ready in ${durationSec}s`, 'success');
    }
  } else if (status === 'transcribing') {
    state.isWorkerBusy = true;
    el.progressStatusTitle.textContent = 'Transcribing speech...';
    el.progressBarFill.style.width = '80%';
    el.progressPercentage.textContent = 'Transcribing';
  }
}

function handleTranscriptionComplete(output, stats) {
  state.isWorkerBusy = false;
  el.progressStatusTitle.textContent = 'Status: Ready';
  el.progressBarFill.style.width = '100%';
  el.progressPercentage.textContent = '100%';
  el.recordStatusLabel.textContent = 'Transcription complete';

  if (stats) {
    el.metricInferTime.textContent = `${stats.inferenceTimeSec}s`;
    el.metricSpeed.textContent = stats.speedMultiplier || '—';
  }

  if (!output || (!output.text && (!output.chunks || output.chunks.length === 0))) {
    showToast('No speech detected in audio.', 'info');
    return;
  }

  const rawText = (output.text || '').trim();
  const chunks = output.chunks || [];
  state.currentChunks.push(...chunks);

  insertTranscriptionIntoEditor(rawText, chunks);

  updateWordCounts();
  saveCurrentNote();
  showToast('Transcription finished!', 'success');
}

/**
 * Phase 1: Real-Time Stream Chunk Complete Callback
 */
function handleStreamChunkComplete(chunkId, output, stats) {
  if (stats) {
    el.metricInferTime.textContent = `${stats.inferenceTimeSec}s`;
    el.metricSpeed.textContent = stats.speedMultiplier || '—';
  }

  const text = (output?.text || '').trim();
  if (!text) return;

  const chunks = output.chunks || [];
  state.currentChunks.push(...chunks);

  // Smoothly append streamed sentence to active paragraph
  if (!state.activeStreamingParagraph || !document.body.contains(state.activeStreamingParagraph)) {
    state.activeStreamingParagraph = document.createElement('p');
    state.activeStreamingParagraph.className = 'transcript-paragraph highlight';
    el.editorCanvas.appendChild(state.activeStreamingParagraph);
  }

  const sentenceSpan = document.createElement('span');
  if (state.timestampsEnabled && chunks.length > 0) {
    const start = chunks[0].timestamp?.[0] ?? 0;
    const end = chunks[chunks.length - 1].timestamp?.[1] ?? 0;
    sentenceSpan.innerHTML = `<span class="timestamp-chip" data-time="${start}">${formatTimestampRange(start, end)}</span> ${escapeHtml(text)} `;
  } else {
    sentenceSpan.textContent = text + ' ';
  }

  state.activeStreamingParagraph.appendChild(sentenceSpan);
  el.editorCanvas.scrollTop = el.editorCanvas.scrollHeight;

  // Flash highlight removal
  setTimeout(() => {
    state.activeStreamingParagraph?.classList.remove('highlight');
  }, 1200);

  updateWordCounts();
  saveCurrentNote();
}

function handleWorkerError(errData) {
  state.isWorkerBusy = false;
  console.error('[Say Worker Error]', errData);
  // A failed ONNX session can leave the shared WASM heap unusable for every later model; start fresh.
  if (errData.stage === 'transcribe' || errData.stage === 'load') initWorker();
  el.progressStatusTitle.textContent = `Error: ${errData.message || 'Processing failed'}`;
  el.progressBarFill.style.width = '0%';
  el.progressPercentage.textContent = 'Failed';

  const isMemoryExhaustion = (errData.message || '').includes('Browser memory') ||
    (errData.message || '').includes('allocation failed') ||
    (errData.message || '').includes('697803968');

  if (isMemoryExhaustion && state.selectedModel !== 'onnx-community/moonshine-tiny-ONNX') {
    showToast('Browser memory limit hit. Auto-switching to Moonshine Tiny (Lightweight CPU)...', 'warning');
    setTimeout(() => {
      updateModelSelection('onnx-community/moonshine-tiny-ONNX');
    }, 1200);
  } else if (errData.canFallback && state.selectedModel !== 'onnx-community/moonshine-tiny-ONNX') {
    showToast('Execution failed. Falling back to Moonshine Tiny (CPU-first)...', 'error');
    updateModelSelection('onnx-community/moonshine-tiny-ONNX');
  } else {
    showToast(`Error: ${errData.message || 'Operation failed'}`, 'error');
  }
}

/**
 * Inserts transcribed text or formatted timestamp chunks into the editor canvas
 */
function insertTranscriptionIntoEditor(rawText, chunks) {
  // Clean up any empty trailing paragraphs from active streaming placeholders
  el.editorCanvas.querySelectorAll('.transcript-paragraph').forEach((p) => {
    if (!p.textContent.trim()) p.remove();
  });

  if (state.timestampsEnabled && chunks.length > 0) {
    let html = '';
    chunks.forEach((chunk) => {
      const start = chunk.timestamp?.[0] ?? 0;
      const end = chunk.timestamp?.[1] ?? 0;
      const rangeStr = formatTimestampRange(start, end);
      const text = (chunk.text || '').trim();
      if (text) {
        html += `<p class="transcript-paragraph"><span class="timestamp-chip" data-time="${start}">${rangeStr}</span> ${escapeHtml(text)}</p>`;
      }
    });

    el.editorCanvas.insertAdjacentHTML('beforeend', html);
  } else {
    const p = document.createElement('p');
    p.className = 'transcript-paragraph';
    p.textContent = rawText;
    el.editorCanvas.appendChild(p);
  }

  el.editorCanvas.scrollTop = el.editorCanvas.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Audio Recording Logic with Phase 1 VAD Streaming
 */
async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    state.mediaStream = stream;

    // Audio is stored one file per note id; reusing a note that already has audio would overwrite it.
    const currentStored = getStoredNotes().find((n) => n.id === state.currentNoteId);
    if (currentStored?.hasAudio || state.currentNoteAudioBlob) {
      createNewNote();
      state.currentNoteAudioBlob = null;
    }

    state.recordedAudioChunks = [];
    state.streamChunkCounter = 0;

    // Initialize AudioContext & Visualizer
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    await state.audioContext.resume();
    state.sourceNode = state.audioContext.createMediaStreamSource(stream);
    state.analyserNode = state.audioContext.createAnalyser();
    state.sourceNode.connect(state.analyserNode);

    if (!state.visualizer) {
      state.visualizer = new AudioVisualizer(el.visualizerCanvas);
    }
    state.visualizer.attach(state.analyserNode);
    state.visualizer.start();

    // Phase 1: Real-time Streaming with Voice Activity Detection (VAD)
    if (state.engineMode === 'stream') {
      state.activeStreamingParagraph = document.createElement('p');
      state.activeStreamingParagraph.className = 'transcript-paragraph highlight';
      el.editorCanvas.appendChild(state.activeStreamingParagraph);

      state.vad = new VoiceActivityDetector({
        audioContext: state.audioContext,
        sourceNode: state.sourceNode,
        sampleRate: state.audioContext.sampleRate,
        energyThreshold: 0.0035,
        silenceDurationMs: 450,
        minSpeechDurationMs: 180,
        onSpeechStart: () => {
          el.vadBadge.classList.add('speaking');
          el.vadText.textContent = 'Speaking...';
          el.recordStatusLabel.textContent = 'Speech detected — transcribing in real-time';
        },
        onSpeechEnd: (pcmChunk) => {
          el.vadBadge.classList.remove('speaking');
          el.vadText.textContent = 'Processing sentence...';
          dispatchStreamChunk(pcmChunk);
        },
        onVADStatus: (isSpeaking) => {
          if (!isSpeaking && el.vadBadge.classList.contains('speaking')) {
            el.vadBadge.classList.remove('speaking');
            el.vadText.textContent = 'Listening...';
          }
        },
      });
      state.vad.start();
      el.vadBadge.classList.remove('speaking');
      el.vadText.textContent = 'VAD Listening';
    }

    // Parallel MediaRecorder for full playback preview
    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = MediaRecorder.isTypeSupported('audio/ogg') ? 'audio/ogg' : '';
    }

    state.mediaRecorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);

    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        state.recordedAudioChunks.push(e.data);
      }
    };

    state.mediaRecorder.start(250);

    // Update UI
    state.isRecording = true;
    state.isPaused = false;
    state.recordStartTime = Date.now();
    state.recordElapsedMs = 0;

    el.micSection.classList.add('recording');
    el.recordMicIcon.style.display = 'none';
    el.recordStopIcon.style.display = 'block';
    el.recordStatusLabel.textContent = state.engineMode === 'stream'
      ? 'Live Streaming Active — Speak naturally'
      : 'Recording... Speak clearly';
    el.recordControlsRow.style.display = 'flex';
    el.pauseBtnText.textContent = 'Pause';

    clearInterval(state.recordTimerInterval);
    state.recordTimerInterval = setInterval(updateRecordingTimer, 100);
  } catch (err) {
    console.error('[Say] Microphone access error:', err);
    showToast(`Microphone error: ${err.message || 'Permission denied'}`, 'error');
  }
}

function updateRecordingTimer() {
  if (state.isPaused) return;
  const now = Date.now();
  const elapsed = (now - state.recordStartTime) + state.recordElapsedMs;
  el.recordTimerDisplay.textContent = formatTime(elapsed / 1000);
}

async function stopRecordingAndTranscribe() {
  if (!state.isRecording) return;

  state.isRecording = false;
  state.isPaused = false;
  clearInterval(state.recordTimerInterval);

  el.micSection.classList.remove('recording');
  el.recordMicIcon.style.display = 'block';
  el.recordStopIcon.style.display = 'none';
  el.recordControlsRow.style.display = 'none';
  el.recordStatusLabel.textContent = 'Finishing dictation...';

  if (state.vad) {
    state.vad.stop();
    state.vad = null;
    el.vadBadge.classList.remove('speaking');
    el.vadText.textContent = 'VAD Ready';
  }

  if (state.visualizer) {
    state.visualizer.stop();
  }

  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach((t) => t.stop());
  }

  await new Promise((resolve) => {
    state.mediaRecorder.onstop = resolve;
    state.mediaRecorder.stop();
  });

  const recordedBlob = new Blob(state.recordedAudioChunks, {
    type: state.mediaRecorder.mimeType || 'audio/webm',
  });

  if (state.audioContext) {
    try {
      await state.audioContext.close();
    } catch (_) {}
  }

  if (recordedBlob.size > 100) {
    if (!state.currentNoteId) {
      state.currentNoteId = 'note_' + Date.now();
    }
    setAudioPreview(recordedBlob, 'Microphone Recording');
    setNoteAudioPlayer(recordedBlob, state.currentNoteId);
    uploadRecordingToDisk(state.currentNoteId, recordedBlob);
  }

  // Determine if stream chunks successfully produced text in the editor
  const hasStreamedContent = state.streamChunkCounter > 0 &&
    state.activeStreamingParagraph &&
    state.activeStreamingParagraph.textContent.trim().length > 0;

  // If in batch mode, OR if stream mode completed without any transcribed text,
  // transcribe the full recorded audio so speech is NEVER lost!
  if (state.engineMode === 'batch' || !hasStreamedContent) {
    if (recordedBlob.size < 100) {
      el.recordStatusLabel.textContent = 'Recording was too short.';
      return;
    }
    try {
      // Remove any empty trailing paragraph placeholder left by stream mode
      if (state.activeStreamingParagraph && !state.activeStreamingParagraph.textContent.trim()) {
        state.activeStreamingParagraph.remove();
        state.activeStreamingParagraph = null;
      }

      el.recordStatusLabel.textContent = 'Transcribing speech automatically...';
      el.progressStatusTitle.textContent = 'Transcribing recording...';
      el.progressBarFill.style.width = '60%';
      el.progressPercentage.textContent = 'Processing';

      const { pcm16k } = await decodeAudioBlob(recordedBlob);
      dispatchTranscription(pcm16k);
    } catch (err) {
      console.error('[Say] Audio decode/transcribe failed:', err);
      showToast(`Audio decoding error: ${err.message}`, 'error');
      el.recordStatusLabel.textContent = 'Decoding failed.';
    }
  } else {
    el.recordStatusLabel.textContent = 'Live dictation complete.';
  }
}

function pauseRecording() {
  if (!state.isRecording || !state.mediaRecorder) return;

  if (state.isPaused) {
    state.mediaRecorder.resume();
    state.recordStartTime = Date.now();
    state.isPaused = false;
    el.pauseBtnText.textContent = 'Pause';
    el.recordStatusLabel.textContent = 'Listening... Speak clearly';
    if (state.visualizer) state.visualizer.start();
    if (state.vad) state.vad.start();
  } else {
    state.mediaRecorder.pause();
    state.recordElapsedMs += Date.now() - state.recordStartTime;
    state.isPaused = true;
    el.pauseBtnText.textContent = 'Resume';
    el.recordStatusLabel.textContent = 'Recording paused';
    if (state.visualizer) state.visualizer.stop();
    if (state.vad) state.vad.stop();
  }
}

/**
 * Dispatches audio to host Python faster-whisper CPU engine using 16GB system RAM.
 * Bypasses all browser tab sandboxes and WebGPU buffer allocation limits.
 */
async function sendServerTranscription(audioPcmFloat32, isStream = false) {
  state.isWorkerBusy = true;
  el.progressStatusTitle.textContent = isStream
    ? 'Transcribing live sentence (Host CPU 16GB RAM)...'
    : 'Transcribing audio on host system RAM...';
  el.progressBarFill.style.width = '70%';
  el.progressPercentage.textContent = 'Processing...';

  try {
    const wavBlob = pcmToWavBlob(audioPcmFloat32);
    const vocabConfig = getVocabularyConfiguration();
    const query = new URLSearchParams({
      model: state.selectedModel,
      language: el.languageSelect.value,
      task: el.taskSelect.value,
      prompt: vocabConfig.initial_prompt || '',
    });

    const res = await fetch(`/api/say/transcribe?${query.toString()}`, {
      method: 'POST',
      body: wavBlob,
      headers: {
        'Content-Type': 'audio/wav',
      },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
      throw new Error(err.detail || `Server transcription failed (${res.status})`);
    }

    const data = await res.json();
    state.isWorkerBusy = false;

    if (isStream) {
      handleStreamChunkComplete({
        output: { text: data.text, chunks: data.chunks },
        stats: data.stats,
      });
    } else {
      handleTranscriptionComplete({
        output: { text: data.text, chunks: data.chunks },
        stats: data.stats,
      });
    }
  } catch (err) {
    state.isWorkerBusy = false;
    console.error('[Say Server Error]', err);
    el.progressStatusTitle.textContent = `Error: ${err.message}`;
    el.progressBarFill.style.width = '0%';
    el.progressPercentage.textContent = 'Failed';
    showToast(`Host CPU transcription error: ${err.message}`, 'error');
  }
}

/**
 * Phase 1: Dispatches an individual VAD sentence chunk to Web Worker or Host CPU
 */
function dispatchStreamChunk(audioPcmFloat32) {
  state.streamChunkCounter++;
  if (state.selectedModel.startsWith('server/')) {
    sendServerTranscription(audioPcmFloat32, true);
    return;
  }

  if (!state.worker) initWorker();

  const vocabConfig = getVocabularyConfiguration();
  const options = {
    language: el.languageSelect.value,
    task: el.taskSelect.value,
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5,
    initial_prompt: vocabConfig.initial_prompt,
    customTerms: vocabConfig.customTerms,
  };

  state.worker.postMessage({
    type: 'transcribe_stream_chunk',
    payload: {
      audio: audioPcmFloat32,
      chunkId: state.streamChunkCounter,
      options,
      modelId: state.selectedModel,
      device: state.selectedDevice,
      dtype: state.selectedDtype === 'auto' ? null : state.selectedDtype,
    },
  });
}

/**
 * Dispatches full audio PCM Float32Array to Web Worker or Host CPU
 */
function dispatchTranscription(audioPcmFloat32) {
  if (state.selectedModel.startsWith('server/')) {
    sendServerTranscription(audioPcmFloat32, false);
    return;
  }

  if (!state.worker) {
    initWorker();
  }

  const vocabConfig = getVocabularyConfiguration();
  const options = {
    language: el.languageSelect.value,
    task: el.taskSelect.value,
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5,
    initial_prompt: vocabConfig.initial_prompt,
    customTerms: vocabConfig.customTerms,
  };

  const payload = {
    audio: audioPcmFloat32,
    options,
    modelId: state.selectedModel,
    device: state.selectedDevice,
    dtype: state.selectedDtype === 'auto' ? null : state.selectedDtype,
  };

  state.worker.postMessage({
    type: 'transcribe',
    payload,
  });
}

/**
 * Audio File Upload & Processing
 */
function handleFileSelected(file) {
  if (!file) return;
  state.uploadedFile = file;

  setAudioPreview(file, file.name);
  el.uploadSection.style.display = 'block';
  el.audioPreviewCard.style.display = 'flex';
}

function setAudioPreview(blobOrFile, displayName) {
  if (state.activeAudioUrl) {
    URL.revokeObjectURL(state.activeAudioUrl);
  }

  state.activeAudioUrl = URL.createObjectURL(blobOrFile);
  el.audioPlayer.src = state.activeAudioUrl;
  el.fileNameLabel.textContent = displayName;

  el.audioPlayer.onloadedmetadata = () => {
    el.fileDurationLabel.textContent = formatTime(el.audioPlayer.duration);
  };
}

async function transcribeUploadedFile() {
  if (!state.uploadedFile) {
    showToast('Please select an audio file first.', 'info');
    return;
  }

  try {
    el.progressStatusTitle.textContent = 'Decoding audio file...';
    el.progressBarFill.style.width = '20%';
    el.progressPercentage.textContent = 'Decoding';

    const { pcm16k, duration } = await decodeAudioBlob(state.uploadedFile);

    el.progressStatusTitle.textContent = `Processing ${formatTime(duration)} audio...`;
    dispatchTranscription(pcm16k);
  } catch (err) {
    console.error('[Say] File decode failed:', err);
    showToast(`Failed to decode audio file: ${err.message}`, 'error');
  }
}

/**
 * Document Editor & Note Management
 */
function updateWordCounts() {
  const text = el.editorCanvas.innerText || '';
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const chars = text.length;
  const readMins = Math.ceil(words / 200);

  el.statWords.textContent = words;
  el.statChars.textContent = chars;
  el.statReadTime.textContent = `${readMins} min`;
}

function setNoteAudioPlayer(blobOrUrl, noteId) {
  if (!el.noteAudioBar || !el.noteAudioPlayer) return;
  el.noteAudioBar.style.display = 'flex';
  if (typeof blobOrUrl === 'string') {
    state.currentNoteAudioBlob = null;
    el.noteAudioPlayer.src = blobOrUrl;
  } else {
    state.currentNoteAudioBlob = blobOrUrl;
    el.noteAudioPlayer.src = URL.createObjectURL(blobOrUrl);
  }
  if (el.noteAudioStatus) {
    el.noteAudioStatus.textContent = 'Preserved on disk';
  }
}

async function transcribeCurrentNoteAudio() {
  if (!el.noteAudioPlayer || !el.noteAudioPlayer.src) {
    showToast('No audio recording loaded for this note.', 'info');
    return;
  }

  try {
    el.progressStatusTitle.textContent = 'Preparing audio for Whisper...';
    el.progressBarFill.style.width = '25%';
    el.progressPercentage.textContent = 'Loading';

    let blob;
    if (state.currentNoteAudioBlob instanceof Blob) {
      blob = state.currentNoteAudioBlob;
    } else {
      const res = await fetch(el.noteAudioPlayer.src);
      blob = await res.blob();
    }

    el.progressStatusTitle.textContent = 'Decoding audio for Whisper...';
    el.progressBarFill.style.width = '45%';
    el.progressPercentage.textContent = 'Decoding';

    const { pcm16k, duration } = await decodeAudioBlob(blob);
    el.progressStatusTitle.textContent = `Transcribing ${formatTime(duration)} audio...`;
    el.progressBarFill.style.width = '65%';
    el.progressPercentage.textContent = 'Processing';

    dispatchTranscription(pcm16k);
    showToast('Transcribing audio recording...', 'info');
  } catch (err) {
    console.error('[Say] Transcribe note audio failed:', err);
    showToast(`Failed to transcribe audio: ${err.message}`, 'error');
  }
}

async function uploadRecordingToDisk(noteId, blob) {
  try {
    if (el.noteAudioStatus) {
      el.noteAudioStatus.textContent = 'Saving audio to disk...';
    }
    const res = await fetch(`/api/say/recordings/${encodeURIComponent(noteId)}`, {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'audio/webm' },
      body: blob,
    });
    if (res.ok) {
      if (el.noteAudioStatus) {
        el.noteAudioStatus.textContent = 'Saved on disk';
      }
      const notes = getStoredNotes();
      const n = notes.find((x) => x.id === noteId);
      if (n) {
        n.hasAudio = true;
        n.audioUrl = `/api/say/recordings/${noteId}`;
        n.audioSizeBytes = blob.size;
        localStorage.setItem('say_notes_v1', JSON.stringify(notes));
        renderHistoryList();
      }
      saveCurrentNote(false);
      showToast('Audio recording saved to disk', 'success');
    }
  } catch (err) {
    console.error('[Say] Failed to upload audio recording:', err);
  }
}

function createNewNote(persist = true) {
  state.currentNoteId = 'note_' + Date.now();
  state.currentChunks = [];

  const dateStr = new Date().toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  el.noteTitle.value = `Dictation — ${dateStr}`;
  el.editorCanvas.innerHTML = '';
  if (el.noteAudioBar) el.noteAudioBar.style.display = 'none';
  if (el.noteAudioPlayer) {
    el.noteAudioPlayer.pause();
    el.noteAudioPlayer.src = '';
  }
  updateWordCounts();
  if (persist) {
    saveCurrentNote(false);
    showToast('Created new note', 'success');
  } else {
    renderHistoryList();
  }
}

let saveTimeout = null;

function saveCurrentNote(debounce = false) {
  if (!state.currentNoteId) {
    state.currentNoteId = 'note_' + Date.now();
  }

  const note = {
    id: state.currentNoteId,
    title: el.noteTitle.value.trim() || 'Untitled Dictation',
    content: el.editorCanvas.innerText,
    html: el.editorCanvas.innerHTML,
    chunks: state.currentChunks,
    updatedAt: Date.now(),
  };

  const storedNotes = getStoredNotes();
  const existingIdx = storedNotes.findIndex((n) => n.id === state.currentNoteId);
  if (existingIdx !== -1) {
    if (storedNotes[existingIdx].hasAudio) {
      note.hasAudio = true;
      note.audioUrl = storedNotes[existingIdx].audioUrl || `/api/say/recordings/${state.currentNoteId}`;
      note.audioSizeBytes = storedNotes[existingIdx].audioSizeBytes;
    }
    storedNotes[existingIdx] = note;
  } else {
    storedNotes.unshift(note);
  }

  localStorage.setItem('say_notes_v1', JSON.stringify(storedNotes));
  el.saveStatus.textContent = 'Auto-saved locally';
  renderHistoryList();

  if (debounce) {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => syncNoteToServer(note), 600);
  } else {
    syncNoteToServer(note);
  }
}

async function syncNoteToServer(note) {
  try {
    const res = await fetch(`/api/say/notes/${encodeURIComponent(note.id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(note),
    });
    if (res.ok) {
      el.saveStatus.textContent = '✓ Saved to disk';
    }
  } catch (err) {
    console.warn('[Say] Note disk sync failed (cached locally):', err);
  }
}

function getStoredNotes() {
  try {
    const raw = localStorage.getItem('say_notes_v1');
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function loadNote(noteId, keepDrawerOpen = false) {
  const notes = getStoredNotes();
  const note = notes.find((n) => n.id === noteId);
  if (!note) return;

  state.currentNoteId = note.id;
  state.currentChunks = note.chunks || [];
  el.noteTitle.value = note.title;
  el.editorCanvas.innerHTML = note.html || escapeHtml(note.content || '');
  updateWordCounts();

  if (el.noteAudioBar && el.noteAudioPlayer) {
    if (note.hasAudio || note.audioUrl) {
      el.noteAudioBar.style.display = 'flex';
      const audioUrl = note.audioUrl || `/api/say/recordings/${note.id}`;
      el.noteAudioPlayer.src = audioUrl;
      if (el.noteAudioStatus) {
        el.noteAudioStatus.textContent = 'Preserved on disk';
      }
    } else {
      el.noteAudioBar.style.display = 'none';
      el.noteAudioPlayer.pause();
      el.noteAudioPlayer.src = '';
    }
  }

  el.saveStatus.textContent = 'Loaded note from disk';
  if (!keepDrawerOpen) closeAllDrawers();
}

async function deleteNote(noteId, event) {
  if (event) event.stopPropagation();

  try {
    fetch(`/api/say/notes/${encodeURIComponent(noteId)}`, { method: 'DELETE' });
  } catch (_) {}

  let notes = getStoredNotes();
  notes = notes.filter((n) => n.id !== noteId);
  localStorage.setItem('say_notes_v1', JSON.stringify(notes));

  if (state.currentNoteId === noteId) {
    // Open the next remaining note instead of spawning (and persisting) a new empty one.
    if (notes.length > 0) {
      loadNote(notes[0].id, true);
    } else {
      createNewNote(false);
    }
  }
  renderHistoryList();
  showToast('Note and audio deleted from disk', 'info');
}

function renderHistoryList(filterQuery = '') {
  const notes = getStoredNotes();
  const q = filterQuery.toLowerCase().trim();

  const filtered = q
    ? notes.filter(
        (n) => n.title.toLowerCase().includes(q) || (n.content && n.content.toLowerCase().includes(q))
      )
    : notes;

  if (filtered.length === 0) {
    el.historyList.innerHTML = `<p style="color: var(--text-mute); font-size: 13px; text-align: center; padding: 20px;">No dictation notes found.</p>`;
    return;
  }

  el.historyList.innerHTML = filtered
    .map((note) => {
      const activeClass = note.id === state.currentNoteId ? ' active' : '';
      const dateStr = new Date(note.updatedAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      const preview = (note.content || 'Empty note').slice(0, 70);
      const audioPill = note.hasAudio
        ? `<span class="history-audio-pill" title="Recorded audio preserved on disk">🎙️ Audio</span>`
        : '';

      return `
        <div class="history-item${activeClass}" data-id="${note.id}">
          <div class="history-item-top">
            <span class="history-item-title">${escapeHtml(note.title)}</span>
            <div style="display: flex; align-items: center; gap: 6px;">
              ${audioPill}
              <span class="history-item-date">${dateStr}</span>
            </div>
          </div>
          <div class="history-item-preview">${escapeHtml(preview)}</div>
          <div style="margin-top: 4px; display: flex; justify-content: flex-end;">
            <button class="btn btn-sm delete-note-btn" data-delete-id="${note.id}" style="padding: 2px 6px; font-size: 11px; color: var(--danger);">Delete</button>
          </div>
        </div>
      `;
    })
    .join('');

  el.historyList.querySelectorAll('.history-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.delete-note-btn')) return;
      loadNote(item.dataset.id);
    });
  });

  el.historyList.querySelectorAll('.delete-note-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      deleteNote(btn.dataset.deleteId, e);
    });
  });
}

/**
 * Phase 4: Fetch and Render Offline Disk Models Status
 */
async function fetchLocalModelsStatus() {
  try {
    const res = await fetch('/api/say/models');
    if (!res.ok) return;
    const models = await res.json();
    for (const m of models) {
      if (m.key === 'moonshine-tiny' && el.offlineMoonshineTinyStatus) {
        el.offlineMoonshineTinyStatus.textContent = m.is_ready
          ? `Ready on Disk (${m.total_size_formatted})`
          : 'Not on Disk (Auto-caches on use)';
        el.offlineMoonshineTinyStatus.classList.toggle('ready', m.is_ready);
      }
      if (m.key === 'moonshine-base' && el.offlineMoonshineBaseStatus) {
        el.offlineMoonshineBaseStatus.textContent = m.is_ready
          ? `Ready on Disk (${m.total_size_formatted})`
          : 'Not on Disk (Auto-caches on use)';
        el.offlineMoonshineBaseStatus.classList.toggle('ready', m.is_ready);
      }
      if (m.key === 'whisper-large-v3-turbo' && el.offlineLargeStatus) {
        el.offlineLargeStatus.textContent = m.is_ready
          ? `Ready on Disk (${m.total_size_formatted})`
          : 'Not on Disk (Downloads on first use)';
        el.offlineLargeStatus.classList.toggle('ready', m.is_ready);
      }
      if (m.key === 'whisper-tiny' && el.offlineTinyStatus) {
        el.offlineTinyStatus.textContent = m.is_ready
          ? `Ready on Disk (${m.total_size_formatted})`
          : 'Not on Disk';
        el.offlineTinyStatus.classList.toggle('ready', m.is_ready);
      }
    }
  } catch (err) {
    console.warn('[Say] Could not query local models:', err);
  }
}

async function triggerOfflineModelDownload() {
  let modelPreset = 'moonshine-tiny';
  if (state.selectedModel.includes('moonshine-base')) {
    modelPreset = 'moonshine-base';
  } else if (state.selectedModel.includes('turbo')) {
    modelPreset = 'whisper-large-v3-turbo';
  } else if (state.selectedModel.includes('whisper-tiny')) {
    modelPreset = 'whisper-tiny';
  }

  showToast(`Starting disk download for ${modelPreset}...`, 'info');

  try {
    const res = await fetch('/api/say/models/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelPreset }),
    });
    if (res.ok) {
      showToast('Download started in background. Check terminal/settings for progress.', 'success');
      setTimeout(fetchLocalModelsStatus, 4000);
    }
  } catch (err) {
    showToast(`Download failed: ${err.message}`, 'error');
  }
}

/**
 * Export Options
 */
function downloadFile(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`Downloaded ${fileName}`, 'success');
}

async function exportToServer() {
  const title = el.noteTitle.value.trim() || 'Dictation';
  const content = el.editorCanvas.innerText;

  if (!content.trim()) {
    showToast('Document is empty.', 'info');
    return;
  }

  try {
    const res = await fetch('/api/say/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        content,
        format: 'md',
        metadata: {
          chunks: state.currentChunks,
          words: el.statWords.textContent,
        },
      }),
    });

    const data = await res.json();
    if (res.ok) {
      showToast(`Saved to ${data.filename} on local disk!`, 'success');
      closeAllDrawers();
    } else {
      throw new Error(data.detail || 'Export failed');
    }
  } catch (err) {
    showToast(`Server save error: ${err.message}`, 'error');
  }
}

/**
 * Toast Notifications
 */
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  el.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

/**
 * UI Drawer Helpers
 */
function closeAllDrawers() {
  el.settingsDrawer.classList.remove('open');
  el.settingsBackdrop.classList.remove('open');
  el.historyDrawer.classList.remove('open');
  el.historyBackdrop.classList.remove('open');
  el.exportDrawer.classList.remove('open');
  el.exportBackdrop.classList.remove('open');
  if (el.glossaryDrawer) el.glossaryDrawer.classList.remove('open');
  if (el.glossaryBackdrop) el.glossaryBackdrop.classList.remove('open');
}

/**
 * Wire User Interactions
 */
function wireEvents() {
  // Tabs Switcher
  el.tabMicBtn.addEventListener('click', () => {
    el.tabMicBtn.classList.add('active');
    el.tabUploadBtn.classList.remove('active');
    el.micSection.style.display = 'flex';
    el.uploadSection.style.display = 'none';
  });

  el.tabUploadBtn.addEventListener('click', () => {
    el.tabUploadBtn.classList.add('active');
    el.tabMicBtn.classList.remove('active');
    el.micSection.style.display = 'none';
    el.uploadSection.style.display = 'flex';
  });

  // Phase 1: Mode Switcher (Stream vs Batch)
  el.modeStreamBtn.addEventListener('click', () => {
    state.engineMode = 'stream';
    el.modeStreamBtn.classList.add('active');
    el.modeBatchBtn.classList.remove('active');
    showToast('Engine mode: Real-Time Streaming (VAD)');
  });

  el.modeBatchBtn.addEventListener('click', () => {
    state.engineMode = 'batch';
    el.modeBatchBtn.classList.add('active');
    el.modeStreamBtn.classList.remove('active');
    showToast('Engine mode: Batch Record & Transcribe');
  });

  // Record Button
  el.toggleRecordBtn.addEventListener('click', () => {
    if (state.isRecording) {
      stopRecordingAndTranscribe();
    } else {
      startRecording();
    }
  });

  el.pauseRecordBtn.addEventListener('click', pauseRecording);
  el.finishTranscribeBtn.addEventListener('click', stopRecordingAndTranscribe);

  // File Upload
  el.dropzone.addEventListener('click', () => el.audioFileInput.click());

  el.audioFileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelected(file);
  });

  el.dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    el.dropzone.classList.add('drag-over');
  });

  el.dropzone.addEventListener('dragleave', () => {
    el.dropzone.classList.remove('drag-over');
  });

  el.dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    el.dropzone.classList.remove('drag-over');
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelected(file);
  });

  el.transcribeUploadedBtn.addEventListener('click', transcribeUploadedFile);

  // Electroacoustic Glossary Drawer Events
  if (el.glossaryBtn) {
    el.glossaryBtn.addEventListener('click', () => {
      closeAllDrawers();
      renderGlossaryUI();
      el.glossaryDrawer.classList.add('open');
      el.glossaryBackdrop.classList.add('open');
    });
  }

  if (el.closeGlossaryBtn) {
    el.closeGlossaryBtn.addEventListener('click', closeAllDrawers);
  }

  if (el.glossaryBackdrop) {
    el.glossaryBackdrop.addEventListener('click', closeAllDrawers);
  }

  if (el.addCustomTermBtn && el.customTermInput) {
    const handleAddTerm = () => {
      const term = el.customTermInput.value.trim();
      if (term) {
        addCustomTerm(term);
        el.customTermInput.value = '';
      }
    };
    el.addCustomTermBtn.addEventListener('click', handleAddTerm);
    el.customTermInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddTerm();
      }
    });
  }

  // Formatting Toolbar
  document.querySelectorAll('.toolbar-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const command = btn.dataset.command;
      const val = btn.dataset.val || null;
      document.execCommand(command, false, val);
      el.editorCanvas.focus();
    });
  });

  // Editor Actions
  el.editorCanvas.addEventListener('input', () => {
    updateWordCounts();
    saveCurrentNote(true);
  });

  el.noteTitle.addEventListener('input', () => {
    saveCurrentNote(true);
  });

  el.copyBtn.addEventListener('click', async () => {
    const text = el.editorCanvas.innerText;
    if (!text.trim()) {
      showToast('Document is empty.', 'info');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied to clipboard!', 'success');
    } catch (_) {
      document.execCommand('copy');
      showToast('Copied to clipboard!', 'success');
    }
  });

  el.clearEditorBtn.addEventListener('click', () => {
    if (confirm('Clear the current note content?')) {
      el.editorCanvas.innerHTML = '';
      state.currentChunks = [];
      updateWordCounts();
      saveCurrentNote(false);
    }
  });

  el.timestampsToggleBtn.addEventListener('click', () => {
    state.timestampsEnabled = !state.timestampsEnabled;
    el.timestampsToggleText.textContent = `Timestamps: ${state.timestampsEnabled ? 'On' : 'Off'}`;
    el.timestampsToggleBtn.classList.toggle('btn-primary', state.timestampsEnabled);
    showToast(`Timestamps ${state.timestampsEnabled ? 'enabled' : 'disabled'}`);
  });

  el.editorCanvas.addEventListener('click', (e) => {
    const chip = e.target.closest('.timestamp-chip');
    if (chip && chip.dataset.time) {
      const time = parseFloat(chip.dataset.time);
      if (el.noteAudioPlayer && el.noteAudioPlayer.src) {
        el.noteAudioPlayer.currentTime = time;
        el.noteAudioPlayer.play();
      } else if (el.audioPlayer && el.audioPlayer.src) {
        el.audioPlayer.currentTime = time;
        el.audioPlayer.play();
      }
    }
  });

  if (el.retranscribeNoteAudioBtn) {
    el.retranscribeNoteAudioBtn.addEventListener('click', transcribeCurrentNoteAudio);
  }

  // Drawers
  el.settingsBtn.addEventListener('click', () => {
    closeAllDrawers();
    fetchLocalModelsStatus();
    el.settingsDrawer.classList.add('open');
    el.settingsBackdrop.classList.add('open');
  });

  el.closeSettingsBtn.addEventListener('click', closeAllDrawers);
  el.settingsBackdrop.addEventListener('click', closeAllDrawers);

  el.historyBtn.addEventListener('click', () => {
    closeAllDrawers();
    renderHistoryList();
    el.historyDrawer.classList.add('open');
    el.historyBackdrop.classList.add('open');
  });

  el.closeHistoryBtn.addEventListener('click', closeAllDrawers);
  el.historyBackdrop.addEventListener('click', closeAllDrawers);
  el.searchHistoryInput.addEventListener('input', (e) => {
    renderHistoryList(e.target.value);
  });

  el.newNoteBtn.addEventListener('click', createNewNote);

  el.exportBtn.addEventListener('click', () => {
    closeAllDrawers();
    el.exportDrawer.classList.add('open');
    el.exportBackdrop.classList.add('open');
  });

  el.closeExportBtn.addEventListener('click', closeAllDrawers);
  el.exportBackdrop.addEventListener('click', closeAllDrawers);

  // Export handlers
  el.exportMdBtn.addEventListener('click', () => {
    const title = el.noteTitle.value.trim() || 'dictation';
    const content = `# ${title}\n\n${el.editorCanvas.innerText}`;
    downloadFile(content, `${title.toLowerCase().replace(/\s+/g, '_')}.md`, 'text/markdown');
  });

  el.exportTxtBtn.addEventListener('click', () => {
    const title = el.noteTitle.value.trim() || 'dictation';
    downloadFile(el.editorCanvas.innerText, `${title.toLowerCase().replace(/\s+/g, '_')}.txt`, 'text/plain');
  });

  el.exportJsonBtn.addEventListener('click', () => {
    const title = el.noteTitle.value.trim() || 'dictation';
    const json = JSON.stringify(
      {
        title,
        timestamp: new Date().toISOString(),
        chunks: state.currentChunks,
        content: el.editorCanvas.innerText,
      },
      null,
      2
    );
    downloadFile(json, `${title.toLowerCase().replace(/\s+/g, '_')}.json`, 'application/json');
  });

  el.exportServerBtn.addEventListener('click', exportToServer);

  // Phase 4: Download offline models button
  el.downloadOfflineBtn.addEventListener('click', triggerOfflineModelDownload);

  // Model Selection Synchronizer
  const updateModelSelection = (newModel) => {
    state.selectedModel = newModel;
    if (el.modelPresetSelect) el.modelPresetSelect.value = newModel;
    if (el.modelQuickSelect) el.modelQuickSelect.value = newModel;

    const isServer = newModel.startsWith('server/');
    const isMoonshine = newModel.includes('moonshine');
    const isTiny = newModel.includes('whisper-tiny');
    const isTurbo = newModel.includes('turbo');

    if (isServer) {
      el.engineStatusText.textContent = 'Host CPU (16GB RAM)';
      updateGpuBadge(false, 'Host RAM (16GB)', 'Python faster-whisper CPU engine with full 16GB system RAM');
      showToast('Engine: Host System CPU (16GB RAM via faster-whisper)', 'info');
      if (state.worker) state.worker.terminate();
      return;
    }

    if (isMoonshine) {
      state.selectedDevice = 'wasm';
      if (el.deviceSelect) el.deviceSelect.value = 'wasm';
      const label = newModel.includes('base') ? 'Moonshine Base (CPU)' : 'Moonshine Tiny (CPU)';
      el.engineStatusText.textContent = label;
      updateGpuBadge(false, 'CPU WASM (Low Footprint)');
      showToast(`Model: ${label} — Lightweight CPU-First Architecture`, 'info');
    } else if (isTiny) {
      state.selectedDevice = 'wasm';
      if (el.deviceSelect) el.deviceSelect.value = 'wasm';
      el.engineStatusText.textContent = 'Whisper Tiny (Instant)';
      updateGpuBadge(false, 'CPU WASM (Instant)');
      showToast('Model: Whisper Tiny (~0.3s Instant)', 'info');
    } else if (isTurbo) {
      state.selectedDevice = state.webgpuAvailable ? 'webgpu' : 'wasm';
      if (el.deviceSelect) el.deviceSelect.value = state.selectedDevice;
      el.engineStatusText.textContent = 'Whisper Turbo';
      updateGpuBadge(state.webgpuAvailable, state.webgpuAvailable ? 'WebGPU Active (FP16)' : 'WebAssembly (High RAM)');
      showToast('Model: Whisper Large-v3-Turbo (Studio WebGPU)', 'info');
    } else {
      el.engineStatusText.textContent = newModel.split('/').pop();
      showToast(`Model: ${newModel.split('/').pop()}`, 'info');
    }

    // ORT never returns WASM heap memory, so load each model in a fresh worker.
    initWorker();
    state.worker.postMessage({
      type: 'load',
      payload: {
        modelId: state.selectedModel,
        device: state.selectedDevice,
        dtype: state.selectedDtype === 'auto' ? null : state.selectedDtype,
      },
    });
  };

  if (el.modelQuickSelect) {
    el.modelQuickSelect.addEventListener('change', (e) => updateModelSelection(e.target.value));
  }

  el.modelPresetSelect.addEventListener('change', (e) => updateModelSelection(e.target.value));

  el.deviceSelect.addEventListener('change', (e) => {
    state.selectedDevice = e.target.value;
    updateGpuBadge(state.selectedDevice === 'webgpu', state.selectedDevice === 'webgpu' ? 'WebGPU' : 'WebAssembly');
  });

  el.dtypeSelect.addEventListener('change', (e) => {
    state.selectedDtype = e.target.value;
  });

  el.preloadModelBtn.addEventListener('click', () => {
    if (state.selectedModel.startsWith('server/')) {
      showToast('Host CPU engine (faster-whisper) is always ready on demand.', 'info');
      closeAllDrawers();
      return;
    }
    if (!state.worker) initWorker();
    state.worker.postMessage({
      type: 'load',
      payload: {
        modelId: state.selectedModel,
        device: state.selectedDevice,
        dtype: state.selectedDtype === 'auto' ? null : state.selectedDtype,
      },
    });
    showToast('Starting model pre-load...', 'info');
    closeAllDrawers();
  });

  el.clearCacheBtn.addEventListener('click', async () => {
    if (confirm('Clear browser cache storage for all downloaded AI models?')) {
      if ('caches' in window) {
        const keys = await caches.keys();
        for (const k of keys) {
          await caches.delete(k);
        }
        showToast('Model cache cleared.', 'info');
      } else {
        showToast('Cache API not available.', 'info');
      }
    }
  });

  // Always lock theme to clean white/light theme
  const applyTheme = () => {
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('ead-portal:theme', 'light');
  };
  applyTheme();
  window.addEventListener('storage', (e) => {
    if (e.key === 'ead-portal:theme') applyTheme();
  });
}

/**
 * Synchronizes notes between server disk storage and browser cache
 */
async function syncNotesWithDisk() {
  try {
    const res = await fetch('/api/say/notes');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const serverNotes = await res.json();
    const localNotes = getStoredNotes();

    const noteMap = new Map();
    // 1. Populate with server notes (ground truth on disk)
    for (const sn of serverNotes) {
      noteMap.set(sn.id, sn);
    }
    // 2. If browser cache contains local notes not yet on disk, sync them up
    for (const ln of localNotes) {
      if (!noteMap.has(ln.id)) {
        noteMap.set(ln.id, ln);
        syncNoteToServer(ln);
      }
    }

    const mergedNotes = Array.from(noteMap.values()).sort(
      (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
    );
    localStorage.setItem('say_notes_v1', JSON.stringify(mergedNotes));
    renderHistoryList();

    if (mergedNotes.length > 0) {
      loadNote(mergedNotes[0].id);
    } else {
      createNewNote();
    }
  } catch (err) {
    console.warn('[Say] Could not sync notes from server disk:', err);
    const localNotes = getStoredNotes();
    renderHistoryList();
    if (localNotes.length > 0) {
      loadNote(localNotes[0].id);
    } else {
      createNewNote();
    }
  }
}

/**
 * Application Entry Point
 */
async function initApp() {
  wireEvents();
  renderGlossaryUI();
  await detectHardwareAcceleration();
  initWorker();
  fetchLocalModelsStatus();
  await syncNotesWithDisk();

  // Background warm-up: preload default lightweight CPU model
  if (state.worker && !state.selectedModel.startsWith('server/')) {
    state.worker.postMessage({
      type: 'load',
      payload: {
        modelId: state.selectedModel,
        device: state.selectedDevice,
        dtype: state.selectedDtype === 'auto' ? null : state.selectedDtype,
      },
    });
  }
}

// Start app
initApp();
