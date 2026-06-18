/* ──────────────────────────────────────────────────────────────────
   useAudio — HTML5 <audio> controller. Owns a single HTMLAudioElement,
   exposes currentTime / play / pause / seek / loop-region. currentTime
   is published via rAF so the WordSweep can bind to it sample-accurately.
   ────────────────────────────────────────────────────────────────── */

import { create } from 'zustand';

interface LoopRegion {
  start: number;
  end: number;
}

interface AudioState {
  src: string | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  loop: LoopRegion | null;

  /** Point the element at a new object URL (replaces previous src). */
  setSrc: (src: string | null) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** Seek to an absolute time in seconds. */
  seek: (time: number) => void;
  /** Relative seek (e.g. ±5 s transport). */
  skip: (delta: number) => void;
  setLoop: (region: LoopRegion | null) => void;
}

/** The single audio element, created lazily (SSR-safe-ish guard). */
let el: HTMLAudioElement | null = null;
let rafId: number | null = null;

function getEl(): HTMLAudioElement {
  if (!el) {
    el = typeof Audio !== 'undefined' ? new Audio() : ({} as HTMLAudioElement);
    el.preload = 'auto';
  }
  return el;
}

export const useAudio = create<AudioState>((set, get) => {
  const audio = getEl();

  const tick = () => {
    const a = getEl();
    const t = a.currentTime || 0;
    const loop = get().loop;
    if (loop && t >= loop.end) {
      a.currentTime = loop.start;
    }
    set({ currentTime: a.currentTime || 0 });
    if (get().playing) rafId = requestAnimationFrame(tick);
  };

  // Wire native events once.
  if (typeof audio.addEventListener === 'function') {
    audio.addEventListener('loadedmetadata', () => {
      set({ duration: Number.isFinite(audio.duration) ? audio.duration : 0 });
    });
    audio.addEventListener('play', () => {
      set({ playing: true });
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(tick);
    });
    audio.addEventListener('pause', () => {
      set({ playing: false });
      if (rafId) cancelAnimationFrame(rafId);
    });
    audio.addEventListener('ended', () => {
      set({ playing: false, currentTime: audio.duration || 0 });
    });
    audio.addEventListener('seeked', () => {
      set({ currentTime: audio.currentTime || 0 });
    });
  }

  return {
    src: null,
    playing: false,
    currentTime: 0,
    duration: 0,
    loop: null,

    setSrc: (src) => {
      const a = getEl();
      a.pause();
      a.src = src ?? '';
      if (src) a.load();
      set({ src, playing: false, currentTime: 0, duration: 0 });
    },
    play: () => {
      const a = getEl();
      void a.play?.();
    },
    pause: () => {
      getEl().pause?.();
    },
    toggle: () => {
      const a = getEl();
      if (a.paused) void a.play?.();
      else a.pause?.();
    },
    seek: (time) => {
      const a = getEl();
      const clamped = Math.max(0, Math.min(time, a.duration || time));
      a.currentTime = clamped;
      set({ currentTime: clamped });
    },
    skip: (delta) => {
      const a = getEl();
      const next = Math.max(0, Math.min((a.currentTime || 0) + delta, a.duration || Infinity));
      a.currentTime = next;
      set({ currentTime: next });
    },
    setLoop: (region) => set({ loop: region }),
  };
});
