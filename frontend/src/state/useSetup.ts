/* ──────────────────────────────────────────────────────────────────
   state/useSetup.ts — First-run backend-setup state.

   Only active when running inside the Tauri webview
   (`'__TAURI_INTERNALS__' in window`). In plain-browser / vite-dev
   mode, inTauri stays false and the rest of the store is a no-op;
   the existing App behaviour (backend managed externally) is
   preserved entirely.

   State exposed:
     inTauri      — true only inside the Tauri shell.
     status       — raw BackendStatus from Rust (or null before first check).
     needsSetup   — true when inTauri && !status.venv_exists.
     pythonFound  — mirrors status.python_found (shorthand).
     running      — setup_backend command currently running.
     progressLines — all setup-progress lines received so far.
     pct          — last progress percentage (0..100).
     error        — last error string (or null).
     checkStatus()  — (re-)invoke backend_status.
     runSetup()     — invoke setup_backend; listens to events.
   ────────────────────────────────────────────────────────────────── */

import { create } from 'zustand';

// ── Tauri API imports (only live inside the Tauri webview) ──────────────────
// We use the @tauri-apps/api package that is already a dep.
// Dynamic imports would add unnecessary latency; instead we import at the
// module level and guard every call with `inTauri` at runtime.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// ── Types mirroring the Rust BackendStatus struct ───────────────────────────
export interface BackendStatus {
  venv_exists: boolean;
  backend_dir_exists: boolean;
  backend_dir: string | null;
  python_found: boolean;
  python_version: string | null;
}

interface SetupProgressPayload {
  line: string;
  /** 0..100, or -1 for stderr lines (no pct update). */
  pct: number;
}

interface SetupDonePayload {
  success: boolean;
  error: string | null;
}

// ── Store interface ──────────────────────────────────────────────────────────
interface SetupState {
  inTauri: boolean;
  status: BackendStatus | null;
  /** True only when inTauri AND venv is not yet created. */
  needsSetup: boolean;
  /** Shorthand: status?.python_found ?? false */
  pythonFound: boolean;
  /** setup_backend invocation is running. */
  running: boolean;
  progressLines: string[];
  pct: number;
  error: string | null;
  /** Install finished successfully (venv built + backend spawned). */
  done: boolean;
  /**
   * Teardown for the active setup-event listeners (or null when none).
   * Stored on the store so an abnormal unmount (window close mid-install)
   * or a remount can release the Tauri event subscriptions — they would
   * otherwise dangle, since runSetup only unlistens inside its own handlers.
   */
  _unlisten: (() => void) | null;

  /** (Re-)invoke backend_status and update state. */
  checkStatus: () => Promise<void>;
  /** Start the setup wizard: invoke setup_backend + listen to events. */
  runSetup: () => Promise<void>;
  /** Release any active event listeners (call from SetupScreen unmount). */
  cancelSetup: () => void;
  /**
   * Force the setup wizard to show again (recovery for a broken/incomplete
   * engine that exists on disk but won't start). Re-running setup re-installs
   * torch + requirements even when the venv already exists, repairing it.
   */
  forceReinstall: () => void;
}

// ── Detect Tauri at module-load time (synchronous, safe in browser too) ─────
const IN_TAURI = '__TAURI_INTERNALS__' in window;

// ── Store ────────────────────────────────────────────────────────────────────
export const useSetup = create<SetupState>((set, get) => ({
  inTauri: IN_TAURI,
  status: null,
  needsSetup: false,
  pythonFound: false,
  running: false,
  progressLines: [],
  pct: 0,
  error: null,
  done: false,
  _unlisten: null,

  // ── checkStatus ─────────────────────────────────────────────────────────
  checkStatus: async () => {
    if (!IN_TAURI) return;
    try {
      const status = await invoke<BackendStatus>('backend_status');
      set({
        status,
        needsSetup: !status.venv_exists,
        pythonFound: status.python_found,
      });
    } catch (err) {
      // Unexpected Tauri error — log and assume we still need setup so the
      // wizard stays visible rather than showing a broken main app.
      console.error('[useSetup] backend_status failed:', err);
      set({ needsSetup: true, pythonFound: false });
    }
  },

  // ── runSetup ────────────────────────────────────────────────────────────
  runSetup: async () => {
    if (!IN_TAURI) return;
    if (get().running) return;

    // Defensive: tear down any listeners left over from a prior run before
    // attaching a new pair (avoids duplicate subscriptions on remount).
    get().cancelSetup();

    set({ running: true, progressLines: [], pct: 0, error: null, done: false });

    // Subscribe to streaming events before invoking the command.
    const unlistenProgress = await listen<SetupProgressPayload>(
      'setup-progress',
      (event) => {
        const { line, pct } = event.payload;
        set((s) => ({
          progressLines: [...s.progressLines, line],
          // -1 means a stderr line that carries no real pct info
          pct: pct >= 0 ? pct : s.pct,
        }));
      },
    );

    const unlistenDone = await listen<SetupDonePayload>(
      'setup-done',
      async (event) => {
        const { success, error } = event.payload;
        // Release both listeners via the stored teardown (clears _unlisten too).
        get().cancelSetup();
        set({
          running: false,
          done: success,
          pct: success ? 100 : get().pct,
          error: error ?? null,
        });
        if (success) {
          // Re-check so needsSetup flips to false, allowing App.tsx to
          // unmount the SetupScreen and show the normal app. App.tsx then
          // polls /api/meta until the freshly-spawned backend answers.
          await get().checkStatus();
        }
      },
    );

    // Store a combined teardown so an abnormal unmount can release both.
    set({
      _unlisten: () => {
        unlistenProgress();
        unlistenDone();
      },
    });

    try {
      // This invoke blocks on the Rust side until the install script exits.
      // The events above stream progress in parallel on the Tauri event bus.
      await invoke('setup_backend');
    } catch (err) {
      // The Rust command returned Err(_); the setup-done event was already
      // emitted by Rust so the listeners above handle the error state.
      // But if the invoke itself throws before any event fires, surface it.
      get().cancelSetup();
      const message = err instanceof Error ? err.message : String(err);
      set({ running: false, error: message });
    }
  },

  // ── cancelSetup ─────────────────────────────────────────────────────────
  // Idempotent teardown of the active setup-event listeners. Safe to call
  // when none are attached. Called from SetupScreen's unmount cleanup and
  // internally whenever runSetup finishes or restarts.
  cancelSetup: () => {
    const u = get()._unlisten;
    if (u) {
      u();
      set({ _unlisten: null });
    }
  },

  // ── forceReinstall ──────────────────────────────────────────────────────
  forceReinstall: () => {
    if (!IN_TAURI) return;
    set({ needsSetup: true, done: false, error: null, running: false, progressLines: [], pct: 0 });
  },
}));
