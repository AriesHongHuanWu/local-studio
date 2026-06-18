import type { ReactNode } from 'react';
import { Minus, Square, X } from 'lucide-react';
import './shell.css';

export interface AppFrameProps {
  children: ReactNode;
}

/* ──────────────────────────────────────────────────────────────────
   Window controls. The Tauri window is frameless (decorations:false),
   so the titlebar must provide its own minimize / maximize / close.
   These call the CORE window API, which `withGlobalTauri:true` DOES
   expose on window.__TAURI__ (unlike plugin APIs). Feature-detected so
   the plain-browser / `vite dev` fallback simply renders no controls.
   ────────────────────────────────────────────────────────────────── */

interface TauriWindowApi {
  getCurrentWindow?: () => {
    minimize?: () => Promise<void>;
    toggleMaximize?: () => Promise<void>;
    close?: () => Promise<void>;
  };
}
interface TauriCoreWindow {
  __TAURI__?: { window?: TauriWindowApi };
}

function currentWindow() {
  const w = window as unknown as TauriCoreWindow;
  return w.__TAURI__?.window?.getCurrentWindow?.();
}

/** True only inside the Tauri webview, where the core window API exists. */
function hasWindowControls(): boolean {
  return Boolean(currentWindow());
}

function WindowControls() {
  // Swallow rejections: a failed minimize/close should never crash the UI.
  const run = (fn?: () => Promise<void>) => () => {
    void fn?.()?.catch(() => {});
  };
  const win = currentWindow();
  if (!win) return null;

  return (
    <div className="al-wincontrols">
      <button
        type="button"
        className="al-wincontrol"
        aria-label="最小化 Minimize"
        title="最小化 Minimize"
        onClick={run(win.minimize?.bind(win))}
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        className="al-wincontrol"
        aria-label="最大化 Maximize"
        title="最大化 Maximize"
        onClick={run(win.toggleMaximize?.bind(win))}
      >
        <Square size={12} />
      </button>
      <button
        type="button"
        className="al-wincontrol al-wincontrol--close"
        aria-label="關閉 Close"
        title="關閉 Close"
        onClick={run(win.close?.bind(win))}
      >
        <X size={14} />
      </button>
    </div>
  );
}

/**
 * Rounded warm-graphite outer frame. The titlebar strip carries the Tauri
 * drag region (`data-tauri-drag-region`) so the whole top edge moves the
 * window once wrapped, plus frameless window controls on the right.
 */
export function AppFrame({ children }: AppFrameProps) {
  const showControls = hasWindowControls();
  return (
    <div className="al-frame">
      <div className="al-titlebar" data-tauri-drag-region>
        <div className="al-titlebar__brand" data-tauri-drag-region>
          <span className="al-titlebar__brand-mark">◆</span>
          <span>AutoLyrics</span>
        </div>
        <div className="al-titlebar__right" data-tauri-drag-region>
          <div className="al-titlebar__brand" data-tauri-drag-region>
            <span>本機 · LOCAL-FIRST</span>
          </div>
          {showControls && <WindowControls />}
        </div>
      </div>
      {children}
    </div>
  );
}
