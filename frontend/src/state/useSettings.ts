/* ──────────────────────────────────────────────────────────────────
   useSettings — local defaults (engine, device, model, language, mode,
   export format, Demucs). Persisted to localStorage; the Transcribe tab
   can seed its form from these.
   ────────────────────────────────────────────────────────────────── */

import { create } from 'zustand';
import type {
  Device,
  Engine,
  ExportFormat,
  JobMode,
  ModelSize,
} from '../api/types';

export interface Defaults {
  engine: Engine;
  device: Device;
  modelSize: ModelSize;
  language: string | null;
  mode: JobMode;
  exportFormat: ExportFormat;
  separate: boolean;
}

const STORAGE_KEY = 'autolyrics.settings.v1';

const DEFAULTS: Defaults = {
  engine: 'whisper',
  device: 'auto',
  modelSize: 'large-v3',
  language: null,
  mode: 'auto',
  exportFormat: 'lrc',
  separate: true,
};

function load(): Defaults {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Defaults>) };
  } catch {
    return DEFAULTS;
  }
}

interface SettingsState {
  defaults: Defaults;
  set: (patch: Partial<Defaults>) => void;
  reset: () => void;
}

export const useSettings = create<SettingsState>((setState, get) => ({
  defaults: load(),
  set: (patch) => {
    const defaults = { ...get().defaults, ...patch };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
    } catch {
      /* ignore */
    }
    setState({ defaults });
  },
  reset: () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setState({ defaults: DEFAULTS });
  },
}));
