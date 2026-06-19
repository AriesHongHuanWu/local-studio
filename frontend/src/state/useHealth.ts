/* ──────────────────────────────────────────────────────────────────
   state/useHealth.ts — Zustand store for the environment health-check.

   Wraps GET /api/health. On every refresh it records the report and a
   flat `missing[]` list, split (derived) into REQUIRED vs OPTIONAL so the
   HealthBanner can:
     • auto-START repair when something REQUIRED is missing (blocks core
       use), and
     • merely WARN (manual repair) when only OPTIONAL extras are missing.

   Offline-tolerant: a network failure keeps the last good report (so the
   banner doesn't flicker) and flips `online=false`. We never throw to the
   UI — the existing StatusStrip already surfaces offline state separately.

   This store does NOT perform downloads itself — the HealthBanner reuses
   useModels.downloadAndTrack (models) and useSetup.runSetup (deps/venv).
   ────────────────────────────────────────────────────────────────── */

import { create } from 'zustand';
import { getHealth } from '../api/health';
import type { HealthReport, HealthMissing } from '../api/health';

interface HealthState {
  // ── data ──
  /** Last successful report, or null before the first successful load. */
  report: HealthReport | null;
  /** Flat missing list from the last report (empty when healthy/unknown). */
  missing: HealthMissing[];
  /** True when nothing required is missing (false until first load). */
  healthy: boolean;

  // ── meta ──
  /** Backend reachable on the last refresh. */
  online: boolean;
  /** A refresh is in flight. */
  loading: boolean;
  /** Last error message (network or HTTP), or null. */
  error: string | null;
  /** True once at least one refresh has completed (success OR failure). */
  loaded: boolean;

  // ── actions ──
  /** Fetch /api/health; tolerate offline (keeps prior report, online=false). */
  refresh: () => Promise<void>;
}

export const useHealth = create<HealthState>((set) => ({
  report: null,
  missing: [],
  healthy: false,
  online: false,
  loading: false,
  error: null,
  loaded: false,

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const report = await getHealth();
      set({
        report,
        missing: report.missing ?? [],
        healthy: report.healthy,
        online: true,
        loading: false,
        error: null,
        loaded: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      // Keep the prior report so a transient blip doesn't clear the banner;
      // just mark offline. (StatusStrip independently shows offline chrome.)
      // Both a network failure and a non-2xx response leave us "not online".
      set({ online: false, loading: false, error: message, loaded: true });
    }
  },
}));

/* ── Derived selectors (pure; keep components from re-deriving) ──────── */

/** Missing items that block core use → drive auto-repair. */
export function selectMissingRequired(s: HealthState): HealthMissing[] {
  return s.missing.filter((m) => m.required);
}

/** Missing OPTIONAL extras → warn only, manual repair. */
export function selectMissingOptional(s: HealthState): HealthMissing[] {
  return s.missing.filter((m) => !m.required);
}

/** Only the missing MODELS (downloaded via useModels.downloadAndTrack). */
export function selectMissingModels(s: HealthState): HealthMissing[] {
  return s.missing.filter((m) => m.category === 'model');
}

/** Only the missing DEPS (healed via useSetup.runSetup, which skips installed). */
export function selectMissingDeps(s: HealthState): HealthMissing[] {
  return s.missing.filter((m) => m.category === 'dep');
}
