/* ──────────────────────────────────────────────────────────────────
   runMeta — tab-local presentation helpers for the Library tab.
   (No shared module owns these; they're purely display formatting so
   they live with the tab that consumes them.)
   ────────────────────────────────────────────────────────────────── */

import type { JobMode } from '../../api/types';

/** Plain-language mode labels (matches the Transcribe mode cards). */
export const MODE_LABEL: Record<JobMode, string> = {
  auto: 'Auto',
  biasing: 'Biasing',
  align: 'Forced-Align',
};

/**
 * Whisper language codes → a friendly bilingual label. Falls back to the
 * raw code (upper-cased) so an unexpected code never renders blank.
 */
const LANGUAGE_LABEL: Record<string, string> = {
  zh: '中文國語',
  yue: '粵語',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  multi: '多語',
  auto: '自動',
};

export function languageLabel(code: string): string {
  if (!code) return '—';
  return LANGUAGE_LABEL[code] ?? code.toUpperCase();
}

/** Absolute timestamp: 2026-06-18 14:32 — mono, sortable-looking. */
export function formatRunDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes(),
  )}`;
}

/** Human relative time ("剛剛 · just now", "3 小時前 · 3h"), for the row tooltip. */
export function relativeRunDate(ms: number, now = Date.now()): string {
  const sec = Math.max(0, Math.round((now - ms) / 1000));
  if (sec < 45) return '剛剛 · just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} 分鐘前 · ${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} 小時前 · ${hr}h`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} 天前 · ${day}d`;
  return formatRunDate(ms);
}
