/* ──────────────────────────────────────────────────────────────────
   Tab-local save-to-disk helper. Prefers the Tauri dialog + fs APIs
   when running inside the desktop shell (Phase 3); falls back to a
   browser <a download> otherwise.

   IMPORTANT (Tauri v2): plugin guest-JS bindings (dialog/fs) are NOT
   attached to window.__TAURI__ by `withGlobalTauri` — that only exposes
   the CORE API. The plugin functions ship in their own npm packages
   (@tauri-apps/plugin-dialog, @tauri-apps/plugin-fs) and MUST be
   imported in JS. We therefore import them statically and feature-detect
   "are we in Tauri" via the reliable `__TAURI_INTERNALS__` global
   (present iff running inside the Tauri webview). In a plain browser the
   imports load harmlessly but are never called.
   ────────────────────────────────────────────────────────────────── */

import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import type { ExportFormat } from '../../api/types';

interface TauriInternalsWindow {
  __TAURI_INTERNALS__?: unknown;
}

/** True when running inside the Tauri webview (v2 reliable signal). */
export function hasTauri(): boolean {
  const w = window as unknown as TauriInternalsWindow;
  return '__TAURI_INTERNALS__' in w && w.__TAURI_INTERNALS__ != null;
}

const EXT_FILTER: Record<ExportFormat, { name: string; extensions: string[] }> = {
  lrc: { name: 'LRC lyrics', extensions: ['lrc'] },
  srt: { name: 'SubRip subtitles', extensions: ['srt'] },
  ass: { name: 'ASS karaoke', extensions: ['ass'] },
  json: { name: 'JSON result', extensions: ['json'] },
};

export type SaveOutcome =
  | { kind: 'tauri'; path: string }
  | { kind: 'download' }
  | { kind: 'cancelled' };

/**
 * Save text to disk. Inside Tauri this opens a native save dialog and
 * writes the file; in the browser it triggers a download of the blob.
 */
export async function saveText(
  text: string,
  filename: string,
  fmt: ExportFormat,
  mime: string,
): Promise<SaveOutcome> {
  if (hasTauri()) {
    const path = await save({
      defaultPath: filename,
      filters: [EXT_FILTER[fmt]],
    });
    if (!path) return { kind: 'cancelled' };
    await writeTextFile(path, text);
    return { kind: 'tauri', path };
  }
  downloadBlob(new Blob([text], { type: mime }), filename);
  return { kind: 'download' };
}

/** Save a backend-provided Blob (already-formatted file) via download. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
