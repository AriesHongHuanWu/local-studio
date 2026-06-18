/* ──────────────────────────────────────────────────────────────────
   Client-side preview rendering of LRC / SRT / ASS / JSON.
   Mirrors the backend formats so the Export tab can show a faithful
   live preview BEFORE hitting /api/export. The real file still comes
   from the backend; this is "preview is proof" parity.
   ────────────────────────────────────────────────────────────────── */

import type { ExportFormat, ExportLevel, Result, Segment } from '../api/types';

export interface ExportOptions {
  level: ExportLevel; // line | word (LRC)
  precisionMs?: boolean; // true = ms precision; false = centisecond
}

const pad = (n: number, w: number) => String(Math.floor(n)).padStart(w, '0');

/* ── LRC ── [mm:ss.xx] line tags, or per-word <mm:ss.xx> enhanced tags ── */

function lrcStamp(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.round((sec - Math.floor(sec)) * 100);
  return `${pad(m, 2)}:${pad(s, 2)}.${pad(cs === 100 ? 0 : cs, 2)}`;
}

export function toLrc(result: Result, level: ExportLevel): string {
  const header = [
    `[ti:AutoLyrics]`,
    `[la:${result.language}]`,
    `[re:AutoLyrics]`,
    ``,
  ];
  const lines = result.segments.map((seg) => {
    if (level === 'word' && seg.words.length > 0) {
      const inline = seg.words
        .map((w) => `<${lrcStamp(w.start)}>${w.word}`)
        .join(' ');
      return `[${lrcStamp(seg.start)}]${inline}`;
    }
    return `[${lrcStamp(seg.start)}]${seg.text}`;
  });
  return [...header, ...lines].join('\n');
}

/* ── SRT ── numbered cues, hh:mm:ss,mmm timestamps ── */

function srtStamp(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms === 1000 ? 0 : ms, 3)}`;
}

export function toSrt(result: Result): string {
  return result.segments
    .map((seg, i) => {
      return `${i + 1}\n${srtStamp(seg.start)} --> ${srtStamp(seg.end)}\n${seg.text}`;
    })
    .join('\n\n');
}

/* ── ASS karaoke ── \k centisecond durations per word ── */

function assStamp(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.round((sec - Math.floor(sec)) * 100);
  return `${h}:${pad(m, 2)}:${pad(s, 2)}.${pad(cs === 100 ? 0 : cs, 2)}`;
}

function assKaraokeLine(seg: Segment): string {
  if (seg.words.length === 0) return seg.text;
  return seg.words
    .map((w) => {
      const durCs = Math.max(0, Math.round((w.end - w.start) * 100));
      return `{\\k${durCs}}${w.word}`;
    })
    .join('');
}

export function toAss(result: Result): string {
  const head = [
    '[Script Info]',
    'Title: AutoLyrics',
    'ScriptType: v4.00+',
    'PlayResX: 1920',
    'PlayResY: 1080',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,Source Serif 4,64,&H00EAF1F4,&H006BC3E8,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,1,2,80,80,60,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const events = result.segments.map(
    (seg) =>
      `Dialogue: 0,${assStamp(seg.start)},${assStamp(seg.end)},Default,,0,0,0,,${assKaraokeLine(seg)}`,
  );
  return [...head, ...events].join('\n');
}

/* ── JSON ── pretty-printed Result ── */

export function toJson(result: Result): string {
  return JSON.stringify(result, null, 2);
}

/* ── Dispatcher ── */

export function renderExport(
  result: Result,
  fmt: ExportFormat,
  options: ExportOptions,
): string {
  switch (fmt) {
    case 'lrc':
      return toLrc(result, options.level);
    case 'srt':
      return toSrt(result);
    case 'ass':
      return toAss(result);
    case 'json':
      return toJson(result);
    default:
      return '';
  }
}

/** Suggested filename for a format. */
export function exportFilename(fmt: ExportFormat, level: ExportLevel): string {
  const base = 'lyrics';
  if (fmt === 'lrc') return `${base}.${level}.lrc`;
  return `${base}.${fmt}`;
}
