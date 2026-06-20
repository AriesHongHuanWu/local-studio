/* ──────────────────────────────────────────────────────────────────
   state/useUpdater.ts — In-app auto-update state (Tauri v2 updater).

   Guard: every Tauri API call is wrapped in an `IN_TAURI` check so
   the hook is a harmless no-op in plain-browser / vite-dev mode.

   State exposed:
     status     — 'idle' | 'checking' | 'available' | 'downloading'
                  | 'ready' | 'error'
     available  — true when an update was found.
     version    — remote version string (e.g. "0.2.0"), or null.
     notes      — release notes markdown string, or null.
     progress   — 0–100, only meaningful during 'downloading'.
     error      — last error message string, or null.
     dismissed  — user clicked "Later" (hides the banner this session).

   Actions:
     checkNow()           — run a fresh update check (sets status).
     downloadAndInstall() — download then relaunch; shows progress.
     dismiss()            — set dismissed=true (hides banner).

   Policy:
     • Auto-CHECK on startup (once, only inside Tauri).
     • NEVER auto-install — user must confirm.
     • Errors are surfaced; offline / network errors show a graceful msg.
   ────────────────────────────────────────────────────────────────── */

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

// ── Detect Tauri at module load (synchronous, safe in plain browser) ─────────
const IN_TAURI = '__TAURI_INTERNALS__' in window;

// ── Lazy plugin imports (only resolved inside Tauri) ─────────────────────────
// We import at module level for type-safety but guard every call site with
// IN_TAURI so the browser build never actually executes these paths.
import type { Update, DownloadEvent } from '@tauri-apps/plugin-updater';

// Dynamic-import wrappers so the browser bundle keeps the imports tree-shakeable
// without actually importing from @tauri-apps in a non-Tauri context.
async function getTauriUpdater() {
  const mod = await import('@tauri-apps/plugin-updater');
  return mod;
}
async function getTauriProcess() {
  const mod = await import('@tauri-apps/plugin-process');
  return mod;
}

// ── Types ─────────────────────────────────────────────────────────────────────
export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error';

interface UpdaterState {
  status: UpdaterStatus;
  available: boolean;
  /** Remote version string, e.g. "0.2.0". Null until a check finds one. */
  version: string | null;
  /** Release notes (markdown). Null until a check finds an update. */
  notes: string | null;
  /** Download progress 0–100. Only meaningful during 'downloading'. */
  progress: number;
  /** Last error message; null when no error. */
  error: string | null;
  /** User clicked "Later" — suppress the banner for this session. */
  dismissed: boolean;

  /** Run a fresh update check. No-op when not in Tauri.
   *  `manual` = the user explicitly asked (Settings button) → surface errors.
   *  Auto-check on startup passes manual=false → failures stay silent (a
   *  local-first app must never pop a "check failed" modal just because the
   *  machine is offline). */
  checkNow: (manual?: boolean) => Promise<void>;
  /** Download the pending update and relaunch. Requires available=true. */
  downloadAndInstall: () => Promise<void>;
  /** Hide the update banner for this session (does NOT cancel a download). */
  dismiss: () => void;

  // Internal: hold the pending Update object between check and install.
  _update: Update | null;
}

// ── Store ─────────────────────────────────────────────────────────────────────
export const useUpdater = create<UpdaterState>((set, get) => ({
  status: 'idle',
  available: false,
  version: null,
  notes: null,
  progress: 0,
  error: null,
  dismissed: false,
  _update: null,

  // ── checkNow ────────────────────────────────────────────────────────────────
  checkNow: async (manual = false) => {
    if (!IN_TAURI) return;
    // Prevent concurrent checks.
    if (get().status === 'checking') return;

    set({ status: 'checking', error: null });

    try {
      const { check } = await getTauriUpdater();
      const update = await check();

      if (update?.available) {
        set({
          status: 'available',
          available: true,
          version: update.version ?? null,
          notes: update.body ?? null,
          _update: update,
          // Reset dismissed so a newly-found version re-shows the banner.
          dismissed: false,
        });
      } else {
        // No update: go back to idle (not an error).
        set({ status: 'idle', available: false, version: null, notes: null, _update: null });
      }
    } catch (err) {
      // Network offline, signature mismatch, or server error.
      const msg = err instanceof Error ? err.message : String(err);
      // Auto-check (startup): NEVER surface — just go quiet. A local-first app
      // popping "update check failed" on every offline launch is pure noise.
      if (!manual) {
        set({ status: 'idle', error: null });
        return;
      }
      // Manual check: surface, distinguishing "network unreachable" for i18n.
      const isOffline =
        msg.toLowerCase().includes('network') ||
        msg.toLowerCase().includes('connect') ||
        msg.toLowerCase().includes('fetch') ||
        msg.toLowerCase().includes('dns') ||
        msg.toLowerCase().includes('timed out');
      set({
        status: 'error',
        error: isOffline ? '__offline__' : msg,
      });
    }
  },

  // ── downloadAndInstall ──────────────────────────────────────────────────────
  downloadAndInstall: async () => {
    if (!IN_TAURI) return;
    const { _update } = get();
    if (!_update) return;

    set({ status: 'downloading', progress: 0, error: null });

    try {
      let totalBytes = 0;
      let downloadedBytes = 0;
      const onEvent = (event: DownloadEvent) => {
        if (event.event === 'Started') {
          totalBytes = event.data.contentLength ?? 0;
          set({ progress: 0 });
        } else if (event.event === 'Progress') {
          downloadedBytes += event.data.chunkLength;
          const pct =
            totalBytes > 0
              ? Math.min(99, Math.round((downloadedBytes / totalBytes) * 100))
              : 0; // indeterminate if content-length was missing
          set({ progress: pct });
        } else if (event.event === 'Finished') {
          set({ progress: 100, status: 'ready' });
        }
      };

      // Prefer split download → kill backend → install. Killing the backend ONLY
      // after the download succeeds (a) never leaves the app backend-less on a
      // download failure, and (b) releases the embedded-python file locks BEFORE
      // the NSIS installer overwrites <install>/python/** — which otherwise fails
      // with "Error opening file for writing". Falls back to the combined call on
      // older plugin builds (still killing the backend first).
      const u = _update as unknown as {
        download?: (cb: typeof onEvent) => Promise<void>;
        install?: () => Promise<void>;
      };
      if (typeof u.download === 'function' && typeof u.install === 'function') {
        await u.download(onEvent);
        set({ status: 'ready', progress: 100 });
        try {
          await invoke('prepare_update');
        } catch {
          /* best-effort: proceed even if the backend was already gone */
        }
        await u.install();
      } else {
        try {
          await invoke('prepare_update');
        } catch {
          /* best-effort */
        }
        await _update.downloadAndInstall(onEvent);
      }

      // install resolves after the update is applied; relaunch to restart.
      set({ status: 'ready', progress: 100 });

      // Relaunch in its own try/catch. On Windows NSIS the installer process
      // takes over and terminates the running app to swap the binary, so the
      // explicit relaunch() may be unreachable or race the installer — and a
      // rejection here does NOT mean the update failed. Never downgrade to
      // 'error' for a relaunch rejection (the app may already be exiting):
      // keep status 'ready' and just log it.
      try {
        const { relaunch } = await getTauriProcess();
        await relaunch();
      } catch (relaunchErr) {
        // App is likely already being replaced/terminated by the installer.
        console.warn('[updater] relaunch after install did not complete:', relaunchErr);
      }
    } catch (err) {
      // Only failures from the download/verify/stage phase land here.
      const msg = err instanceof Error ? err.message : String(err);
      set({ status: 'error', error: msg, progress: 0 });
    }
  },

  // ── dismiss ─────────────────────────────────────────────────────────────────
  dismiss: () => set({ dismissed: true }),
}));

// ── Auto-check on startup (once, Tauri-only) ──────────────────────────────────
// Deferred slightly so the main app has time to mount before we make network
// requests; keeps the critical render path fast.
if (IN_TAURI) {
  setTimeout(() => {
    void useUpdater.getState().checkNow();
  }, 3_000);
}
