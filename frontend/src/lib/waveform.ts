/* ──────────────────────────────────────────────────────────────────
   Decode + decimate audio peaks; zoom-aware visible-window slicing.
   The waveform is a BOUNDED, decimated strip — never a full-res buffer.
   ────────────────────────────────────────────────────────────────── */

export interface PeakData {
  /** Decimated min/max pairs, interleaved: [min0, max0, min1, max1, ...]. */
  peaks: Float32Array;
  /** Number of buckets (peaks.length / 2). */
  length: number;
  /** Total audio duration in seconds. */
  duration: number;
  /** Source sample rate. */
  sampleRate: number;
}

let sharedCtx: AudioContext | OfflineAudioContext | null = null;

function getDecodeContext(): AudioContext {
  if (!sharedCtx || !(sharedCtx instanceof AudioContext)) {
    sharedCtx = new AudioContext();
  }
  return sharedCtx as AudioContext;
}

/**
 * Decode an audio file/blob and decimate it into `buckets` min/max pairs.
 * Mixes channels to mono. `buckets` caps memory regardless of song length.
 */
export async function decodePeaks(
  source: ArrayBuffer | Blob | File,
  buckets = 2000,
): Promise<PeakData> {
  const arrayBuffer =
    source instanceof ArrayBuffer ? source : await (source as Blob).arrayBuffer();
  const ctx = getDecodeContext();
  const audio = await ctx.decodeAudioData(arrayBuffer.slice(0));
  return decimateBuffer(audio, buckets);
}

/** Decimate an already-decoded AudioBuffer into min/max buckets. */
export function decimateBuffer(audio: AudioBuffer, buckets: number): PeakData {
  const channels = audio.numberOfChannels;
  const frames = audio.length;
  const safeBuckets = Math.max(1, Math.min(buckets, frames));
  const peaks = new Float32Array(safeBuckets * 2);
  const blockSize = Math.floor(frames / safeBuckets) || 1;

  // pre-fetch channel data
  const data: Float32Array[] = [];
  for (let c = 0; c < channels; c++) data.push(audio.getChannelData(c));

  for (let b = 0; b < safeBuckets; b++) {
    const startFrame = b * blockSize;
    const endFrame = Math.min(startFrame + blockSize, frames);
    let min = 1;
    let max = -1;
    for (let i = startFrame; i < endFrame; i++) {
      let sum = 0;
      for (let c = 0; c < channels; c++) sum += data[c][i];
      const v = sum / channels;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    peaks[b * 2] = min;
    peaks[b * 2 + 1] = max;
  }

  return {
    peaks,
    length: safeBuckets,
    duration: audio.duration,
    sampleRate: audio.sampleRate,
  };
}

/**
 * Slice the decimated peaks to a visible time window. Returns the
 * sub-array of min/max pairs intersecting [startSec, endSec].
 */
export function visibleWindow(
  data: PeakData,
  startSec: number,
  endSec: number,
): Float32Array {
  if (data.duration <= 0) return data.peaks;
  const s = Math.max(0, Math.min(startSec, data.duration));
  const e = Math.max(s, Math.min(endSec, data.duration));
  const startBucket = Math.floor((s / data.duration) * data.length);
  const endBucket = Math.ceil((e / data.duration) * data.length);
  return data.peaks.subarray(startBucket * 2, endBucket * 2);
}

/** Build an SVG path string for a peaks array fit to width × height. */
export function peaksToPath(peaks: Float32Array, width: number, height: number): string {
  const buckets = peaks.length / 2;
  if (buckets === 0) return '';
  const mid = height / 2;
  const dx = width / buckets;
  let up = `M 0 ${mid}`;
  let down = '';
  for (let b = 0; b < buckets; b++) {
    const x = b * dx;
    const max = peaks[b * 2 + 1];
    const min = peaks[b * 2];
    up += ` L ${x.toFixed(2)} ${(mid - max * mid).toFixed(2)}`;
    down = ` L ${x.toFixed(2)} ${(mid - min * mid).toFixed(2)}` + down;
  }
  return `${up}${down} Z`;
}
