/* ──────────────────────────────────────────────────────────────────
   usePinned — the user's pinned (favourite) tools, shown at the top of
   the sidebar. Persisted to localStorage under 'al-pinned-modes' so the
   choice survives a reload (matches the 'al-appmode' pattern).
   ────────────────────────────────────────────────────────────────── */

import { create } from 'zustand';
import type { AppMode } from './useMode';

const STORAGE_KEY = 'al-pinned-modes';
// Keep in sync with AppMode in useMode.ts — a mode missing here is silently un-pinnable.
const ALL: AppMode[] = ['catalog', 'song', 'video', 'clean', 'master', 'tools', 'download'];

function initialPinned(): AppMode[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.filter((m): m is AppMode => ALL.includes(m));
    }
  } catch {
    /* private mode / bad JSON — fall through */
  }
  return [];
}

interface PinnedState {
  pinned: AppMode[];
  togglePin: (m: AppMode) => void;
  isPinned: (m: AppMode) => boolean;
}

export const usePinned = create<PinnedState>((set, get) => ({
  pinned: initialPinned(),
  togglePin: (m) => {
    const cur = get().pinned;
    const next = cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore quota / private mode */
    }
    set({ pinned: next });
  },
  isPinned: (m) => get().pinned.includes(m),
}));
