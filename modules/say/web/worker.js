/**
 * Web Worker for Say — Local Speech-to-Text Dictation
 * Runs @huggingface/transformers v3 in a background thread with WebGPU acceleration.
 * Supports:
 * - Phase 1: Real-time streaming chunks via VAD
 * - Phase 2: Domain-specific vocabulary biasing & electroacoustic normalizer
 * - Phase 4: Offline local model loading
 */

// Must be the ORT-bundled build: transformers.web.js has bare imports that fail in a browser.
import { pipeline, env } from './vendor/transformers.min.js';

// Configure environment
env.allowLocalModels = true;
env.allowRemoteModels = true;
env.localModelPath = '/modules/say/models/';
// Default points at jsDelivr (slow/blocked on corporate networks); use the vendored runtime.
if (env.backends.onnx?.wasm) env.backends.onnx.wasm.wasmPaths = '/modules/say/vendor/';

// Default configuration: Whisper Tiny for instant sub-second dictation
const DEFAULT_MODEL = 'onnx-community/whisper-tiny';

let transcriber = null;
let currentModelId = null;
let currentDevice = null;
let currentDtype = null;
let isInitializing = false;
let pipelineLoadingPromise = null;

/**
 * Phase 2: Domain Vocabulary Normalizer for Electroacoustic Engineering
 * Enforces correct casing, acronyms, and formatting for specialized engineering terms.
 */
const DEFAULT_DOMAIN_RULES = [
  { pattern: /\bthd\s*\+\s*n\b/gi, replacement: 'THD+N' },
  { pattern: /\bthd\b/gi, replacement: 'THD' },
  { pattern: /\bmems\b/gi, replacement: 'MEMS' },
  { pattern: /\b(db\s*spl|dbspl)\b/gi, replacement: 'dBSPL' },
  { pattern: /\bspl\b/gi, replacement: 'SPL' },
  { pattern: /\bsnr\b/gi, replacement: 'SNR' },
  { pattern: /\b(rub\s*(?:&|and)\s*buzz)\b/gi, replacement: 'Rub & Buzz' },
  { pattern: /\b(balanced?\s+armatures?)\b/gi, replacement: 'Balanced Armature' },
  { pattern: /\b(iec\s*60318-4|711\s*coupler)\b/gi, replacement: 'IEC 60318-4' },
  { pattern: /\b(qts|qes|qms|vas|cms|mms)\b/gi, replacement: (m) => m.charAt(0).toUpperCase() + m.slice(1).toLowerCase() },
  { pattern: /\b(pzt|ecm|pdm|i2s|tdm|anc|pnc|hrtf|bem|fem)\b/gi, replacement: (m) => m.toUpperCase() },
];

function applyDomainEnhancements(rawText, customTerms = []) {
  if (!rawText) return rawText;
  let text = rawText;

  // 1. Built-in electroacoustic terminology
  for (const rule of DEFAULT_DOMAIN_RULES) {
    text = text.replace(rule.pattern, rule.replacement);
  }

  // 2. User-defined custom glossary terms
  if (Array.isArray(customTerms) && customTerms.length > 0) {
    for (const term of customTerms) {
      const cleanTerm = term.trim();
      if (cleanTerm.length > 1) {
        const regex = new RegExp(`\\b${cleanTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
        text = text.replace(regex, cleanTerm);
      }
    }
  }

  return text;
}

/**
 * Normalizes device and dtype configuration depending on model.
 * Whisper Tiny runs on WebAssembly SIMD (q8 / quantized) in ~0.3s.
 * Whisper Turbo runs on WebGPU (FP16 encoder + Q4 decoder) for heavy studio jobs.
 */
function resolveDeviceAndDtype(modelId, requestedDevice, requestedDtype) {
  if (modelId.includes('whisper-tiny')) {
    return {
      device: 'wasm',
      dtype: 'q8',
    };
  }

  if (modelId.includes('whisper-large-v3-turbo')) {
    return {
      device: requestedDevice === 'wasm' ? 'wasm' : 'webgpu',
      dtype: {
        encoder_model: 'fp16',
        decoder_model_merged: 'q4',
      },
    };
  }

  const device = requestedDevice || 'webgpu';
  const dtype = requestedDtype && requestedDtype !== 'auto'
    ? requestedDtype
    : (device === 'webgpu' ? 'fp16' : 'q8');
  return { device, dtype };
}

/**
 * Initializes or re-initializes the transcription pipeline
 */
async function loadPipeline(modelId = DEFAULT_MODEL, requestedDevice = null, requestedDtype = null) {
  const { device, dtype } = resolveDeviceAndDtype(modelId, requestedDevice, requestedDtype);

  if (
    transcriber &&
    currentModelId === modelId &&
    currentDevice === device &&
    JSON.stringify(currentDtype) === JSON.stringify(dtype)
  ) {
    self.postMessage({
      type: 'status',
      status: 'ready',
      modelId,
      device,
      dtype,
      cached: true,
      message: 'Model is already loaded and ready in memory.',
    });
    return transcriber;
  }

  // If already loading this exact configuration, await the in-flight promise
  if (pipelineLoadingPromise && currentModelId === modelId && currentDevice === device) {
    return await pipelineLoadingPromise;
  }

  // Free the previous model's GPU/WASM memory before loading another one.
  if (transcriber) await resetPipeline();

  isInitializing = true;
  currentModelId = modelId;
  currentDevice = device;
  currentDtype = dtype;

  const shortName = modelId.split('/').pop();
  self.postMessage({
    type: 'status',
    status: 'loading',
    modelId,
    device,
    dtype,
    message: `Initializing ${shortName} (${device.toUpperCase()})...`,
  });

  pipelineLoadingPromise = (async () => {
    try {
      const pipelineOptions = {
        device: device,
        dtype: dtype,
        progress_callback: (progressData) => {
          self.postMessage({
            type: 'progress',
            data: progressData,
          });
        },
      };

      // Prioritize local disk bundle if present in /modules/say/models/<shortName>/
      let effectiveModelId = modelId;
      try {
        const checkRes = await fetch(`/modules/say/models/${shortName}/config.json`, { method: 'HEAD' });
        if (checkRes.ok) {
          effectiveModelId = shortName;
        }
      } catch (_) {}

      console.log(`[Say Worker] Loading pipeline: ${effectiveModelId} on ${device}...`);
      const startTime = performance.now();
      transcriber = await pipeline('automatic-speech-recognition', effectiveModelId, pipelineOptions);
      const loadDurationSec = ((performance.now() - startTime) / 1000).toFixed(2);

      isInitializing = false;
      pipelineLoadingPromise = null;

      self.postMessage({
        type: 'status',
        status: 'ready',
        modelId,
        device,
        dtype,
        durationSec: loadDurationSec,
        message: `Model loaded successfully in ${loadDurationSec}s (${device.toUpperCase()})`,
      });

      console.log(`[Say Worker] Pipeline ready in ${loadDurationSec}s (${device.toUpperCase()})`);
      return transcriber;
    } catch (err) {
      isInitializing = false;
      transcriber = null;
      pipelineLoadingPromise = null;

      const errMsg = describeError(err);
      console.error('[Say Worker] Error loading pipeline:', err);

      self.postMessage({
        type: 'error',
        stage: 'load',
        message: errMsg,
        modelId,
        device,
        canFallback: device === 'webgpu' && !modelId.includes('large'),
      });
      throw err;
    }
  })();

  return await pipelineLoadingPromise;
}

/**
 * Internal helper to run transcription with domain vocabulary biasing
 */
async function runTranscription(audio, options, isStream = false) {
  const audioDurationNum = audio.length / 16000;
  const audioDurationSec = audioDurationNum.toFixed(2);

  const runOptions = {
    return_timestamps: options?.return_timestamps !== false,
  };

  // Only apply chunking/striding for long audio (> 30s).
  // For short audio clips (e.g. 7s dictation), single-pass is 5-10x faster!
  if (audioDurationNum > 30) {
    runOptions.chunk_length_s = options?.chunk_length_s ?? 30;
    runOptions.stride_length_s = options?.stride_length_s ?? 5;
  }

  if (options?.language && options.language !== 'auto') {
    runOptions.language = options.language;
  }
  if (options?.task) {
    runOptions.task = options.task;
  }

  // Domain vocabulary prompt biasing
  if (options?.initial_prompt) {
    runOptions.initial_prompt = options.initial_prompt;
  }

  console.log(`[Say Worker] Running transcription for ${audioDurationSec}s audio on ${currentDevice}...`);
  const transcribeStartTime = performance.now();
  const output = await transcriber(audio, runOptions);
  const transcribeDurationSec = ((performance.now() - transcribeStartTime) / 1000).toFixed(2);
  const speedMultiplier = (audioDurationNum / Math.max(0.01, parseFloat(transcribeDurationSec))).toFixed(1);
  console.log(`[Say Worker] Transcription completed in ${transcribeDurationSec}s (${speedMultiplier}x real-time)`);

  // Apply Phase 2 domain normalizer to post-process text
  const customTerms = options?.customTerms || [];
  if (output.text) {
    output.text = applyDomainEnhancements(output.text, customTerms);
  }
  if (Array.isArray(output.chunks)) {
    for (const chunk of output.chunks) {
      if (chunk.text) {
        chunk.text = applyDomainEnhancements(chunk.text, customTerms);
      }
    }
  }

  return {
    output,
    stats: {
      inferenceTimeSec: transcribeDurationSec,
      audioDurationSec,
      speedMultiplier: `${speedMultiplier}x`,
      device: currentDevice,
      model: currentModelId,
      isStream,
    },
  };
}

/**
 * Handles incoming messages from the main thread.
 * ONNX Runtime web sessions cannot run concurrently (overlapping runs surface as raw numeric
 * errors), so every message is processed strictly one after another.
 */
let messageQueue = Promise.resolve();
self.addEventListener('message', (event) => {
  messageQueue = messageQueue.then(() => handleMessage(event.data)).catch((err) => {
    console.error('[Say Worker] Unhandled message error:', err);
  });
});

/** ORT throws bare numbers (WASM pointers) on GPU/memory failures; make that readable. */
function describeError(err) {
  const raw = err?.message ?? String(err);
  if (/^\d+$/.test(String(raw).trim())) {
    return `ONNX Runtime failed (code ${raw}) on ${currentDevice || 'unknown device'} with ${currentModelId || 'model'}. ` +
      'Usually GPU/memory exhaustion or an unsupported GPU op; try Whisper Tiny or reload the plugin.';
  }
  return raw;
}

/** Drops the loaded pipeline so the next job reloads cleanly after a runtime failure. */
async function resetPipeline() {
  const old = transcriber;
  transcriber = null;
  currentModelId = null;
  try {
    await old?.dispose?.();
  } catch (_) {}
}

async function handleMessage({ type, payload }) {

  if (type === 'load') {
    const { modelId, device, dtype } = payload || {};
    try {
      await loadPipeline(modelId, device, dtype);
    } catch (err) {
      console.warn('[Say Worker] Preload warning:', err);
    }
    return;
  }

  // Full / Batch transcription
  if (type === 'transcribe') {
    const { audio, options, modelId, device, dtype } = payload;

    if (!audio || !(audio instanceof Float32Array)) {
      self.postMessage({
        type: 'error',
        stage: 'transcribe',
        message: 'Invalid audio input: Expected Float32Array at 16kHz mono.',
      });
      return;
    }

    try {
      const loadStart = performance.now();
      await loadPipeline(
        modelId || DEFAULT_MODEL,
        device || currentDevice || 'webgpu',
        dtype || currentDtype
      );
      const loadWaitSec = ((performance.now() - loadStart) / 1000).toFixed(2);

      self.postMessage({
        type: 'status',
        status: 'transcribing',
        audioLengthSec: (audio.length / 16000).toFixed(2),
        message: 'Transcribing speech with Whisper...',
      });

      const result = await runTranscription(audio, options, false);
      result.stats.loadWaitSec = loadWaitSec;
      console.log(`[Say Worker] Waited ${loadWaitSec}s for model before inference`);
      self.postMessage({
        type: 'complete',
        output: result.output,
        stats: result.stats,
      });
    } catch (err) {
      console.error('[Say Worker] Transcription failed:', err);
      const message = describeError(err);
      await resetPipeline();
      self.postMessage({
        type: 'error',
        stage: 'transcribe',
        message,
      });
    }
    return;
  }

  // Phase 1: Real-time streaming chunk from VAD
  if (type === 'transcribe_stream_chunk') {
    const { audio, options, chunkId, modelId, device, dtype } = payload;

    if (!audio || !(audio instanceof Float32Array)) return;

    try {
      await loadPipeline(
        modelId || DEFAULT_MODEL,
        device || currentDevice || 'webgpu',
        dtype || currentDtype
      );

      self.postMessage({
        type: 'status',
        status: 'transcribing',
        message: 'Transcribing streaming speech chunk...',
      });

      const result = await runTranscription(audio, options, true);
      self.postMessage({
        type: 'stream_chunk_complete',
        chunkId,
        output: result.output,
        stats: result.stats,
      });
    } catch (err) {
      console.warn('[Say Worker] Stream chunk failed:', err);
      const message = describeError(err);
      await resetPipeline();
      self.postMessage({
        type: 'stream_chunk_error',
        chunkId,
        message,
      });
    }
    return;
  }

  if (type === 'ping') {
    self.postMessage({
      type: 'pong',
      isReady: !!transcriber,
      isInitializing,
      currentModel: currentModelId,
      currentDevice,
    });
  }
}
