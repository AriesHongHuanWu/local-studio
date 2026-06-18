/* ──────────────────────────────────────────────────────────────────
   useResultStore — holds the editable Result; applies word text/timing
   edits with adjacent-boundary follow (never opens a gap); dirty tracking
   so Export knows to use POST /api/export vs GET …/export.
   ────────────────────────────────────────────────────────────────── */

import { create } from 'zustand';
import type { Result, Segment, Word } from '../api/types';

/** Address a single word within the result. */
export interface WordRef {
  segId: number;
  wordIndex: number;
}

interface ResultState {
  result: Result | null;
  /** The pristine, server-provided result (for original export + dirty diff). */
  original: Result | null;
  dirty: boolean;
  /** Currently selected word (drives the inspector). */
  selected: WordRef | null;

  load: (result: Result) => void;
  clear: () => void;
  select: (ref: WordRef | null) => void;

  /** Edit a word's text. */
  editWordText: (ref: WordRef, text: string) => void;
  /** Set a word's start; the previous word's end follows so no gap opens. */
  setWordStart: (ref: WordRef, start: number) => void;
  /** Set a word's end; the next word's start follows so no gap opens. */
  setWordEnd: (ref: WordRef, end: number) => void;
  /** Mark a low-confidence word as confirmed (prob → 1). */
  confirmWord: (ref: WordRef) => void;
  /** Edit a whole line's text. */
  editSegmentText: (segId: number, text: string) => void;
}

function findSeg(result: Result, segId: number): Segment | undefined {
  return result.segments.find((s) => s.id === segId);
}

/** Recompute a segment's start/end + text from its words. */
function reflowSegment(seg: Segment): void {
  if (seg.words.length > 0) {
    seg.start = seg.words[0].start;
    seg.end = seg.words[seg.words.length - 1].end;
  }
}

/** Deep-ish clone so React sees a new reference + we never mutate original. */
function cloneResult(r: Result): Result {
  return {
    ...r,
    segments: r.segments.map((s) => ({
      ...s,
      words: s.words.map((w) => ({ ...w })),
    })),
    meta: { ...r.meta },
  };
}

export const useResultStore = create<ResultState>((set, get) => ({
  result: null,
  original: null,
  dirty: false,
  selected: null,

  load: (result) =>
    set({
      result: cloneResult(result),
      original: cloneResult(result),
      dirty: false,
      selected: null,
    }),

  clear: () => set({ result: null, original: null, dirty: false, selected: null }),

  select: (ref) => set({ selected: ref }),

  editWordText: (ref, text) => {
    const cur = get().result;
    if (!cur) return;
    const next = cloneResult(cur);
    const seg = findSeg(next, ref.segId);
    const word = seg?.words[ref.wordIndex];
    if (!seg || !word) return;
    word.word = text;
    seg.text = rebuildSegText(seg);
    set({ result: next, dirty: true });
  },

  setWordStart: (ref, start) => {
    const cur = get().result;
    if (!cur) return;
    const next = cloneResult(cur);
    const seg = findSeg(next, ref.segId);
    const word = seg?.words[ref.wordIndex];
    if (!seg || !word) return;
    const clamped = Math.max(0, Math.min(start, word.end - 0.01));
    word.start = clamped;
    // adjacent-word follow: previous word's end tracks this start (no gap)
    if (ref.wordIndex > 0) {
      seg.words[ref.wordIndex - 1].end = clamped;
    }
    reflowSegment(seg);
    set({ result: next, dirty: true });
  },

  setWordEnd: (ref, end) => {
    const cur = get().result;
    if (!cur) return;
    const next = cloneResult(cur);
    const seg = findSeg(next, ref.segId);
    const word = seg?.words[ref.wordIndex];
    if (!seg || !word) return;
    const clamped = Math.max(word.start + 0.01, end);
    word.end = clamped;
    // adjacent-word follow: next word's start tracks this end (no gap)
    if (ref.wordIndex < seg.words.length - 1) {
      seg.words[ref.wordIndex + 1].start = clamped;
    }
    reflowSegment(seg);
    set({ result: next, dirty: true });
  },

  confirmWord: (ref) => {
    const cur = get().result;
    if (!cur) return;
    const next = cloneResult(cur);
    const word = findSeg(next, ref.segId)?.words[ref.wordIndex];
    if (!word) return;
    word.prob = 1;
    set({ result: next, dirty: true });
  },

  editSegmentText: (segId, text) => {
    const cur = get().result;
    if (!cur) return;
    const next = cloneResult(cur);
    const seg = findSeg(next, segId);
    if (!seg) return;
    seg.text = text;
    set({ result: next, dirty: true });
  },
}));

/** Rebuild a segment's display text from its words (space-join for Latin). */
function rebuildSegText(seg: Segment): string {
  const hasSpaces = seg.words.some((w: Word) => / /.test(w.word));
  const join = hasSpaces ? ' ' : '';
  return seg.words
    .map((w) => w.word.trim())
    .filter(Boolean)
    .join(join);
}
