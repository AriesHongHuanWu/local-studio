/* ──────────────────────────────────────────────────────────────────
   useMode — the top-level product mode.

   The app has three faces sharing the same 5-tab IA:
     • "song"  → Song lyrics: Demucs vocal-sep → Whisper → forced-align →
                 LRC / ASS karaoke. (the original flow, unchanged)
     • "video" → Video → Subtitles: plain speech transcription of a
                 video/audio file → clean SRT / WebVTT captions.
     • "clean" → Clean Text / 文字移除: box a burned-in text region on a
                 video; AI inpainting (LaMa) erases it every frame and
                 re-encodes an mp4 with the ORIGINAL audio preserved.

   The mode chiefly changes the Transcribe tab content + accepted input
   + export defaults; all five tabs stay available in every mode.

   Persisted to localStorage under 'al-appmode' so the choice survives a
   reload (matches the 'al-lang' pattern in useI18n). Default "song".
   ────────────────────────────────────────────────────────────────── */

import { create } from 'zustand';

export type AppMode = 'song' | 'video' | 'clean';

const STORAGE_KEY = 'al-appmode';

/** The cycle order used by toggle() (next-in-ring). */
const MODE_ORDER: AppMode[] = ['song', 'video', 'clean'];

/** localStorage 'al-appmode' ?? 'song'. */
function initialMode(): AppMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'song' || saved === 'video' || saved === 'clean') return saved;
  } catch {
    /* private mode / no storage — fall through */
  }
  return 'song';
}

interface ModeState {
  mode: AppMode;
  setMode: (m: AppMode) => void;
  /** Advance to the next mode in the ring (song → video → clean → song). */
  toggle: () => void;
}

export const useMode = create<ModeState>((set, get) => ({
  mode: initialMode(),
  setMode: (mode) => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* ignore quota / private mode */
    }
    set({ mode });
  },
  toggle: () => {
    const cur = get().mode;
    const next = MODE_ORDER[(MODE_ORDER.indexOf(cur) + 1) % MODE_ORDER.length];
    get().setMode(next);
  },
}));
