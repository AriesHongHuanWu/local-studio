import { useMemo } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { ExportFormat, ExportLevel, Result, Segment } from '../../api/types';
import { renderExport } from '../../lib/exporters';
import type { AssSweepStyle } from './exportOptions';

export interface LivePreviewProps {
  result: Result;
  fmt: ExportFormat;
  level: ExportLevel;
  precisionMs: boolean;
  assSweep: AssSweepStyle;
  /** Drives the verifiable ASS \k sweep against playback. */
  currentTime: number;
}

/* ── precision refinement ──────────────────────────────────────────
   renderExport emits native precision (centisecond for LRC/ASS,
   millisecond for SRT). The Export tab lets the user preview at 1 ms
   or 10 ms; we refine the rendered stamps here without re-implementing
   the formats, and we NEVER touch \k integer durations. */

function refineStamp(intPart: string, frac: string, ms: boolean): string {
  // frac is whatever digits followed the separator (cs=2, ms=3, etc.)
  const padded = (frac + '000').slice(0, 3);
  const millis = Number(padded);
  if (ms) return `${intPart}.${padded}`;
  // centisecond: round to 10 ms
  const cs = Math.round(millis / 10);
  const ccc = String(cs === 100 ? 0 : cs).padStart(2, '0');
  return `${intPart}.${ccc}`;
}

function applyPrecision(text: string, fmt: ExportFormat, ms: boolean): string {
  if (fmt === 'json') return text;
  // LRC line tag [mm:ss.xx] and enhanced word tag <mm:ss.xx>
  if (fmt === 'lrc') {
    return text.replace(
      /([[<])(\d{2}:\d{2})\.(\d{2,3})([\]>])/g,
      (_m, open, mmss, frac, close) =>
        `${open}${refineStamp(mmss, frac, ms)}${close}`,
    );
  }
  // SRT hh:mm:ss,mmm --> hh:mm:ss,mmm  (comma separator)
  if (fmt === 'srt') {
    return text.replace(
      /(\d{2}:\d{2}:\d{2}),(\d{2,3})/g,
      (_m, hms, frac) => {
        const refined = refineStamp(hms, frac, ms);
        return refined.replace('.', ',');
      },
    );
  }
  // ASS Dialogue Start/End h:mm:ss.xx  (only the leading timestamps, not \k)
  if (fmt === 'ass') {
    return text.replace(
      /(\d:\d{2}:\d{2})\.(\d{2,3})/g,
      (_m, hms, frac) => refineStamp(hms, frac, ms),
    );
  }
  return text;
}

/* ── ASS karaoke sweep model ───────────────────────────────────────
   For the active dialogue line, derive each word's [start,end] from
   its \k centiseconds accumulated from the segment start, then map
   currentTime → a 0..1 progress for the syllable being sung. */

interface AssWord {
  text: string;
  start: number;
  end: number;
}

function assWordsFor(seg: Segment): AssWord[] {
  if (seg.words.length === 0) {
    return [{ text: seg.text, start: seg.start, end: seg.end }];
  }
  // mirror exporters.assKaraokeLine: durations are quantised to cs
  let t = seg.start;
  return seg.words.map((w) => {
    const durCs = Math.max(0, Math.round((w.end - w.start) * 100));
    const start = t;
    const end = t + durCs / 100;
    t = end;
    return { text: w.word, start, end };
  });
}

interface SweepPart {
  text: string;
  /** 0 = not yet sung, 1 = fully sung, fractional = mid-sweep. */
  progress: number;
}

function sweepParts(seg: Segment, currentTime: number): SweepPart[] {
  return assWordsFor(seg).map((w) => {
    if (currentTime >= w.end) return { text: w.text, progress: 1 };
    if (currentTime <= w.start) return { text: w.text, progress: 0 };
    const span = Math.max(1e-3, w.end - w.start);
    return { text: w.text, progress: (currentTime - w.start) / span };
  });
}

/** Inline style for one syllable given its sweep progress + style. */
function sylStyle(progress: number, style: AssSweepStyle): CSSProperties {
  // Fully sung → solid gold chip with paper-coloured ink.
  if (progress >= 1) {
    return { background: 'var(--al-gold)', color: 'var(--al-bg)' };
  }
  // Not yet reached → quiet, awaiting.
  if (progress <= 0) return {};
  // Mid-sweep.
  const pct = Math.round(progress * 100);
  if (style === 'fill') {
    return { background: 'var(--al-gold)', color: 'var(--al-bg)' };
  }
  if (style === 'wipe') {
    return {
      backgroundImage: `linear-gradient(90deg, var(--al-gold) ${pct}%, transparent ${pct}%)`,
      color: 'var(--al-gold-soft)',
    };
  }
  // gradient: soft leading edge
  const lead = Math.min(100, pct + 8);
  return {
    backgroundImage: `linear-gradient(90deg, var(--al-gold) ${pct}%, var(--al-gold-soft) ${lead}%, transparent ${lead}%)`,
    color: 'var(--al-gold-soft)',
  };
}

/**
 * Live monospace preview of the ACTUAL file text. For ASS, the active
 * dialogue line replays its \k karaoke sweep against currentTime so the
 * file you save is the file you just watched — preview is proof.
 */
export function LivePreview({
  result,
  fmt,
  level,
  precisionMs,
  assSweep,
  currentTime,
}: LivePreviewProps) {
  const text = useMemo(() => {
    const raw = renderExport(result, fmt, { level, precisionMs });
    return applyPrecision(raw, fmt, precisionMs);
  }, [result, fmt, level, precisionMs]);

  const lines = useMemo(() => text.split('\n'), [text]);

  // Active ASS dialogue: which segment is currently playing.
  const activeSegIndex = useMemo(() => {
    if (fmt !== 'ass') return -1;
    return result.segments.findIndex(
      (s) => currentTime >= s.start && currentTime < s.end,
    );
  }, [fmt, result.segments, currentTime]);

  // Map preview line index → segment index, counting Dialogue lines.
  const dialogueSegOfLine = useMemo(() => {
    const map = new Map<number, number>();
    if (fmt !== 'ass') return map;
    let d = 0;
    lines.forEach((line, i) => {
      if (line.startsWith('Dialogue:')) {
        map.set(i, d);
        d++;
      }
    });
    return map;
  }, [fmt, lines]);

  const gutterWidth = String(lines.length).length;

  return (
    <div className="al-preview" role="figure" aria-label="檔案預覽 File preview">
      <pre className="al-preview__code">
        {lines.map((line, i) => {
          const num = String(i + 1).padStart(gutterWidth, ' ');
          const segIdx = dialogueSegOfLine.get(i);
          const isActiveDialogue =
            segIdx !== undefined && segIdx === activeSegIndex;

          let content: ReactNode = line;

          if (isActiveDialogue && segIdx !== undefined) {
            content = (
              <SweepLine
                line={line}
                seg={result.segments[segIdx]}
                currentTime={currentTime}
                style={assSweep}
              />
            );
          } else {
            const isStamp =
              /^\[\d{2}:\d{2}/.test(line) ||
              /-->/.test(line) ||
              /^<\d{2}:\d{2}/.test(line);
            content = isStamp ? (
              <StampLine line={line} fmt={fmt} />
            ) : (
              line
            );
          }

          return (
            <span
              key={i}
              className={`al-preview__line${
                isActiveDialogue ? ' al-preview__line--active' : ''
              }`}
            >
              <span className="al-preview__gutter" aria-hidden="true">
                {num}
              </span>
              <span className="al-preview__text">{content}</span>
              {'\n'}
            </span>
          );
        })}
      </pre>
    </div>
  );
}

/* Colourise the timestamp portion of a non-active line in gold. */
function StampLine({ line, fmt }: { line: string; fmt: ExportFormat }) {
  if (fmt === 'srt') {
    const m = /^(.*?)(\s-->\s)(.*)$/.exec(line);
    if (m) {
      return (
        <>
          <span className="al-preview__stamp">{m[1]}</span>
          <span className="al-preview__arrow">{m[2]}</span>
          <span className="al-preview__stamp">{m[3]}</span>
        </>
      );
    }
  }
  if (fmt === 'lrc') {
    // [mm:ss.xx] head + optional inline <..> word tags
    const parts = line.split(/(\[[^\]]+\]|<[^>]+>)/g);
    return (
      <>
        {parts.map((p, i) =>
          /^[[<]/.test(p) ? (
            <span key={i} className="al-preview__stamp">
              {p}
            </span>
          ) : (
            <span key={i}>{p}</span>
          ),
        )}
      </>
    );
  }
  return <span className="al-preview__stamp">{line}</span>;
}

/* The active ASS dialogue line, with its text replaced by a live \k sweep. */
function SweepLine({
  line,
  seg,
  currentTime,
  style,
}: {
  line: string;
  seg: Segment;
  currentTime: number;
  style: AssSweepStyle;
}) {
  // Keep the "Dialogue:" field prefix in dim stamp ink; replace the text
  // payload with the live karaoke sweep derived from the segment words.
  const prefix = dialoguePrefix(line);
  const parts = sweepParts(seg, currentTime);

  return (
    <>
      <span className="al-preview__stamp">{prefix}</span>
      <span className="al-preview__karaoke">
        {parts.map((p, i) => (
          <span
            key={i}
            className="al-preview__syl"
            style={sylStyle(p.progress, style)}
            data-sung={p.progress >= 1 ? 'true' : undefined}
          >
            {p.text}
          </span>
        ))}
      </span>
    </>
  );
}

/** The "Dialogue:" line up to and including the 9th comma (before Text). */
function dialoguePrefix(line: string): string {
  let commas = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === ',') {
      commas++;
      if (commas === 9) return line.slice(0, i + 1);
    }
  }
  return line;
}
