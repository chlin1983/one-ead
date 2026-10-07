/**
 * Audio processing utilities for Say.
 * Handles microphone capture, visualizer rendering, file decoding,
 * and high-fidelity resampling to 16,000 Hz mono PCM Float32Array for Whisper.
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
function resampleLinear(inputArray, inRate, outRate) {
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
