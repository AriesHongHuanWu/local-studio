/* ──────────────────────────────────────────────────────────────────
   useLibrary — local run history (the API has no list endpoint, so this
   is the client-side record persisted to localStorage). Each finished
   run is appended here so the Library tab can reopen / re-export.
   ────────────────────────────────────────────────────────────────── */

import { create } from 'zustand';
import type { JobMode, Result } from '../api/types';

export interface RunRecord {
  id: string; // jobId (or a local uuid)
  title: string; // file name (sans extension)
  mode: JobMode;
  language: string;
  modelSize: string;
  engine: string;
  durationSec: number;
  createdAt: number; // epoch ms
  /** The full result so a run can be reopened in the editor offline. */
  result: Result;
}

const STORAGE_KEY = 'autolyrics.library.v1';

function load(): RunRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RunRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(runs: RunRecord[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
  } catch {
    /* quota / private mode — ignore */
  }
}

interface LibraryState {
  runs: RunRecord[];
  add: (run: RunRecord) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export const useLibrary = create<LibraryState>((set, get) => ({
  runs: load(),
  add: (run) => {
    const runs = [run, ...get().runs.filter((r) => r.id !== run.id)];
    persist(runs);
    set({ runs });
  },
  remove: (id) => {
    const runs = get().runs.filter((r) => r.id !== id);
    persist(runs);
    set({ runs });
  },
  clear: () => {
    persist([]);
    set({ runs: [] });
  },
}));
