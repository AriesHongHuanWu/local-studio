/* ──────────────────────────────────────────────────────────────────
   Tab-local export helpers. The shared lib/exporters.renderExport only
   takes { level, precisionMs }; the Export tab adds two extra surfaces
   the design calls for — timestamp precision is already covered, but
   ASS sweep STYLE and file ENCODING are not. Rather than touch the
   shared exporter (forbidden), we keep these as a tab-local concern:
   the ASS sweep style only affects the in-tab preview animation, and
   the encoding only affects how we serialize the Blob for save.

   Anything that changes the actual file BYTES (encoding BOM) is applied
   here at the point of download; anything purely visual (sweep style)
   is consumed by the LivePreview component.
   ────────────────────────────────────────────────────────────────── */

import type { ExportFormat, ExportLevel } from '../../api/types';

/** How the ASS \k sweep is visualised in the live preview proof. */
export type AssSweepStyle = 'gradient' | 'wipe' | 'fill';

/** Output text encoding for the saved file. */
export type Encoding = 'utf-8' | 'utf-8-bom';

/** The full, tab-owned export option set. */
export interface ExportConfig {
  fmt: ExportFormat;
  level: ExportLevel;
  /** true = millisecond precision; false = centisecond (LRC/ASS native). */
  precisionMs: boolean;
  /** Visual sweep style for the ASS karaoke proof preview. */
  assSweep: AssSweepStyle;
  /** Byte encoding applied at save time. */
  encoding: Encoding;
}

export const DEFAULT_CONFIG: ExportConfig = {
  fmt: 'lrc',
  level: 'line',
  precisionMs: false,
  assSweep: 'gradient',
  encoding: 'utf-8',
};

const BOM = '﻿';

/** Prepend a UTF-8 BOM when the encoding asks for it. */
export function applyEncoding(text: string, encoding: Encoding): string {
  if (encoding === 'utf-8-bom') {
    return text.startsWith(BOM) ? text : BOM + text;
  }
  return text;
}

/** A real text/* MIME with charset, for the saved Blob. */
export function mimeFor(fmt: ExportFormat): string {
  if (fmt === 'json') return 'application/json;charset=utf-8';
  return 'text/plain;charset=utf-8';
}

/** Which option groups are meaningful for a given format. */
export interface FormatCapabilities {
  level: boolean; // LRC line vs word
  precision: boolean; // LRC / SRT / ASS show a precision toggle
  sweep: boolean; // only ASS animates a \k sweep
  encoding: boolean; // text formats; JSON too (still text)
}

export function capabilitiesFor(fmt: ExportFormat): FormatCapabilities {
  switch (fmt) {
    case 'lrc':
      return { level: true, precision: true, sweep: false, encoding: true };
    case 'srt':
      return { level: false, precision: true, sweep: false, encoding: true };
    case 'ass':
      return { level: false, precision: true, sweep: true, encoding: true };
    case 'json':
      return { level: false, precision: false, sweep: false, encoding: true };
    default:
      return { level: false, precision: false, sweep: false, encoding: true };
  }
}
