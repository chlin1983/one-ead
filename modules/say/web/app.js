/**
 * Say — Voice Dictation & Audio Transcription App
 * High-accuracy local Whisper Large-v3-Turbo with WebGPU acceleration
 */

import {
  decodeAudioBlob,
  formatTime,
  formatTimestampRange,
  AudioVisualizer,
} from './audio-utils.js';

// DOM Elements
const el = {
  // Badges & Header
  gpuBadge: document.getElementById('gpu-badge'),
  gpuBadgeText: document.getElementById('gpu-badge-text'),
  engineStatusText: document.getElementById('engine-status-text'),
  newNoteBtn: document.getElementById('new-note-btn'),
  historyBtn: document.getElementById('history-btn'),
  settingsBtn: document.getElementById('settings-btn'),

  // Mode Switcher Tabs
  tabMicBtn: document.getElementById('tab-mic-btn'),
  tabUploadBtn: document.getElementById('tab-upload-btn'),
  micSection: document.getElementById('mic-section'),
  uploadSection: document.getElementById('upload-section'),

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

  // Drawers & Modals
  settingsBackdrop: document.getElementById('settings-backdrop'),
  settingsDrawer: document.getElementById('settings-drawer'),
  closeSettingsBtn: document.getElementById('close-settings-btn'),
  modelPresetSelect: document.getElementById('model-preset-select'),
  deviceSelect: document.getElementById('device-select'),
  dtypeSelect: document.getElementById('dtype-select'),
  preloadModelBtn: document.getElementById('preload-model-btn'),
  clearCacheBtn: document.getElementById('clear-cache-btn'),

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
  visualizer: null,
  uploadedFile: null,
  activeAudioUrl: null,

  // Hardware & Model Configuration
  webgpuAvailable: false,
  gpuAdapterName: '',
  hasFp16: false,
  selectedModel: 'onnx-community/whisper-large-v3-turbo',
  selectedDevice: 'webgpu',
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
    updateGpuBadge(false, 'WebAssembly (CPU)');
    return;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (adapter) {
      state.webgpuAvailable = true;
      state.hasFp16 = adapter.features.has('shader-f16');
      state.gpuAdapterName = adapter.info?.device || adapter.info?.description || 'GPU Accelerator';

      updateGpuBadge(
        true,
        `WebGPU Active (${state.hasFp16 ? 'FP16' : 'FP32'})`,
        `Adapter: ${state.gpuAdapterName}\nFP16 Shader Support: ${state.hasFp16 ? 'Yes' : 'No'}`
      );
    } else {
      state.webgpuAvailable = false;
      state.selectedDevice = 'wasm';
      el.deviceSelect.value = 'wasm';
      updateGpuBadge(false, 'WebAssembly (CPU Fallback)');
    }
  } catch (err) {
    console.warn('[Say] WebGPU detection error:', err);
    state.webgpuAvailable = false;
    state.selectedDevice = 'wasm';
    el.deviceSelect.value = 'wasm';
    updateGpuBadge(false, 'WebAssembly (CPU Fallback)');
  }
}

function updateGpuBadge(active, text, title = '') {
  el.gpuBadge.classList.toggle('inactive', !active);
  el.gpuBadgeText.textContent = text;
  if (title) el.gpuBadge.title = title;
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
    const { type, status, message, data, output, stats, durationSec, modelId, device } = event.data;

    if (type === 'progress') {
      handleDownloadProgress(data);
    } else if (type === 'status') {
      handleStatusUpdate(status, message, durationSec, modelId, device);
    } else if (type === 'complete') {
      handleTranscriptionComplete(output, stats);
    } else if (type === 'error') {
      handleWorkerError(event.data);
    }
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
    el.progressStatusTitle.textContent = `Status: Ready (${device ? device.toUpperCase() : 'WebGPU'})`;
    el.engineStatusText.textContent = modelId ? modelId.split('/').pop() : 'Whisper Turbo';
    if (durationSec) {
      showToast(`Model ready in ${durationSec}s`, 'success');
    }
  } else if (status === 'transcribing') {
    state.isWorkerBusy = true;
    el.progressStatusTitle.textContent = 'Transcribing audio...';
    el.progressBarFill.style.width = '100%';
    el.progressPercentage.textContent = 'Processing';
  }
}

function handleTranscriptionComplete(output, stats) {
  state.isWorkerBusy = false;
  el.progressStatusTitle.textContent = 'Transcription Complete';
  el.progressBarFill.style.width = '100%';
  el.progressPercentage.textContent = 'Done';

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

  // Append new text to editor
  insertTranscriptionIntoEditor(rawText, chunks);

  updateWordCounts();
  saveCurrentNote();
  showToast('Transcription finished!', 'success');
}

function handleWorkerError(errData) {
  state.isWorkerBusy = false;
  console.error('[Say Worker Error]', errData);
  el.progressStatusTitle.textContent = `Error: ${errData.message || 'Processing failed'}`;
  el.progressBarFill.style.width = '0%';
  el.progressPercentage.textContent = 'Failed';

  if (errData.canFallback) {
    showToast('WebGPU failed. Falling back to WebAssembly (CPU)...', 'error');
    state.selectedDevice = 'wasm';
    el.deviceSelect.value = 'wasm';
    updateGpuBadge(false, 'WebAssembly (Fallback)');
  } else {
    showToast(`Error: ${errData.message || 'Operation failed'}`, 'error');
  }
}

/**
 * Inserts transcribed text or formatted timestamp chunks into the editor canvas
 */
function insertTranscriptionIntoEditor(rawText, chunks) {
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

  // Auto scroll to bottom of editor
  el.editorCanvas.scrollTop = el.editorCanvas.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Audio Recording Logic
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
    state.recordedAudioChunks = [];

    // Initialize AudioContext & Visualizer
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const sourceNode = state.audioContext.createMediaStreamSource(stream);
    state.analyserNode = state.audioContext.createAnalyser();
    sourceNode.connect(state.analyserNode);

    if (!state.visualizer) {
      state.visualizer = new AudioVisualizer(el.visualizerCanvas);
    }
    state.visualizer.attach(state.analyserNode);
    state.visualizer.start();

    // Setup MediaRecorder
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

    state.mediaRecorder.start(250); // Slice every 250ms

    // Update UI
    state.isRecording = true;
    state.isPaused = false;
    state.recordStartTime = Date.now();
    state.recordElapsedMs = 0;

    el.micSection.classList.add('recording');
    el.recordMicIcon.style.display = 'none';
    el.recordStopIcon.style.display = 'block';
    el.recordStatusLabel.textContent = 'Listening... Speak clearly';
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
  el.recordStatusLabel.textContent = 'Processing audio...';

  if (state.visualizer) {
    state.visualizer.stop();
  }

  // Stop media tracks
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach((t) => t.stop());
  }

  await new Promise((resolve) => {
    state.mediaRecorder.onstop = resolve;
    state.mediaRecorder.stop();
  });

  if (state.audioContext) {
    try {
      await state.audioContext.close();
    } catch (_) {}
  }

  const recordedBlob = new Blob(state.recordedAudioChunks, {
    type: state.mediaRecorder.mimeType || 'audio/webm',
  });

  if (recordedBlob.size < 100) {
    el.recordStatusLabel.textContent = 'Recording was too short.';
    return;
  }

  // Create preview playback
  setAudioPreview(recordedBlob, 'Microphone Recording');

  // Decode to 16kHz Float32Array PCM
  try {
    el.recordStatusLabel.textContent = 'Decoding audio for Whisper...';
    const { pcm16k } = await decodeAudioBlob(recordedBlob);
    dispatchTranscription(pcm16k);
    el.recordStatusLabel.textContent = 'Transcribing with WebGPU...';
  } catch (err) {
    console.error('[Say] Audio decode failed:', err);
    showToast(`Audio decoding error: ${err.message}`, 'error');
    el.recordStatusLabel.textContent = 'Decoding failed.';
  }
}

function pauseRecording() {
  if (!state.isRecording || !state.mediaRecorder) return;

  if (state.isPaused) {
    // Resume
    state.mediaRecorder.resume();
    state.recordStartTime = Date.now();
    state.isPaused = false;
    el.pauseBtnText.textContent = 'Pause';
    el.recordStatusLabel.textContent = 'Listening... Speak clearly';
    if (state.visualizer) state.visualizer.start();
  } else {
    // Pause
    state.mediaRecorder.pause();
    state.recordElapsedMs += Date.now() - state.recordStartTime;
    state.isPaused = true;
    el.pauseBtnText.textContent = 'Resume';
    el.recordStatusLabel.textContent = 'Recording paused';
    if (state.visualizer) state.visualizer.stop();
  }
}

/**
 * Dispatches audio PCM Float32Array to Web Worker for Whisper processing
 */
function dispatchTranscription(audioPcmFloat32) {
  if (!state.worker) {
    initWorker();
  }

  const options = {
    language: el.languageSelect.value,
    task: el.taskSelect.value,
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5,
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

function createNewNote() {
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
  updateWordCounts();
  saveCurrentNote();
  showToast('Created new note', 'success');
}

function saveCurrentNote() {
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
    storedNotes[existingIdx] = note;
  } else {
    storedNotes.unshift(note);
  }

  localStorage.setItem('say_notes_v1', JSON.stringify(storedNotes));
  el.saveStatus.textContent = 'Auto-saved locally';
  renderHistoryList();
}

function getStoredNotes() {
  try {
    const raw = localStorage.getItem('say_notes_v1');
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function loadNote(noteId) {
  const notes = getStoredNotes();
  const note = notes.find((n) => n.id === noteId);
  if (!note) return;

  state.currentNoteId = note.id;
  state.currentChunks = note.chunks || [];
  el.noteTitle.value = note.title;
  el.editorCanvas.innerHTML = note.html || escapeHtml(note.content || '');
  updateWordCounts();
  closeAllDrawers();
}

function deleteNote(noteId, event) {
  if (event) event.stopPropagation();
  let notes = getStoredNotes();
  notes = notes.filter((n) => n.id !== noteId);
  localStorage.setItem('say_notes_v1', JSON.stringify(notes));

  if (state.currentNoteId === noteId) {
    createNewNote();
  } else {
    renderHistoryList();
  }
  showToast('Note deleted', 'info');
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

      return `
        <div class="history-item${activeClass}" data-id="${note.id}">
          <div class="history-item-top">
            <span class="history-item-title">${escapeHtml(note.title)}</span>
            <span class="history-item-date">${dateStr}</span>
          </div>
          <div class="history-item-preview">${escapeHtml(preview)}</div>
          <div style="margin-top: 4px; display: flex; justify-content: flex-end;">
            <button class="btn btn-sm delete-note-btn" data-delete-id="${note.id}" style="padding: 2px 6px; font-size: 11px; color: var(--danger);">Delete</button>
          </div>
        </div>
      `;
    })
    .join('');

  // Attach click events
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
    saveCurrentNote();
  });

  el.noteTitle.addEventListener('input', saveCurrentNote);

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
      saveCurrentNote();
    }
  });

  el.timestampsToggleBtn.addEventListener('click', () => {
    state.timestampsEnabled = !state.timestampsEnabled;
    el.timestampsToggleText.textContent = `Timestamps: ${state.timestampsEnabled ? 'On' : 'Off'}`;
    el.timestampsToggleBtn.classList.toggle('btn-primary', state.timestampsEnabled);
    showToast(`Timestamps ${state.timestampsEnabled ? 'enabled' : 'disabled'}`);
  });

  // Clickable Timestamps jump audio player
  el.editorCanvas.addEventListener('click', (e) => {
    const chip = e.target.closest('.timestamp-chip');
    if (chip && chip.dataset.time && el.audioPlayer.src) {
      const time = parseFloat(chip.dataset.time);
      el.audioPlayer.currentTime = time;
      el.audioPlayer.play();
    }
  });

  // Drawers
  el.settingsBtn.addEventListener('click', () => {
    closeAllDrawers();
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

  // Settings Controls
  el.modelPresetSelect.addEventListener('change', (e) => {
    state.selectedModel = e.target.value;
    el.engineStatusText.textContent = state.selectedModel.split('/').pop();
  });

  el.deviceSelect.addEventListener('change', (e) => {
    state.selectedDevice = e.target.value;
    updateGpuBadge(state.selectedDevice === 'webgpu', state.selectedDevice === 'webgpu' ? 'WebGPU' : 'WebAssembly');
  });

  el.dtypeSelect.addEventListener('change', (e) => {
    state.selectedDtype = e.target.value;
  });

  el.preloadModelBtn.addEventListener('click', () => {
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

  // Portal Shell Theme Sync
  const applyTheme = () => {
    const theme = localStorage.getItem('ead-portal:theme') || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  };
  applyTheme();
  window.addEventListener('storage', (e) => {
    if (e.key === 'ead-portal:theme') applyTheme();
  });
}

/**
 * Application Entry Point
 */
async function initApp() {
  wireEvents();
  await detectHardwareAcceleration();
  initWorker();

  // Load latest note or create new note
  const notes = getStoredNotes();
  if (notes.length > 0) {
    loadNote(notes[0].id);
  } else {
    createNewNote();
  }
}

// Start app
initApp();
