/* ──────────────────────────────────────────────────────────────────
   waveform — decode an audio/video source into normalized peak buckets
   for drawing in the timeline. Results are cached by src and decoded once
   on a shared AudioContext; subscribers are notified when peaks arrive.
   ────────────────────────────────────────────────────────────────── */

const BUCKETS = 600;
const cache = new Map<string, number[] | 'loading' | null>();
const subs = new Set<() => void>();
let actx: AudioContext | null = null;

function notify() { subs.forEach((f) => f()); }

async function decode(src: string) {
  try {
    if (!actx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      actx = new Ctx();
    }
    const ab = await (await fetch(src)).arrayBuffer();
    const buf = await actx.decodeAudioData(ab);
    const data = buf.getChannelData(0);
    const block = Math.max(1, Math.floor(data.length / BUCKETS));
    const peaks: number[] = [];
    let peak = 0;
    for (let i = 0; i < BUCKETS; i++) {
      let max = 0;
      const s = i * block;
      for (let j = 0; j < block; j += 8) { const x = Math.abs(data[s + j] || 0); if (x > max) max = x; }
      peaks.push(max);
      if (max > peak) peak = max;
    }
    const norm = peak > 0 ? peaks.map((p) => p / peak) : peaks;
    cache.set(src, norm);
  } catch {
    cache.set(src, null);
  }
  notify();
}

/** Peaks for a source (0..1, BUCKETS long), or null while loading / on failure. */
export function getPeaks(src: string): number[] | null {
  const v = cache.get(src);
  if (v === undefined) { cache.set(src, 'loading'); void decode(src); return null; }
  return Array.isArray(v) ? v : null;
}

export function onWaveformReady(cb: () => void): () => void {
  subs.add(cb);
  return () => { subs.delete(cb); };
}

export const PEAK_BUCKETS = BUCKETS;
