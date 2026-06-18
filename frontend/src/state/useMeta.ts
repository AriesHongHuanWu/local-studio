/* ──────────────────────────────────────────────────────────────────
   useMeta — loads + caches /api/meta for selects, chips, capability
   gating. Falls back to FALLBACK_META on failure so the UI is never
   blank offline. `online` reflects real backend connectivity.
   ────────────────────────────────────────────────────────────────── */

import { create } from 'zustand';
import { fetchMeta, FALLBACK_META } from '../api/meta';
import type { Meta } from '../api/types';

interface MetaState {
  meta: Meta;
  online: boolean; // backend reachable + meta loaded from it
  loading: boolean;
  error: string | null;
  /** Load (or reload) /api/meta; on failure keeps fallback + marks offline. */
  load: () => Promise<void>;
}

export const useMeta = create<MetaState>((set) => ({
  meta: FALLBACK_META,
  online: false,
  loading: false,
  error: null,
  load: async () => {
    set({ loading: true, error: null });
    try {
      const meta = await fetchMeta();
      set({ meta, online: true, loading: false, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      // Keep FALLBACK_META so the whole UI still renders.
      set({ online: false, loading: false, error: message });
    }
  },
}));
