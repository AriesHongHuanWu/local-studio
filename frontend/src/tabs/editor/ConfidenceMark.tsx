/* ──────────────────────────────────────────────────────────────────
   ConfidenceMark — low-confidence treatment helpers. The actual word
   span lives in LyricDocument; this module owns the threshold + class
   logic so the rule is centralized.

   The amber is strictly EVENT-DRIVEN: a low-confidence word pulses ONCE
   as the playhead passes it, then settles back to a quiet hollow outline.
   `passing` is true only on the frames the playhead is inside the word —
   LyricDocument keys a one-shot animation off the passing→edge so it
   never sits as a persistent fill (accent discipline).
   ────────────────────────────────────────────────────────────────── */

import type { Word } from '../../api/types';

/** Words below this probability get the hollow-amber treatment. */
export const LOW_CONFIDENCE = 0.55;

export function isLowConfidence(word: Word): boolean {
  return word.prob < LOW_CONFIDENCE;
}

export interface WordClassOpts {
  /** This word is the inspector selection. */
  selected: boolean;
  /** The playhead is currently inside this word. */
  passing: boolean;
  /** The playhead has already swept this word (sung) — drives quiet "done" ink. */
  sung?: boolean;
}

/**
 * Compute the className for a word span given confidence + playhead state.
 * `passing` drives the single amber pulse (one-shot, keyed in the document).
 */
export function wordClass(word: Word, opts: WordClassOpts): string {
  const low = isLowConfidence(word);
  return [
    'al-word',
    opts.selected ? 'al-word--selected' : '',
    opts.passing ? 'al-word--passing' : '',
    opts.sung ? 'al-word--sung' : '',
    low ? 'al-word--low' : '',
    low && opts.passing ? 'al-word--pulse' : '',
  ]
    .filter(Boolean)
    .join(' ');
}
