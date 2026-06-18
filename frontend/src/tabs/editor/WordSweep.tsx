import type { Word } from '../../api/types';

export interface WordSweepProps {
  word: Word;
  /** Audio currentTime in seconds. */
  currentTime: number;
  /**
   * When true (prefers-reduced-motion), the sweep snaps to a full underline
   * the moment the word begins instead of growing linearly — no animation.
   */
  discrete?: boolean;
}

/**
 * Gold word-sweep underline bound to currentTime / \k duration.
 * Width is a 0..100% function of how far the playhead is through the word —
 * `linear`, driven by audio `currentTime`, so it stays sample-accurate and
 * never drifts. This is the karaoke `\k` sweep on real book-type.
 */
export function WordSweep({ word, currentTime, discrete = false }: WordSweepProps) {
  const dur = Math.max(0.001, word.end - word.start);
  const raw = (currentTime - word.start) / dur;
  const progress = Math.max(0, Math.min(1, raw));
  if (progress <= 0) return null;
  const width = discrete ? 100 : progress * 100;
  return (
    <span className="al-word__sweep" style={{ width: `${width}%` }} aria-hidden="true">
      <span className="al-word__sweep-edge" />
    </span>
  );
}
