/**
 * Web Worker for Say — Local Speech-to-Text Dictation
 * Runs @huggingface/transformers v3 in a background thread with WebGPU acceleration.
 */

// Import Transformers.js v3 from local vendored build (with fallback)
import { pipeline, env } from './vendor/transformers.web.js';

// Configure environment
env.allowLocalModels = false;
env.allowRemoteModels = true;

// Default configuration based on Whisper Large-v3-Turbo + WebGPU roadmap
const DEFAULT_MODEL = 'onnx-community/whisper-large-v3-turbo';

let transcriber = null;
let currentModelId = null;
let currentDevice = null;
let currentDtype = null;
let isInitializing = false;

/**
 * Normalizes dtype configuration depending on model and device
 */
function resolveDtype(modelId, device, requestedDtype) {
  if (requestedDtype && typeof requestedDtype === 'object') {
    return requestedDtype;
  }
  if (requestedDtype && typeof requestedDtype === 'string') {
    return requestedDtype;
  }

  // Model-specific defaults
  if (modelId.includes('whisper-large-v3-turbo')) {
    if (device === 'webgpu') {
      // 4-bit decoder keeps browser allocations well within limits
      // FP16 encoder takes advantage of GPU tensor performance
      return {
        encoder_model: 'fp16',
        decoder_model_merged: 'q4',
      };
    } else {
      // WASM / CPU fallback
      return {
        encoder_model: 'quantized',
        decoder_model_merged: 'q4',
      };
    }
  }

  // For smaller models (tiny, base, small)
  if (device === 'webgpu') {
    return 'fp16';
  }
  return 'q8';
}

/**
 * Initializes or re-initializes the transcription pipeline
 */
async function loadPipeline(modelId = DEFAULT_MODEL, device = 'webgpu', dtype = null) {
  const resolvedDtype = resolveDtype(modelId, device, dtype);

  // Return existing pipeline if matching
  if (
    transcriber &&
    currentModelId === modelId &&
    currentDevice === device &&
    JSON.stringify(currentDtype) === JSON.stringify(resolvedDtype)
  ) {
    self.postMessage({
      type: 'status',
      status: 'ready',
      modelId,
      device,
      dtype: resolvedDtype,
      cached: true,
      message: 'Model is already loaded and ready in memory.',
    });
    return transcriber;
  }

  isInitializing = true;
  currentModelId = modelId;
  currentDevice = device;
  currentDtype = resolvedDtype;

  self.postMessage({
    type: 'status',
    status: 'loading',
    modelId,
    device,
    dtype: resolvedDtype,
    message: `Initializing pipeline for ${modelId} (${device})...`,
  });

  try {
    const pipelineOptions = {
      device: device,
      dtype: resolvedDtype,
      progress_callback: (progressData) => {
        // Forward fine-grained download progress back to main thread
        self.postMessage({
          type: 'progress',
          data: progressData,
        });
      },
    };

    const startTime = performance.now();
    transcriber = await pipeline('automatic-speech-recognition', modelId, pipelineOptions);
    const loadDurationSec = ((performance.now() - startTime) / 1000).toFixed(2);

    isInitializing = false;

    self.postMessage({
      type: 'status',
      status: 'ready',
      modelId,
      device,
      dtype: resolvedDtype,
      durationSec: loadDurationSec,
      message: `Model loaded successfully in ${loadDurationSec}s (${device.toUpperCase()})`,
    });

    return transcriber;
  } catch (err) {
    isInitializing = false;
    transcriber = null;

    const errMsg = err?.message || String(err);
    console.error('[Say Worker] Error loading pipeline:', err);

    self.postMessage({
      type: 'error',
      stage: 'load',
      message: errMsg,
      modelId,
      device,
      canFallback: device === 'webgpu',
    });
    throw err;
  }
}

/**
 * Handles incoming messages from the main thread
 */
self.addEventListener('message', async (event) => {
  const { type, payload } = event.data;

  if (type === 'load') {
    const { modelId, device, dtype } = payload || {};
    try {
      await loadPipeline(modelId, device, dtype);
    } catch (e) {
      // Error already dispatched
    }
    return;
  }

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
      // Ensure pipeline is ready
      if (!transcriber || (modelId && modelId !== currentModelId) || (device && device !== currentDevice)) {
        await loadPipeline(modelId || DEFAULT_MODEL, device || currentDevice || 'webgpu', dtype || currentDtype);
      }

      self.postMessage({
        type: 'status',
        status: 'transcribing',
        audioLengthSec: (audio.length / 16000).toFixed(2),
        message: 'Transcribing speech with Whisper...',
      });

      const transcribeStartTime = performance.now();

      const runOptions = {
        chunk_length_s: options?.chunk_length_s ?? 30,
        stride_length_s: options?.stride_length_s ?? 5,
        return_timestamps: options?.return_timestamps !== false,
      };

      if (options?.language && options.language !== 'auto') {
        runOptions.language = options.language;
      }
      if (options?.task) {
        runOptions.task = options.task; // 'transcribe' or 'translate'
      }

      const output = await transcriber(audio, runOptions);
      const transcribeDurationSec = ((performance.now() - transcribeStartTime) / 1000).toFixed(2);
      const audioDurationSec = (audio.length / 16000).toFixed(2);
      const speedMultiplier = (audioDurationSec / Math.max(0.01, transcribeDurationSec)).toFixed(1);

      self.postMessage({
        type: 'complete',
        output: output,
        stats: {
          inferenceTimeSec: transcribeDurationSec,
          audioDurationSec: audioDurationSec,
          speedMultiplier: `${speedMultiplier}x`,
          device: currentDevice,
          model: currentModelId,
        },
      });
    } catch (err) {
      console.error('[Say Worker] Transcription failed:', err);
      self.postMessage({
        type: 'error',
        stage: 'transcribe',
        message: err?.message || String(err),
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
});
