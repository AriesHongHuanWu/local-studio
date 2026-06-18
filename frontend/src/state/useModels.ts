/* ──────────────────────────────────────────────────────────────────
   state/useModels.ts — Zustand store for model install state.

   Responsibilities:
     - load()            → GET /api/models, populate store
     - downloadAndTrack(id) → POST /api/models/{id}/download then poll
                              GET /api/models/jobs/{jobId} every ~800ms,
                              update per-id progress, re-load list on done
     - remove(id)        → DELETE /api/models/{id}, re-load
     - refresh()         → alias for load()

   Exposed:
     models          — full ModelInfo[]
     byKind(kind)    — filtered slice helper
     anyWhisperInstalled — boolean gate for SetupBanner
     loading         — initial list fetch in-flight
     offline         — backend unreachable flag
     perId           — Record<id, { pct, message, status }>
   ────────────────────────────────────────────────────────────────── */

import { create } from 'zustand';
import { listModels, downloadModel, getModelJob, deleteModel } from '../api/models';
import type { ModelInfo, ModelKind, ModelsResponse } from '../api/types';
import { ApiError } from '../api/client';

export interface PerIdProgress {
  pct: number;
  message: string;
  status: 'running' | 'done' | 'error';
  error?: string;
}

interface ModelsState {
  // ── data ──
  models: ModelInfo[];
  diskUsedMB: number;
  cacheDir: string;
  gpuVramTotalMB: number | null;
  // ── meta ──
  loading: boolean;
  offline: boolean;
  error: string | null;
  // ── per-id download progress ──
  perId: Record<string, PerIdProgress>;

  // ── computed helpers (not deeply reactive; use selectors) ──
  anyWhisperInstalled: boolean;

  // ── actions ──
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  downloadAndTrack: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  byKind: (kind: ModelKind) => ModelInfo[];
  /** Tear down all in-flight polling timers (call on app unmount). */
  disposeAll: () => void;
}

const POLL_MS = 800;
// Give up polling after this many consecutive failed/404 job polls so a
// backend restart (which loses in-memory MODEL_JOBS) surfaces an error row
// with a 重試 button instead of spinning forever.
const MAX_POLL_FAILURES = 5;

// Internal polling registry — kept outside Zustand to avoid serialization issues.
const _pollTimers: Record<string, ReturnType<typeof window.setInterval>> = {};

function stopPoll(id: string) {
  if (_pollTimers[id]) {
    clearInterval(_pollTimers[id]);
    delete _pollTimers[id];
  }
}

export const useModels = create<ModelsState>((set, get) => ({
  models: [],
  diskUsedMB: 0,
  cacheDir: '~/.cache/huggingface/hub',
  gpuVramTotalMB: null,
  loading: false,
  offline: false,
  error: null,
  perId: {},
  anyWhisperInstalled: false,

  // ── byKind selector ──
  byKind: (kind: ModelKind) => get().models.filter((m) => m.kind === kind),

  // ── load ──
  load: async () => {
    set({ loading: true, error: null });
    try {
      const data: ModelsResponse = await listModels();
      const anyWhisper = data.models.some((m) => m.kind === 'whisper' && m.installed);
      set({
        models: data.models,
        diskUsedMB: data.diskUsedMB,
        cacheDir: data.cacheDir,
        gpuVramTotalMB: data.gpuVramTotalMB,
        loading: false,
        offline: false,
        error: null,
        anyWhisperInstalled: anyWhisper,
      });
    } catch (err) {
      const offline = err instanceof ApiError && err.offline;
      const message = err instanceof Error ? err.message : 'unknown error';
      set({ loading: false, offline, error: message });
    }
  },

  // ── refresh (alias) ──
  refresh: async () => {
    await get().load();
  },

  // ── downloadAndTrack ──
  downloadAndTrack: async (id: string) => {
    // Guard: already downloading?
    const existing = get().perId[id];
    if (existing?.status === 'running') return;

    // Optimistic UI: mark as running immediately
    set((s) => ({
      perId: {
        ...s.perId,
        [id]: { pct: 0, message: '準備中…', status: 'running' },
      },
    }));

    let jobId: string;
    try {
      const res = await downloadModel(id);
      jobId = res.jobId;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'download failed';
      set((s) => ({
        perId: {
          ...s.perId,
          [id]: { pct: 0, message, status: 'error', error: message },
        },
      }));
      return;
    }

    // Poll job progress
    stopPoll(id);
    let failures = 0;
    _pollTimers[id] = setInterval(async () => {
      try {
        const job = await getModelJob(jobId);
        failures = 0; // a successful poll resets the failure streak
        if (job.status === 'done') {
          stopPoll(id);
          // Re-fetch the model list so installed flags are fresh, then drop
          // the per-id entry so the row cleanly shows the installed/trash UI
          // (perId is strictly for in-flight / error states).
          await get().load();
          set((s) => {
            const next = { ...s.perId };
            delete next[id];
            return { perId: next };
          });
          return;
        }
        set((s) => ({
          perId: {
            ...s.perId,
            [id]: {
              pct: job.pct,
              message: job.message,
              status: job.status,
              error: job.error,
            },
          },
        }));
        if (job.status === 'error') {
          stopPoll(id);
        }
      } catch {
        // Poll failed (transient network blip, or backend restarted and lost
        // the in-memory job). Tolerate a few, then surface an error row.
        failures += 1;
        if (failures >= MAX_POLL_FAILURES) {
          stopPoll(id);
          const message = '與後端的連線中斷，下載狀態已遺失。Lost connection to backend.';
          set((s) => ({
            perId: {
              ...s.perId,
              [id]: { pct: s.perId[id]?.pct ?? 0, message, status: 'error', error: message },
            },
          }));
        }
      }
    }, POLL_MS);
  },

  // ── remove ──
  remove: async (id: string) => {
    stopPoll(id);
    try {
      await deleteModel(id);
      await get().load();
      // Clear any stale progress entry
      set((s) => {
        const next = { ...s.perId };
        delete next[id];
        return { perId: next };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'remove failed';
      set((s) => ({
        perId: {
          ...s.perId,
          [id]: { pct: 0, message, status: 'error', error: message },
        },
      }));
    }
  },

  // ── disposeAll ──
  // Clear every in-flight polling timer. Call from an App-level unmount
  // effect so download polls don't leak past the component tree's lifetime.
  disposeAll: () => {
    for (const id of Object.keys(_pollTimers)) stopPoll(id);
  },
}));
