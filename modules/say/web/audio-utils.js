/**
 * Audio processing utilities for Say.
 * Handles microphone capture, visualizer rendering, file decoding,
 * real-time Voice Activity Detection (VAD), and 16,000 Hz resampling for Whisper.
 */

export const TARGET_SAMPLE_RATE = 16000;

/**
 * High quality audio resampler to 16kHz mono using OfflineAudioContext,
 * with fallback to linear interpolation if offline context is unsupported.
 */
export async function resampleAudioBufferTo16k(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const originalSampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;

  // Extract or downmix to mono Float32Array
  let monoChannel;
  if (numChannels === 1) {
    monoChannel = audioBuffer.getChannelData(0);
  } else {
    monoChannel = new Float32Array(audioBuffer.length);
    for (let c = 0; c < numChannels; c++) {
      const channelData = audioBuffer.getChannelData(c);
      for (let i = 0; i < audioBuffer.length; i++) {
        monoChannel[i] += channelData[i] / numChannels;
      }
    }
  }

  if (originalSampleRate === TARGET_SAMPLE_RATE) {
    return monoChannel;
  }

  // Use OfflineAudioContext for anti-aliased, hardware-accelerated sample rate conversion
  try {
    const targetLength = Math.max(1, Math.round(duration * TARGET_SAMPLE_RATE));
    const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(
      1,
      targetLength,
      TARGET_SAMPLE_RATE
    );

    const monoBuffer = offlineCtx.createBuffer(1, monoChannel.length, originalSampleRate);
    monoBuffer.copyToChannel(monoChannel, 0);

    const source = offlineCtx.createBufferSource();
    source.buffer = monoBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);

    const rendered = await offlineCtx.startRendering();
    return rendered.getChannelData(0);
  } catch (err) {
    console.warn('[audio-utils] OfflineAudioContext resampling failed, using linear interpolation:', err);
    return resampleLinear(monoChannel, originalSampleRate, TARGET_SAMPLE_RATE);
  }
}

/**
 * Linear interpolation resampling fallback
 */
export function resampleLinear(inputArray, inRate, outRate) {
  if (inRate === outRate) return inputArray;
  const ratio = inRate / outRate;
  const outLength = Math.round(inputArray.length / ratio);
  const result = new Float32Array(outLength);

  for (let i = 0; i < outLength; i++) {
    const originPos = i * ratio;
    const originIndex = Math.floor(originPos);
    const fraction = originPos - originIndex;
    const nextIndex = Math.min(originIndex + 1, inputArray.length - 1);
    result[i] = inputArray[originIndex] * (1 - fraction) + inputArray[nextIndex] * fraction;
  }
  return result;
}

/**
 * Decodes any audio file (mp3, wav, m4a, webm, ogg, flac) into 16kHz Float32Array
 */
export async function decodeAudioBlob(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const pcm16k = await resampleAudioBufferTo16k(audioBuffer);
    return {
      pcm16k,
      duration: audioBuffer.duration,
      sampleRate: TARGET_SAMPLE_RATE,
    };
  } finally {
    try {
      await audioCtx.close();
    } catch (_) {}
  }
}

/**
 * Formats seconds into MM:SS or HH:MM:SS
 */
export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n) => String(n).padStart(2, '0');

  if (hrs > 0) {
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

/**
 * Formats a timestamp range e.g. [00:04 -> 00:09]
 */
export function formatTimestampRange(start, end) {
  return `[${formatTime(start)} → ${formatTime(end)}]`;
}

/**
 * Real-time audio waveform and frequency visualizer on an HTML5 canvas
 */
export class AudioVisualizer {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.analyser = null;
    this.animationId = null;
    this.isRunning = false;
  }

  attach(analyserNode) {
    this.analyser = analyserNode;
    this.analyser.fftSize = 128;
    this.analyser.smoothingTimeConstant = 0.8;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.render();
  }

  stop() {
    this.isRunning = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.clear();
  }

  clear() {
    const { width, height } = this.canvas;
    this.ctx.clearRect(0, 0, width, height);

    // Draw a subtle baseline
    this.ctx.strokeStyle = 'rgba(120, 140, 160, 0.2)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(0, height / 2);
    this.ctx.lineTo(width, height / 2);
    this.ctx.stroke();
  }

  render = () => {
    if (!this.isRunning) return;
    this.animationId = requestAnimationFrame(this.render);

    const { width, height } = this.canvas;
    this.ctx.clearRect(0, 0, width, height);

    if (!this.analyser) {
      this.clear();
      return;
    }

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteFrequencyData(dataArray);

    const barWidth = (width / bufferLength) * 2;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * (height - 4);

      // Gradient color from emerald green to cyan
      const hue = 155 + (i / bufferLength) * 35;
      const lightness = 45 + (dataArray[i] / 255) * 25;
      this.ctx.fillStyle = `hsl(${hue}, 80%, ${lightness}%)`;

      // Centered mirrored rounded bars
      const y = (height - barHeight) / 2;
      const radius = Math.min(barWidth / 2, 2);

      this.ctx.beginPath();
      this.ctx.roundRect ? this.ctx.roundRect(x, y, Math.max(2, barWidth - 2), barHeight, radius)
                         : this.ctx.rect(x, y, Math.max(2, barWidth - 2), barHeight);
      this.ctx.fill();

      x += barWidth;
    }
  };
}

/**
 * Phase 1: Real-Time In-Browser Voice Activity Detector (VAD)
 * Analyzes live microphone audio buffers in real-time, detects sentence pauses (300-600ms),
 * and automatically yields clean speech chunks for streaming transcription.
 */
export class VoiceActivityDetector {
  constructor({
    audioContext,
    sourceNode,
    sampleRate = 16000,
    energyThreshold = 0.0035,
    silenceDurationMs = 450,
    minSpeechDurationMs = 180,
    maxSpeechDurationMs = 10000,
    onSpeechStart = () => {},
    onSpeechEnd = (pcmChunk) => {},
    onVADStatus = (isSpeaking, currentRms) => {},
  }) {
    this.audioContext = audioContext;
    this.sourceNode = sourceNode;
    this.sampleRate = sampleRate || audioContext?.sampleRate || 16000;
    this.energyThreshold = energyThreshold;
    this.silenceDurationMs = silenceDurationMs;
    this.minSpeechDurationMs = minSpeechDurationMs;
    this.maxSpeechDurationMs = maxSpeechDurationMs;

    this.onSpeechStart = onSpeechStart;
    this.onSpeechEnd = onSpeechEnd;
    this.onVADStatus = onVADStatus;

    this.isSpeaking = false;
    this.isRunning = false;

    // Buffer management
    this.speechBuffer = [];
    this.preRollRingBuffer = [];
    this.preRollDurationMs = 250; // Keep 250ms pre-roll to avoid chopping initial plosives
    this.silenceMsElapsed = 0;
    this.speechDurationMs = 0;
    this.noiseFloor = 0.002;

    this.processorNode = null;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isSpeaking = false;
    this.speechBuffer = [];
    this.silenceMsElapsed = 0;
    this.speechDurationMs = 0;

    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }

    const bufferSize = 2048;
    this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

    this.processorNode.onaudioprocess = (event) => {
      if (!this.isRunning) return;
      const inputData = event.inputBuffer.getChannelData(0);
      this.processAudioFrame(inputData);
    };

    this.sourceNode.connect(this.processorNode);
    this.processorNode.connect(this.audioContext.destination);
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;

    // Flush any pending speech if buffer has minimal audio
    const minSamples = (150 / 1000) * TARGET_SAMPLE_RATE;
    if (this.speechBuffer.length >= minSamples) {
      this.flushCurrentSpeech();
    } else {
      this.speechBuffer = [];
    }

    if (this.processorNode) {
      try {
        this.sourceNode.disconnect(this.processorNode);
        this.processorNode.disconnect();
      } catch (_) {}
      this.processorNode = null;
    }
  }

  processAudioFrame(frameSamples) {
    // 1. Calculate RMS energy
    let sum = 0;
    for (let i = 0; i < frameSamples.length; i++) {
      sum += frameSamples[i] * frameSamples[i];
    }
    const rms = Math.sqrt(sum / frameSamples.length);

    // Adaptive noise floor tracking
    this.noiseFloor = Math.min(this.noiseFloor * 0.96 + rms * 0.04, 0.015);
    const effectiveThreshold = Math.max(this.energyThreshold, this.noiseFloor * 1.45);
    const frameDurationMs = (frameSamples.length / this.sampleRate) * 1000;

    // Downsample frame if necessary to 16kHz
    const pcmFrame = this.sampleRate === TARGET_SAMPLE_RATE
      ? new Float32Array(frameSamples)
      : resampleLinear(frameSamples, this.sampleRate, TARGET_SAMPLE_RATE);

    const isVoiceNow = rms > effectiveThreshold;

    if (isVoiceNow) {
      this.silenceMsElapsed = 0;

      if (!this.isSpeaking) {
        // Speech onset
        this.isSpeaking = true;
        this.speechDurationMs = 0;
        this.onSpeechStart();

        // Prepend pre-roll buffer so starting consonant is crystal clear
        this.speechBuffer = [];
        for (const preChunk of this.preRollRingBuffer) {
          for (let i = 0; i < preChunk.length; i++) {
            this.speechBuffer.push(preChunk[i]);
          }
        }
      }

      this.speechDurationMs += frameDurationMs;
      for (let i = 0; i < pcmFrame.length; i++) {
        this.speechBuffer.push(pcmFrame[i]);
      }

      // Max duration safety flush
      if (this.speechDurationMs >= this.maxSpeechDurationMs) {
        this.flushCurrentSpeech();
      }
    } else {
      // Silence / Background noise frame
      if (this.isSpeaking) {
        // Keep trailing samples during brief pause
        for (let i = 0; i < pcmFrame.length; i++) {
          this.speechBuffer.push(pcmFrame[i]);
        }
        this.silenceMsElapsed += frameDurationMs;

        if (this.silenceMsElapsed >= this.silenceDurationMs) {
          // Pause detected! Flush complete sentence
          this.flushCurrentSpeech();
        }
      } else {
        // Maintain pre-roll ring buffer
        this.preRollRingBuffer.push(pcmFrame);
        const maxPreRollFrames = Math.ceil(this.preRollDurationMs / Math.max(1, frameDurationMs));
        while (this.preRollRingBuffer.length > maxPreRollFrames) {
          this.preRollRingBuffer.shift();
        }
      }
    }

    this.onVADStatus(this.isSpeaking, rms);
  }

  flushCurrentSpeech() {
    const minSamples = (this.minSpeechDurationMs / 1000) * TARGET_SAMPLE_RATE;
    if (this.speechBuffer.length >= minSamples) {
      const chunk = new Float32Array(this.speechBuffer);
      this.onSpeechEnd(chunk);
    }
    this.speechBuffer = [];
    this.isSpeaking = false;
    this.silenceMsElapsed = 0;
    this.speechDurationMs = 0;
  }
}

/**
 * Encodes 16kHz Float32 PCM audio data into a standard 16-bit mono WAV Blob.
 * Used to dispatch audio to the host Python faster-whisper CPU engine.
 */
export function pcmToWavBlob(pcmFloat32, sampleRate = TARGET_SAMPLE_RATE) {
  const numChannels = 1;
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmFloat32.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  // RIFF chunk descriptor
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');

  // FMT sub-chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // subchunk1size (16 for PCM)
  view.setUint16(20, 1, true); // audio format (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample

  // DATA sub-chunk
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // Write 16-bit PCM samples
  let offset = 44;
  for (let i = 0; i < pcmFloat32.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, pcmFloat32[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}
