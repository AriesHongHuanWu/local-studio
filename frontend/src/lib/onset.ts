/* ──────────────────────────────────────────────────────────────────
   Lightweight onset detection for magnetize-on-drag boundary snapping.
   Spectral-flux-free: uses a fast amplitude-envelope rise detector over
   the decimated peaks, which is plenty for "snap to the nearest attack".
   ────────────────────────────────────────────────────────────────── */

import type { PeakData } from './waveform';

export interface Onset {
  /** Time of the onset in seconds. */
  time: number;
  /** Relative strength 0..1. */
  strength: number;
}

/**
 * Detect onsets from decimated peak data. Computes a per-bucket energy
 * envelope, then flags local rises above a derivative threshold.
 */
export function detectOnsets(data: PeakData, sensitivity = 0.12): Onset[] {
  const buckets = data.length;
  if (buckets < 2 || data.duration <= 0) return [];

  // Per-bucket energy = peak-to-peak amplitude.
  const energy = new Float32Array(buckets);
  for (let b = 0; b < buckets; b++) {
    energy[b] = Math.abs(data.peaks[b * 2 + 1] - data.peaks[b * 2]);
  }

  // Smooth with a tiny moving average to kill jitter.
  const smooth = new Float32Array(buckets);
  const win = 2;
  for (let b = 0; b < buckets; b++) {
    let sum = 0;
    let n = 0;
    for (let k = -win; k <= win; k++) {
      const idx = b + k;
      if (idx >= 0 && idx < buckets) {
        sum += energy[idx];
        n++;
      }
    }
    smooth[b] = sum / n;
  }

  // Positive first-difference = energy rise.
  const onsets: Onset[] = [];
  const secPerBucket = data.duration / buckets;
  for (let b = 1; b < buckets - 1; b++) {
    const rise = smooth[b] - smooth[b - 1];
    const isPeak = smooth[b] >= smooth[b + 1];
    if (rise > sensitivity && isPeak) {
      onsets.push({
        time: b * secPerBucket,
        strength: Math.min(1, rise / (sensitivity * 4)),
      });
    }
  }
  return onsets;
}

/**
 * Find the onset closest to `time` within `window` seconds.
 * Returns the snapped time, or the original time if none is near.
 */
export function magnetize(onsets: Onset[], time: number, window = 0.08): number {
  let best = time;
  let bestDist = window;
  for (const o of onsets) {
    const d = Math.abs(o.time - time);
    if (d < bestDist) {
      bestDist = d;
      best = o.time;
    }
  }
  return best;
}
