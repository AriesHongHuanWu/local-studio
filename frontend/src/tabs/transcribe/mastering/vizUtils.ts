/* ──────────────────────────────────────────────────────────────────
   Shared helpers for the mastering visualizations: log-frequency &
   dB scale math, formatting, and metric → verdict (good/warn/bad).
   ────────────────────────────────────────────────────────────────── */

export type Verdict = 'good' | 'warn' | 'bad' | 'neutral';

/** Map a frequency (Hz) to an x position on a log axis. */
export function logX(f: number, fmin: number, fmax: number, x0: number, w: number): number {
  const a = Math.log10(fmin);
  const b = Math.log10(fmax);
  const lf = Math.log10(Math.min(fmax, Math.max(fmin, f)));
  return x0 + ((lf - a) / (b - a)) * w;
}

/** Map a dB value to a y position (top = dbMax). */
export function dbY(db: number, dbMin: number, dbMax: number, y0: number, h: number): number {
  const c = Math.max(dbMin, Math.min(dbMax, db));
  return y0 + (1 - (c - dbMin) / (dbMax - dbMin)) * h;
}

/** Short frequency label: 60, 250, 1k, 12k. */
export function fmtHz(f: number): string {
  if (f >= 1000) return `${(f / 1000).toFixed(f >= 10000 ? 0 : 1)}k`;
  return `${Math.round(f)}`;
}

/** Signed dB string with a leading + when positive. */
export function fmtDb(v: number, digits = 1): string {
  const s = v.toFixed(digits);
  return v > 0 ? `+${s}` : s;
}

// ── Metric verdicts (ranges from the mastering spec) ──────────────────────
export function verdictLra(lra: number): Verdict {
  if (lra < 3) return 'bad';
  if (lra < 4 || lra > 18) return 'warn';
  if (lra > 14) return 'warn';
  return 'good';
}
export function verdictTruePeak(dbtp: number): Verdict {
  if (dbtp > 0) return 'bad';
  if (dbtp > -1) return 'warn';
  return 'good';
}
export function verdictCrest(crest: number): Verdict {
  if (crest < 6) return 'bad';
  if (crest < 8) return 'warn';
  return 'good';
}
export function verdictDr(dr: number | null): Verdict {
  if (dr == null) return 'neutral';
  if (dr <= 5) return 'bad';
  if (dr <= 7) return 'warn';
  return 'good';
}
export function verdictCorrelation(c: number): Verdict {
  if (c < 0) return 'bad';
  if (c < 0.2 || c > 0.95) return 'warn';
  return 'good';
}
export function verdictLowMono(c: number): Verdict {
  if (c < 0.3) return 'bad';
  if (c < 0.6) return 'warn';
  return 'good';
}
export function verdictWidth(wi: number): Verdict {
  if (wi < 0.12 || wi > 1.0) return 'warn';
  return 'good';
}
/** Loudness vs the chosen target: within ~1 LU is good. */
export function verdictLoudness(lufs: number, target: number): Verdict {
  const d = Math.abs(lufs - target);
  if (d <= 1) return 'good';
  if (d <= 3) return 'warn';
  return 'bad';
}

export function scoreVerdict(score: number): Verdict {
  if (score >= 80) return 'good';
  if (score >= 55) return 'warn';
  return 'bad';
}
