/* ──────────────────────────────────────────────────────────────────
   Mono timecode formatting/parsing (mm:ss.mmm) + ±10 ms nudge math.
   All times are SECONDS (float), per the API contract.
   ────────────────────────────────────────────────────────────────── */

export const NUDGE_STEP = 0.01; // 10 ms

/** Clamp to non-negative finite seconds. */
function clampSec(sec: number): number {
  if (!Number.isFinite(sec) || sec < 0) return 0;
  return sec;
}

/** Format seconds → `mm:ss.mmm` (e.g. 83.4 → "01:23.400"). */
export function formatTimecode(sec: number): string {
  const s = clampSec(sec);
  const minutes = Math.floor(s / 60);
  const seconds = Math.floor(s % 60);
  const millis = Math.round((s - Math.floor(s)) * 1000);
  // guard rounding that pushes millis to 1000
  const mm = String(minutes).padStart(2, '0');
  const ss = String(millis === 1000 ? seconds + 1 : seconds).padStart(2, '0');
  const mmm = String(millis === 1000 ? 0 : millis).padStart(3, '0');
  return `${mm}:${ss}.${mmm}`;
}

/** Format seconds → `mm:ss` (transport / library, no millis). */
export function formatClock(sec: number): string {
  const s = clampSec(sec);
  const minutes = Math.floor(s / 60);
  const seconds = Math.floor(s % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Format a duration in seconds → compact `m:ss` (e.g. for word `dur`). */
export function formatDuration(sec: number): string {
  const s = clampSec(sec);
  return `${s.toFixed(3)}s`;
}

/** Parse `mm:ss.mmm` (or `ss.mmm`, or `ss`) → seconds. Returns null if invalid. */
export function parseTimecode(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  // mm:ss(.mmm)
  const colon = /^(\d{1,3}):(\d{1,2})(?:\.(\d{1,3}))?$/.exec(t);
  if (colon) {
    const min = Number(colon[1]);
    const sec = Number(colon[2]);
    const ms = colon[3] ? Number(colon[3].padEnd(3, '0')) : 0;
    if (sec >= 60) return null;
    return min * 60 + sec + ms / 1000;
  }
  // bare seconds (float)
  const bare = /^(\d+)(?:\.(\d{1,3}))?$/.exec(t);
  if (bare) {
    const sec = Number(bare[1]);
    const ms = bare[2] ? Number(bare[2].padEnd(3, '0')) : 0;
    return sec + ms / 1000;
  }
  return null;
}

/** Nudge a time by ±n steps of 10 ms; never below 0. */
export function nudge(sec: number, steps: number, step: number = NUDGE_STEP): number {
  return Math.max(0, Math.round((sec + steps * step) * 1000) / 1000);
}

/** Round seconds to the 10 ms grid. */
export function snapToGrid(sec: number, step: number = NUDGE_STEP): number {
  return Math.max(0, Math.round(sec / step) * step);
}
