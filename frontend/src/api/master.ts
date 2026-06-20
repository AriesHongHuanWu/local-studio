/* ──────────────────────────────────────────────────────────────────
   Auto-Mastering (母帶) endpoints.

   Processes a mix into a release-ready master (EQ / compression / width /
   loudness target / true-peak limiter), all locally. Optionally matches an
   uploaded reference track.

   Contract (backend base http://127.0.0.1:8756):
     POST /api/master        multipart {audio, genre, loudness, reference?} -> { jobId }
     GET  /api/master/jobs/{id}                                             -> MasterJobStatus
     GET  /api/master/jobs/{id}/result                                      -> audio/wav
   ────────────────────────────────────────────────────────────────── */

import { apiUrl, ApiError, API_BASE } from './client';

export type MasterLoudness = 'streaming' | 'balanced' | 'social';
export type MasterJobStatusValue = 'queued' | 'running' | 'done' | 'error';

// ── Intelligent analysis types (smart auto-mastering) ──────────────────────
export type Severity = 'high' | 'medium' | 'low';

export interface AnalysisBand {
  name: string;
  lo: number;
  hi: number;
  measured_db: number;
  target_db: number;
  deviation_db: number;
  eq_gain_db: number;
}

export interface AnalysisProblem {
  id: string;
  severity: Severity;
  area: string;
  message: string;     // zh
  messageEn: string;
  action: string;      // zh
  actionEn: string;
  metrics: Record<string, number | null>;
}

export interface AnalysisSection {
  start_s: number;
  end_s: number;
  type: 'verse' | 'chorus';
}

export interface MasterCorrections {
  eq_band_gains_db: Record<string, number>;
  /** Combined auto-EQ frequency response curve (for visualization). */
  eq_curve?: { f: number; db: number }[];
  low_cut_hz: number;
  mono_below_hz: number;
  comp_amount: number;
  width_factor: number;
  loudness: string;
  tp_ceiling_dbtp: number;
  section_amount: number;
  trust: number;
}

/** Full intelligent analysis of a mix (from /api/master/analyze or master meta). */
export interface MasterAnalysis {
  sr: number;
  duration_s: number;
  genre: string;
  spectrum: {
    freqs: number[];
    before_db: number[];
    after_db: number[];
    target_db: number[];
  };
  bands: AnalysisBand[];
  sections: {
    times_s: number[];
    energy_db: number[];
    segments: AnalysisSection[];
    gain_curve_db: number[];
    amount: number;
  };
  loudness: {
    integrated_lufs: number;
    short_term_max_lufs: number;
    momentary_max_lufs: number;
    lra_lu: number;
    true_peak_dbtp: number;
    sample_peak_dbfs: number;
  };
  dynamics: {
    crest_factor_db: number;
    plr: number;
    psr: number;
    dr_est: number | null;
    rms_db: number;
  };
  spectral: {
    centroid_hz: number;
    tilt_db_oct: number;
  };
  stereo: {
    correlation: number;
    width_index: number;
    ms_balance_db: number;
    low_mono_corr: number;
    mono_compatible: boolean;
  };
  problems: AnalysisProblem[];
  corrections: MasterCorrections;
  overall_score: number;
  /** AI genre detection (suggestion; user can accept/override). */
  detectedGenre?: {
    genre: string;
    confidence: number;
    ranking: { genre: string; prob: number }[];
    features: { crest_db: number; width: number; tilt_db_oct: number };
  };
}

// ── Pro chain meters + stereo imager (v0.1.17) ─────────────────────────────
export interface BandGR {
  gr_db: number[];
  max_gr_db: number;
}
export interface MasterMeters {
  multiband?: {
    active: boolean;
    f_lo?: number;
    f_hi?: number;
    crossovers?: number[];
    meter_hz: number;
    // Auto mode keys by low/mid/high; manual multiband keys by freq-range label.
    bands: Record<string, BandGR | undefined>;
  };
  deess?: {
    active: boolean;
    band_hz: [number, number];
    meter_hz: number;
    gr_db?: number[];
    max_reduction_db?: number;
    active_pct?: number;
  };
  saturation?: { amount: number };
  residual_eq?: { applied_db: Record<string, number>; max_db: number; strength: number };
  dynamic_eq?: {
    f0: number;
    q?: number;
    mode: string;
    gr_db?: number[];
    max_db: number;
    active: boolean;
    target?: string;
  }[];
}
export interface GoniometerData {
  points: [number, number][];
  correlation: number;
  width_index: number;
  bands: { name: string; correlation: number; width_index: number }[];
}
export interface ChainState {
  stages: string[];
  deEss: number;
  dynamicEq?: number;
  adaptiveEq?: boolean;
  automationEq?: boolean;
  multiband: boolean;
  saturation: number;
  residualEq: boolean;
}

/** Mastering measurement/summary returned in the job meta. */
export interface MasterMeta {
  sampleRate: number;
  genre: string;
  loudness: string;
  auto?: boolean;
  referenceUsed: boolean;
  width: number;
  inputLufs: number;
  outputLufs: number;
  targetLufs: number;
  inputPeakDb: number;
  outputPeakDb: number;
  ceilingDb: number;
  /** Loudness-matched A/B: the original rendered at the master's loudness. */
  matchedLufs?: number | null;
  matchGainDb?: number;
  hasMatched?: boolean;
  /** Before/after intelligent analysis for the A/B visualization (auto mode). */
  before?: MasterAnalysis | null;
  after?: MasterAnalysis | null;
  /** Per-stage meters (multiband GR, de-ess, saturation, residual EQ). */
  meters?: MasterMeters;
  /** Stereo imager / goniometer data on the final master. */
  goniometer?: GoniometerData;
  /** Which stages ran + their amounts. */
  chain?: ChainState;
  /** AI stem rebalance result: which stems + applied gains. null if not run / skipped. */
  stemRebalance?: { applied: Record<string, number>; stems: string[] } | null;
}

export interface MasterJobStatus {
  status: MasterJobStatusValue;
  pct: number;
  message: string;
  error: string | null;
  meta: MasterMeta | null;
}

export interface CreateMasterJobResponse {
  jobId: string;
}

/** Optional advanced (進階) overrides — all default to the genre preset. */
export interface MasterAdvanced {
  /** Stereo width 0.5..1.5 (1 = unchanged). */
  width?: number;
  /** Section macro-dynamics −1..1 (>0 = punch/chorus impact, <0 = balance). */
  dynamics?: number;
  /** 4-band EQ offsets in dB (−12..12), added on top of the preset. */
  eqBass?: number;
  eqLowMid?: number;
  eqPresence?: number;
  eqAir?: number;
  /** Compression intensity 0..2 (0 = none, 1 = preset, 2 = double). */
  compScale?: number;
  /** True-peak ceiling override dBTP (−6..0). */
  ceiling?: number;
  /** Intelligent mode: analyze the song and apply data-driven corrections as the base. */
  auto?: boolean;
  /** Auto-correction strength 0.2 (natural) .. 1.0 (strong). Default 0.7. */
  autoStrength?: number;
  /** Pro chain (v0.1.17): de-esser, multiband comp, saturation, 2nd-pass EQ. */
  deEss?: boolean;
  deEssAmount?: number;
  multiband?: boolean;
  saturation?: number;
  residualEq?: boolean;
  /** Pro mode: JSON-stringified parametric EQ band array. */
  paramEq?: string;
  /** Adaptive EQ (automation): time-varying corrective EQ that rides the song. */
  adaptiveEq?: boolean;
  /** Pro mode: JSON-stringified manual multiband {crossovers, bands}. */
  multibandManual?: string;
  /** Pro mode: JSON-stringified EQ automation lanes [{freq,q,points}]. */
  automationEq?: string;
  /** Pro mode: JSON-stringified AI stem rebalance {enabled, gains:{drums,bass,vocals,other}}. */
  stemRebalance?: string;
}

/** POST /api/master — spawn the background mastering job. */
export async function createMasterJob(
  audio: File,
  genre: string,
  loudness: MasterLoudness,
  reference?: File | null,
  advanced?: MasterAdvanced,
  signal?: AbortSignal,
): Promise<CreateMasterJobResponse> {
  const form = new FormData();
  form.append('audio', audio, audio.name);
  form.append('genre', genre);
  form.append('loudness', loudness);
  if (reference) form.append('reference', reference, reference.name);
  if (advanced) {
    const a = advanced;
    const add = (k: string, v: number | undefined) => {
      if (v !== undefined && Number.isFinite(v)) form.append(k, String(v));
    };
    add('width', a.width);
    add('dynamics', a.dynamics);
    add('eqBass', a.eqBass);
    add('eqLowMid', a.eqLowMid);
    add('eqPresence', a.eqPresence);
    add('eqAir', a.eqAir);
    add('compScale', a.compScale);
    add('ceiling', a.ceiling);
    add('autoStrength', a.autoStrength);
    add('deEssAmount', a.deEssAmount);
    add('saturation', a.saturation);
    if (a.auto) form.append('auto', 'true');
    if (a.deEss !== undefined) form.append('deEss', String(a.deEss));
    if (a.multiband !== undefined) form.append('multiband', String(a.multiband));
    if (a.residualEq !== undefined) form.append('residualEq', String(a.residualEq));
    if (a.paramEq) form.append('paramEq', a.paramEq);
    if (a.adaptiveEq) form.append('adaptiveEq', 'true');
    if (a.multibandManual) form.append('multibandManual', a.multibandManual);
    if (a.automationEq) form.append('automationEq', a.automationEq);
    if (a.stemRebalance) form.append('stemRebalance', a.stemRebalance);
  }

  let res: Response;
  try {
    res = await fetch(apiUrl('/api/master'), { method: 'POST', body: form, signal });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'network error';
    throw new ApiError(`Cannot reach local backend at ${API_BASE} (${message})`, 0, true);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = (await res.json()) as { detail?: string; message?: string };
      detail = data.detail ?? data.message ?? detail;
    } catch {
      /* keep statusText */
    }
    throw new ApiError(detail || `Mastering failed (${res.status})`, res.status);
  }
  return (await res.json()) as CreateMasterJobResponse;
}

/** GET /api/master/jobs/{id} — poll job status. */
export async function getMasterJob(jobId: string, signal?: AbortSignal): Promise<MasterJobStatus> {
  let res: Response;
  try {
    res = await fetch(apiUrl(`/api/master/jobs/${encodeURIComponent(jobId)}`), { method: 'GET', signal });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'network error';
    throw new ApiError(`Cannot reach local backend at ${API_BASE} (${message})`, 0, true);
  }
  if (!res.ok) {
    throw new ApiError(`Job status failed (${res.status})`, res.status);
  }
  return (await res.json()) as MasterJobStatus;
}

/** Absolute URL for the finished mastered wav. */
export function masterResultUrl(jobId: string): string {
  return apiUrl(`/api/master/jobs/${encodeURIComponent(jobId)}/result`);
}

/** Absolute URL for the loudness-matched original (for an honest A/B). */
export function masterMatchedUrl(jobId: string): string {
  return apiUrl(`/api/master/jobs/${encodeURIComponent(jobId)}/result/matched`);
}

/** POST /api/master/match — loudness-match any upload (e.g. an external master)
 *  to targetLufs, returning the matched WAV blob (for a fair 3-way A/B/C). */
export async function matchAudio(audio: File, targetLufs: number, signal?: AbortSignal): Promise<Blob> {
  const form = new FormData();
  form.append('audio', audio, audio.name);
  form.append('targetLufs', String(targetLufs));
  let res: Response;
  try {
    res = await fetch(apiUrl('/api/master/match'), { method: 'POST', body: form, signal });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'network error';
    throw new ApiError(`Cannot reach local backend at ${API_BASE} (${message})`, 0, true);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const d = (await res.json()) as { detail?: string };
      detail = d.detail ?? detail;
    } catch { /* keep */ }
    throw new ApiError(detail || `Match failed (${res.status})`, res.status);
  }
  return await res.blob();
}

/** POST /api/master/analyze — intelligent diagnosis of a mix (no rendering). */
export async function analyzeMaster(
  audio: File,
  genre: string,
  strength?: number,
  signal?: AbortSignal,
): Promise<MasterAnalysis> {
  const form = new FormData();
  form.append('audio', audio, audio.name);
  form.append('genre', genre);
  if (strength !== undefined && Number.isFinite(strength)) form.append('strength', String(strength));
  let res: Response;
  try {
    res = await fetch(apiUrl('/api/master/analyze'), { method: 'POST', body: form, signal });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'network error';
    throw new ApiError(`Cannot reach local backend at ${API_BASE} (${message})`, 0, true);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = (await res.json()) as { detail?: string; message?: string };
      detail = data.detail ?? data.message ?? detail;
    } catch {
      /* keep statusText */
    }
    throw new ApiError(detail || `Analyze failed (${res.status})`, res.status);
  }
  return (await res.json()) as MasterAnalysis;
}
