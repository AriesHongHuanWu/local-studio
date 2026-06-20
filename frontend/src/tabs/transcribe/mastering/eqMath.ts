/* ──────────────────────────────────────────────────────────────────
   eqMath — client-side RBJ biquad magnitude response, so the parametric
   EQ curve updates instantly while dragging (no backend round-trip).
   Mirrors backend mastering._biquad exactly.
   ────────────────────────────────────────────────────────────────── */

export type EqType =
  | 'bell' | 'low_shelf' | 'high_shelf' | 'high_pass' | 'low_pass' | 'notch' | 'allpass';
export type EqChannel = 'stereo' | 'mid' | 'side' | 'left' | 'right';
export type EqPhase = 'min' | 'linear';

export interface EqBand {
  id: string;
  enabled: boolean;
  type: EqType;
  freq: number;   // Hz
  gain: number;   // dB
  q: number;
  phase: EqPhase;
  channel: EqChannel;
}

/** Normalized biquad coefficients [b0,b1,b2,1,a1,a2] (a0 folded in). */
function coeffs(type: EqType, sr: number, f0: number, gainDb: number, q: number): number[] {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * f0) / sr;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const alpha = sw / (2 * Math.max(q, 1e-4));
  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
  if (type === 'bell') {
    b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
    a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
  } else if (type === 'low_shelf') {
    const s = 2 * Math.sqrt(A) * alpha;
    b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s);
    a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s;
  } else if (type === 'high_shelf') {
    const s = 2 * Math.sqrt(A) * alpha;
    b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s);
    a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s;
  } else if (type === 'high_pass') {
    b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  } else if (type === 'low_pass') {
    b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  } else if (type === 'notch') {
    b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  } else { // allpass
    b0 = 1 - alpha; b1 = -2 * cw; b2 = 1 + alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  }
  return [b0 / a0, b1 / a0, b2 / a0, 1, a1 / a0, a2 / a0];
}

/** |H(e^jw)| in dB for one band at frequency f. */
export function bandMagnitudeDb(band: EqBand, sr: number, f: number): number {
  const [b0, b1, b2, , a1, a2] = coeffs(band.type, sr, band.freq, band.gain, band.q);
  const w = (2 * Math.PI * f) / sr;
  const cw = Math.cos(w), sw = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = b0 + b1 * cw + b2 * c2;
  const ni = -(b1 * sw + b2 * s2);
  const dr = 1 + a1 * cw + a2 * c2;
  const di = -(a1 * sw + a2 * s2);
  const num = Math.hypot(nr, ni);
  const den = Math.hypot(dr, di) || 1e-12;
  return 20 * Math.log10(num / den + 1e-12);
}

/** Combined response (dB) of all enabled bands over a log-freq grid. */
export function combinedResponse(bands: EqBand[], sr: number, freqs: number[]): number[] {
  return freqs.map((f) =>
    bands.reduce((acc, b) => (b.enabled ? acc + bandMagnitudeDb(b, sr, f) : acc), 0),
  );
}

/** Serialize the UI bands to the backend param_eq shape (freq_hz/gain_db keys). */
export function toBackendBands(bands: EqBand[]): Record<string, unknown>[] {
  return bands
    .filter((b) => b.enabled)
    .map((b) => ({
      enabled: true,
      type: b.type,
      freq_hz: b.freq,
      gain_db: b.gain,
      q: b.q,
      phase: b.phase,
      channel: b.channel,
    }));
}
