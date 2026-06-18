import { useEffect, useRef } from 'react';
import type { Result, Segment, Word } from '../../api/types';
import type { WordRef } from '../../state/useResultStore';
import { WordSweep } from './WordSweep';
import { wordClass } from './ConfidenceMark';

export interface LyricDocumentProps {
  result: Result;
  currentTime: number;
  flat: boolean;
  selected: WordRef | null;
  /** prefers-reduced-motion → freeze the sweep to discrete word jumps. */
  reduced?: boolean;
  onSeek: (time: number) => void;
  /** Select a word + report its on-screen rect so the inspector can anchor. */
  onSelectWord: (ref: WordRef, anchor: DOMRect) => void;
}

/** Which segment index is "active" for the given time. */
function activeSegmentIndex(segments: Segment[], t: number): number {
  for (let i = 0; i < segments.length; i++) {
    if (t >= segments[i].start && t < segments[i].end) return i;
  }
  // before first / between gaps → nearest preceding line
  let idx = 0;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].start <= t) idx = i;
  }
  return idx;
}

/** Rack-focus class: depth-of-field by distance from the active line. */
function lineClass(distance: number): string {
  const abs = Math.abs(distance);
  if (distance === 0) return 'al-doc__line al-doc__line--active';
  if (abs === 1) return 'al-doc__line al-doc__line--near';
  if (abs === 2) return 'al-doc__line al-doc__line--mid';
  return 'al-doc__line';
}

/**
 * Rack-focus editorial lyric document — the hero read/QA surface.
 * The sung line rises to 40px warm serif while neighbours fall into soft
 * focus (still clickable/seekable); the active word carries the gold sweep.
 * Up/Down arrows move the playhead line-to-line; click any word to seek+select.
 */
export function LyricDocument({
  result,
  currentTime,
  flat,
  selected,
  reduced = false,
  onSeek,
  onSelectWord,
}: LyricDocumentProps) {
  const segments = result.segments;
  const activeIdx = activeSegmentIndex(segments, currentTime);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const lastActive = useRef(-1);

  // Keep the active line centered — but only when the active index changes,
  // and scoped to the document scroll container (never yanks the whole page).
  useEffect(() => {
    if (activeIdx === lastActive.current) return;
    lastActive.current = activeIdx;
    const line = activeRef.current;
    const box = scrollRef.current;
    if (!line || !box) return;
    const lineMid = line.offsetTop + line.offsetHeight / 2;
    const target = lineMid - box.clientHeight / 2;
    box.scrollTo({ top: target, behavior: reduced ? 'auto' : 'smooth' });
  }, [activeIdx, reduced]);

  const seekLine = (delta: number) => {
    const next = Math.max(0, Math.min(segments.length - 1, activeIdx + delta));
    onSeek(segments[next].start);
  };

  return (
    <div
      ref={scrollRef}
      className={`al-doc ${flat ? 'al-doc--flat' : ''}`}
      role="listbox"
      aria-label="歌詞文件 Lyric document"
      aria-activedescendant={`al-line-${segments[activeIdx]?.id ?? 0}`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          seekLine(1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          seekLine(-1);
        }
      }}
    >
      {segments.map((seg, i) => {
        const distance = i - activeIdx;
        const isActive = i === activeIdx;
        return (
          <div
            key={seg.id}
            id={`al-line-${seg.id}`}
            ref={isActive ? activeRef : undefined}
            className={lineClass(distance)}
            role="option"
            aria-selected={isActive}
            onClick={() => onSeek(seg.start)}
          >
            {seg.words.length > 0
              ? seg.words.map((word: Word, wi: number) => {
                  const passing = currentTime >= word.start && currentTime < word.end;
                  const sung = currentTime >= word.end;
                  const isSel =
                    selected?.segId === seg.id && selected?.wordIndex === wi;
                  const selectWord = (el: HTMLElement) => {
                    onSeek(word.start);
                    onSelectWord(
                      { segId: seg.id, wordIndex: wi },
                      el.getBoundingClientRect(),
                    );
                  };
                  return (
                    <span
                      key={wi}
                      className={wordClass(word, { selected: isSel, passing, sung })}
                      role="button"
                      tabIndex={0}
                      aria-label={`${word.word} — 編輯時間 edit timing`}
                      aria-pressed={isSel}
                      onClick={(e) => {
                        e.stopPropagation();
                        selectWord(e.currentTarget);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          selectWord(e.currentTarget);
                        }
                      }}
                    >
                      {word.word}
                      {isActive && passing && (
                        <WordSweep word={word} currentTime={currentTime} discrete={reduced} />
                      )}{' '}
                    </span>
                  );
                })
              : seg.text}
          </div>
        );
      })}
    </div>
  );
}
