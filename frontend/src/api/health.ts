/* ──────────────────────────────────────────────────────────────────
   api/health.ts — typed wrapper for GET /api/health.

   The backend health-check reports, in one offline-fast call, what is
   PRESENT vs MISSING: Python deps (importable + version), CUDA, and each
   model. The frontend uses `missing[]` to drive the warn + self-heal
   banner (HealthBanner), re-fetching ONLY the missing pieces and reusing
   anything already cached.

   Like /api/meta this endpoint is read-only and offline-fast; on a
   network failure the caller (useHealth) keeps the UI rendering and
   simply marks itself offline.
   ────────────────────────────────────────────────────────────────── */

import { client } from './client';
import type { ModelInfo } from './types';

/** One Python dependency probe (importable + resolved version, or error). */
export interface HealthDep {
  /** True when the module imports cleanly at the required version. */
  ok: boolean;
  /** Resolved version string when importable; null/undefined otherwise. */
  version?: string | null;
  /** Import / version error detail when !ok. */
  error?: string | null;
  /** True when this dep is required for core use (vs an optional extra). */
  required?: boolean;
}

/** CUDA / GPU availability probe. */
export interface HealthCuda {
  available: boolean;
  version?: string | null;
  gpuName?: string | null;
  vramTotalMB?: number | null;
}

/** A category of missing piece the user must (re-)fetch to heal the app. */
export interface HealthMissing {
  /** "dep" → a Python package; "model" → a downloadable model/checkpoint. */
  category: 'dep' | 'model';
  /** For models: the ModelInfo.id passed to useModels.downloadAndTrack().
   *  For deps: the importable package name (healed via the venv setup). */
  id: string;
  /** Human label (single-language fallback; UI localizes known ids). */
  label: string;
  /** True → blocks core use (auto-repair); false → optional extra. */
  required: boolean;
  /** Approx download size in MB, when known. */
  sizeMB?: number;
  /** Stable reason code (localized in the frontend) or a raw message. */
  reason?: string;
}

/** Which product features are usable given what is currently installed. */
export interface HealthFeatures {
  songLyrics: boolean;
  videoSubtitles: boolean;
  cleanText: boolean;
}

/** The full health report returned by GET /api/health. */
export interface HealthReport {
  /** True when nothing required is missing (deps + cuda-optional + models). */
  healthy: boolean;
  /** Per-dependency probe keyed by package name. */
  deps: Record<string, HealthDep>;
  /** CUDA / GPU probe. */
  cuda: HealthCuda;
  /** Snapshot of every model's install state (mirrors /api/models entries). */
  models: ModelInfo[];
  /** The flat list the banner consumes: everything not present. */
  missing: HealthMissing[];
  /** Feature-availability summary. */
  features: HealthFeatures;
}

/** Fetch /api/health; throws ApiError on failure (caller decides fallback). */
export function getHealth(signal?: AbortSignal): Promise<HealthReport> {
  return client.get<HealthReport>('/api/health', undefined, signal);
}
