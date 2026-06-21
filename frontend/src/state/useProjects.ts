/* ──────────────────────────────────────────────────────────────────
   useProjects — the Catalog backbone. One song = one Project that
   collects its artifacts (the downloaded beat, its analysis headline,
   masters, processed vocals…), so the app reads as "my songs" instead
   of scattered one-off jobs. Persisted to localStorage ('al-projects').

   v1 is a frontend-first organizational layer: items reference on-disk
   paths (Tauri) / metadata, not heavy blobs. The journey-rail IA and
   cross-mode continuity build on top of this in later increments.
   ────────────────────────────────────────────────────────────────── */

import { create } from 'zustand';

export type ProjectItemKind = 'beat' | 'analysis' | 'master' | 'vocal' | 'note';

export interface ProjectItem {
  id: string;
  kind: ProjectItemKind;
  label: string;
  ts: number;
  path?: string;        // absolute disk path (Tauri) — enables reveal/drag
  format?: string;      // ext
  sizeBytes?: number;
  /** lightweight analysis snapshot for headline display */
  key?: string;
  bpm?: number;
  genre?: string;
}

export interface Project {
  id: string;
  name: string;
  createdTs: number;
  updatedTs: number;
  /** headline (from the first analysis added) */
  key?: string;
  bpm?: number;
  genre?: string;
  items: ProjectItem[];
}

const STORAGE_KEY = 'al-projects';
const MAX = 200;

function load(): Project[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr as Project[];
    }
  } catch { /* private mode / bad JSON */ }
  return [];
}
function persist(projects: Project[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(projects.slice(0, MAX))); } catch { /* */ }
}
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

interface State {
  projects: Project[];
  create: (name: string) => Project;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  addItem: (projectId: string, item: Omit<ProjectItem, 'id' | 'ts'>) => void;
  removeItem: (projectId: string, itemId: string) => void;
}

export const useProjects = create<State>((set, get) => ({
  projects: load(),
  create: (name) => {
    const now = Date.now();
    const p: Project = { id: uid('proj'), name: name.trim() || 'Untitled', createdTs: now, updatedTs: now, items: [] };
    const next = [p, ...get().projects].slice(0, MAX);
    persist(next); set({ projects: next });
    return p;
  },
  rename: (id, name) => {
    const next = get().projects.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name, updatedTs: Date.now() } : p));
    persist(next); set({ projects: next });
  },
  remove: (id) => {
    const next = get().projects.filter((p) => p.id !== id);
    persist(next); set({ projects: next });
  },
  addItem: (projectId, item) => {
    const entry: ProjectItem = { ...item, id: uid('it'), ts: Date.now() };
    const next = get().projects.map((p) => {
      if (p.id !== projectId) return p;
      // promote the first analysis's key/bpm/genre to the project headline
      const headline = (item.kind === 'analysis' || item.kind === 'beat')
        ? { key: p.key ?? item.key, bpm: p.bpm ?? item.bpm, genre: p.genre ?? item.genre }
        : {};
      return { ...p, ...headline, items: [entry, ...p.items], updatedTs: Date.now() };
    });
    persist(next); set({ projects: next });
  },
  removeItem: (projectId, itemId) => {
    const next = get().projects.map((p) =>
      p.id === projectId ? { ...p, items: p.items.filter((it) => it.id !== itemId), updatedTs: Date.now() } : p);
    persist(next); set({ projects: next });
  },
}));
