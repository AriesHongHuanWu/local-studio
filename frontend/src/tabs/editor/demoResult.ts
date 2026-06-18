/* ──────────────────────────────────────────────────────────────────
   Tab-local demo Result. The Editor is the hero surface, so it must be
   fully visible / designable even with the backend down and no real run.
   When `useResultStore` is empty we render this synthetic document
   (flagged `isDemo`) so every interaction — sweep, rack-focus, amber
   confidence, inspector, transport — is exercisable offline.

   NOTE: shared modules expose no demo fixture, so this lives tab-local
   per the build rules (don't edit shared files). It never overwrites a
   real result; EditorTab only falls back to it when the store is null.
   ────────────────────────────────────────────────────────────────── */

import type { Result, Segment, Word } from '../../api/types';

/** Build a word with start/dur (seconds) + confidence. */
function w(word: string, start: number, dur: number, prob = 0.98): Word {
  return { word, start, end: Math.round((start + dur) * 1000) / 1000, prob };
}

/** Assemble a segment from a list of words (id, derived start/end/text). */
function seg(id: number, words: Word[]): Segment {
  const hasSpaces = words.some((x) => / /.test(x.word));
  const join = hasSpaces ? ' ' : '';
  return {
    id,
    start: words[0]?.start ?? 0,
    end: words[words.length - 1]?.end ?? 0,
    text: words.map((x) => x.word.trim()).filter(Boolean).join(join),
    words,
  };
}

/* A short, multilingual mock — Latin + CJK lines so rack-focus + CJK
   headroom both read. A couple of words sit below LOW_CONFIDENCE (0.55)
   to demonstrate the hollow-amber pulse. */
const segments: Segment[] = [
  seg(0, [
    w('Drop', 0.42, 0.34),
    w('a', 0.78, 0.12),
    w('song', 0.92, 0.46),
    w('—', 1.4, 0.1, 0.71),
    w('it', 1.52, 0.16),
    w('becomes', 1.7, 0.5),
    w('a', 2.22, 0.12),
    w('page', 2.36, 0.62),
  ]),
  seg(1, [
    w('每', 4.1, 0.3),
    w('一', 4.4, 0.3),
    w('個', 4.7, 0.3),
    w('字', 5.0, 0.34, 0.41),
    w('都', 5.36, 0.3),
    w('有', 5.66, 0.3),
    w('時', 5.96, 0.32),
    w('間', 6.28, 0.4),
  ]),
  seg(2, [
    w('The', 8.2, 0.22),
    w('lyric', 8.44, 0.42),
    w('plays', 8.9, 0.4),
    w('itself', 9.32, 0.56, 0.49),
  ]),
  seg(3, [
    w('一', 11.6, 0.3),
    w('道', 11.9, 0.32),
    w('金', 12.24, 0.32),
    w('色', 12.58, 0.32),
    w('的', 12.92, 0.24),
    w('光', 13.18, 0.46),
  ]),
  seg(4, [
    w('sweeps', 15.0, 0.5),
    w('each', 15.54, 0.34),
    w('word', 15.9, 0.42),
    w('in', 16.34, 0.16),
    w('sync', 16.54, 0.6),
  ]),
  seg(5, [
    w('Grab', 18.4, 0.4),
    w('a', 18.84, 0.12),
    w('word', 18.98, 0.42),
    w('to', 19.42, 0.16),
    w('retime', 19.6, 0.58, 0.38),
    w('it', 20.2, 0.3),
  ]),
];

export const DEMO_RESULT: Result = {
  language: 'multi',
  modeUsed: 'align',
  segments,
  meta: {
    modelSize: 'large-v3',
    separated: true,
    durationSec: 21.5,
    engine: 'whisper',
  },
};
