/* ──────────────────────────────────────────────────────────────────
   api/storage.ts — typed wrappers for the Storage panel endpoints.

   GET  /api/storage          → StorageBreakdown
   POST /api/models/clear-all → { clearedIds, freedMB }

   These power the Settings → Storage panel: a usage breakdown (venv +
   models + cache dir) plus the tiered-delete actions. The two "Full
   reset" tiers additionally invoke the Tauri `reset_backend` command
   (see StoragePanel) — that lives on the Rust side, not here.
   ────────────────────────────────────────────────────────────────── */

import { client } from './client';
import type { ModelKind } from './types';

/** One model's footprint, as surfaced in the storage usage breakdown. */
export interface StorageModel {
  id: string;
  label: string;
  kind: ModelKind;
  /** Bytes-on-disk in MB; 0 when not installed. */
  sizeOnDiskMB: number;
  /** Required for core use → guarded against a single delete. */
  required: boolean;
  installed: boolean;
}

/** GET /api/storage — the full disk-usage breakdown for the panel. */
export interface StorageBreakdown {
  /** Backend virtual-env size (the heavy per-install torch/etc. deps). */
  venvMB: number;
  /** Sum of every installed model's on-disk size. */
  modelsMB: number;
  /** Per-model footprint list (drives the small per-model readout). */
  models: StorageModel[];
  /** Absolute path of the user-level model cache (persists across reinstalls). */
  cacheDir: string;
  /** venv + models + work data — the grand total this panel can free. */
  totalMB: number;
}

/** Result of clearing every downloaded model. */
export interface ClearAllResult {
  clearedIds: string[];
  freedMB: number;
}

/** Fetch the storage breakdown; throws ApiError on failure (offline-aware). */
export function getStorage(signal?: AbortSignal): Promise<StorageBreakdown> {
  return client.get<StorageBreakdown>('/api/storage', undefined, signal);
}

/** Delete every downloaded model (including required ones). */
export function clearAllModels(): Promise<ClearAllResult> {
  return client.postJson<ClearAllResult>('/api/models/clear-all', {});
}
