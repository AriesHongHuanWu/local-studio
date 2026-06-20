/* ──────────────────────────────────────────────────────────────────
   useMeta — loads + caches /api/meta for selects, chips, capability
   gating. Falls back to FALLBACK_META on failure so the UI is never
   blank offline. `online` reflects real backend connectivity.

   Startup states (for a calm boot, no scary "OFFLINE" during warm-up):
     connecting  — a reconnect loop is in progress and we're not online yet
                   (the engine is still binding the port / importing torch).
     everOnline  — we have connected at least once this session.
     bootFailed  — the reconnect deadline passed without ever connecting
                   (likely a genuinely broken/incomplete engine → offer repair).
   ────────────────────────────────────────────────────────────────── */

import { create } from 'zustand';
import { fetchMeta, FALLBACK_META } from '../api/meta';
import type { Meta } from '../api/types';

interface MetaState {
  meta: Meta;
  online: boolean; // backend reachable + meta loaded from it
  loading: boolean;
  error: string | null;
  everOnline: boolean;
  connecting: boolean;
  bootFailed: boolean;
  /** Load (or reload) /api/meta; on failure keeps fallback + marks offline. */
  load: () => Promise<void>;
  /** Drive the boot/reconnect UI state (called by the App reconnect loop). */
  setConnecting: (v: boolean) => void;
  setBootFailed: (v: boolean) => void;
}

export const useMeta = create<MetaState>((set) => ({
  meta: FALLBACK_META,
  online: false,
  loading: false,
  error: null,
  everOnline: false,
  connecting: false,
  bootFailed: false,
  load: async () => {
    set({ loading: true, error: null });
    try {
      const meta = await fetchMeta();
      // First successful contact clears every "still starting / failed" flag.
      set({ meta, online: true, loading: false, error: null, everOnline: true, connecting: false, bootFailed: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      // Keep FALLBACK_META so the whole UI still renders.
      set({ online: false, loading: false, error: message });
    }
  },
  setConnecting: (v) => set({ connecting: v }),
  setBootFailed: (v) => set({ bootFailed: v }),
}));
