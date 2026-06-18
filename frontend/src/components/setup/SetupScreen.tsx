/* ──────────────────────────────────────────────────────────────────
   SetupScreen — full-screen first-run wizard.

   Shown ONLY when useSetup().needsSetup is true (i.e. we are inside
   the Tauri shell AND the backend venv does not yet exist).

   Never rendered in plain-browser / vite-dev mode.

   Phases:
     1. python-missing  — user needs to install Python first.
     2. ready-to-install — venv absent but Python found; show CTA.
     3. running          — live scrolling log + gold progress bar.
     4. error            — show error + Retry.
     (needsSetup → false once venv exists → wizard unmounts, normal
      app renders, the existing SetupBanner model-picker takes over.)
   ────────────────────────────────────────────────────────────────── */

import { useEffect, useRef } from 'react';
import { ExternalLink, RefreshCw, Terminal, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button, ProgressBar, Eyebrow } from '../primitives';
import { useSetup } from '../../state/useSetup';
import './setup.css';

// Cap the rendered log to the tail — Rust streams every line but the user only
// ever sees the bottom, and a multi-GB torch install emits hundreds of lines.
// Re-mapping the full array into <div>s on every line would make the wizard janky.
const LOG_TAIL = 200;

export function SetupScreen() {
  // Granular selectors: each setup-progress line mutates the store once, so a
  // bare destructure of the whole store would re-render this component on every
  // stdout line. Subscribe only to the fields we actually read.
  const pythonFound = useSetup((s) => s.pythonFound);
  const running = useSetup((s) => s.running);
  const progressLines = useSetup((s) => s.progressLines);
  const pct = useSetup((s) => s.pct);
  const error = useSetup((s) => s.error);
  const status = useSetup((s) => s.status);
  const done = useSetup((s) => s.done);
  const checkStatus = useSetup((s) => s.checkStatus);
  const runSetup = useSetup((s) => s.runSetup);
  const cancelSetup = useSetup((s) => s.cancelSetup);

  // Only the tail is rendered (see LOG_TAIL).
  const logLines = progressLines.length > LOG_TAIL ? progressLines.slice(-LOG_TAIL) : progressLines;

  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the log to the bottom as new lines arrive.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logLines]);

  // Check status once on mount so we have up-to-date info. On unmount (e.g.
  // window closed mid-install, or needsSetup flips), release any dangling
  // setup-event listeners.
  useEffect(() => {
    void checkStatus();
    return () => cancelSetup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Derive phase ──────────────────────────────────────────────────
  const isRunning = running;
  // Authoritative success flag from the store (set on setup-done success).
  // This typically shows only briefly: checkStatus() flips needsSetup→false
  // and App.tsx unmounts this screen, then polls /api/meta until the freshly
  // spawned backend answers. Basing this on `done` (not a pct heuristic)
  // prevents falling through to the readyToInstall phase with a stale log.
  const isDone = !running && !error && done;
  const hasError = Boolean(error) && !running;
  const needsPython = status !== null && !pythonFound;
  const readyToInstall = status !== null && pythonFound && !isRunning && !isDone && !hasError;

  return (
    <div className="al-setup-screen" role="main" aria-label="首次設定 First-run setup">
      {/* ── Logo / heading ── */}
      <header className="al-setup-screen__head">
        <div className="al-setup-screen__mark">◆</div>
        <h1 className="al-setup-screen__title">AutoLyrics</h1>
        <p className="al-setup-screen__sub">
          歡迎使用 · Welcome &nbsp;—&nbsp; 首次設定 First-run setup
        </p>
      </header>

      {/* ── Card ── */}
      <div className="al-setup-screen__card">

        {/* ── Phase 1: Python not found ── */}
        {needsPython && !isRunning && (
          <section className="al-setup-phase" aria-label="需要 Python">
            <Eyebrow>步驟 1 · Step 1</Eyebrow>
            <div className="al-setup-phase__icon al-setup-phase__icon--warn">
              <AlertTriangle size={22} />
            </div>
            <h2 className="al-setup-phase__heading">需要 Python 3.10–3.12</h2>
            <p className="al-setup-phase__body">
              AutoLyrics 的辨識引擎需要系統安裝 Python 3.10、3.11 或 3.12，
              並已加入 PATH。
              <br />
              <span className="al-setup-phase__en">
                The recognition engine requires Python 3.10–3.12 on your system PATH.
              </span>
            </p>
            <div className="al-setup-phase__actions">
              <a
                href="https://www.python.org/downloads/"
                target="_blank"
                rel="noreferrer"
                className="al-setup-link"
              >
                <ExternalLink size={13} />
                python.org/downloads
              </a>
              <Button
                variant="default"
                size="md"
                icon={<RefreshCw size={14} />}
                onClick={() => void checkStatus()}
              >
                重新檢查 Re-check
              </Button>
            </div>
          </section>
        )}

        {/* ── Phase 2: Ready to install ── */}
        {readyToInstall && (
          <section className="al-setup-phase" aria-label="準備安裝">
            <Eyebrow>步驟 2 · Step 2</Eyebrow>
            <div className="al-setup-phase__icon al-setup-phase__icon--gold">
              <Terminal size={22} />
            </div>
            <h2 className="al-setup-phase__heading">安裝辨識引擎</h2>
            <p className="al-setup-phase__body">
              AutoLyrics 將在本機建立一個獨立的 Python 環境，並下載
              PyTorch 辨識引擎（需數 GB）。安裝完成後即可開始使用，之後啟動無需再次下載。
              <br />
              <span className="al-setup-phase__en">
                We'll create a local Python venv and download the PyTorch engine (a few GB).
                This is a one-time setup — future launches start instantly.
              </span>
            </p>
            {status?.python_version && (
              <p className="al-setup-phase__meta">
                <span className="al-setup-phase__meta-label">Python</span>
                {status.python_version}
              </p>
            )}
            {status?.backend_dir && (
              <p className="al-setup-phase__meta">
                <span className="al-setup-phase__meta-label">目錄 Dir</span>
                <span className="al-setup-phase__meta-path">{status.backend_dir}</span>
              </p>
            )}
            <div className="al-setup-phase__actions">
              <Button
                variant="primary"
                size="lg"
                onClick={() => void runSetup()}
              >
                開始設定 Set up engine
              </Button>
            </div>
          </section>
        )}

        {/* ── Phase 3: Running ── */}
        {isRunning && (
          <section className="al-setup-phase" aria-label="安裝中" aria-live="polite">
            <div className="al-setup-phase__running-head">
              <Loader2 size={16} className="al-spin" />
              <span className="al-setup-phase__running-label">
                {progressLines.length === 0
                  ? '正在啟動安裝… Starting…'
                  : pct < 30
                  ? '正在建立虛擬環境… Creating venv…'
                  : pct < 70
                  ? '正在下載 PyTorch… Downloading engine…'
                  : '正在安裝套件… Installing packages…'}
              </span>
              {progressLines.length > 0 && (
                <span className="al-setup-phase__running-pct">{Math.round(pct)}%</span>
              )}
            </div>
            {/* Before the first stdout line arrives, show motion so the user
                always sees feedback the instant they click 開始設定/重試. */}
            <ProgressBar
              value={pct}
              tone="gold"
              indeterminate={progressLines.length === 0}
            />
            <p className="al-setup-phase__note">
              這需要幾分鐘，視網速而定。請保持網路連線。
              <br />
              <span className="al-setup-phase__en">
                This takes a few minutes depending on your connection. Keep the app open.
              </span>
            </p>
            {/* Live log (tail only) */}
            <div
              ref={logRef}
              className="al-setup-log"
              role="log"
              aria-label="安裝紀錄 Setup log"
              aria-live="polite"
              aria-atomic="false"
            >
              {logLines.map((line, i) => (
                <div key={i} className="al-setup-log__line">
                  {line}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Phase 4: Error ── */}
        {hasError && (
          <section className="al-setup-phase" aria-label="安裝失敗">
            <div className="al-setup-phase__icon al-setup-phase__icon--error">
              <AlertTriangle size={22} />
            </div>
            <h2 className="al-setup-phase__heading al-setup-phase__heading--error">
              安裝失敗 Setup failed
            </h2>
            <p className="al-setup-phase__body">{error}</p>
            {logLines.length > 0 && (
              <div ref={logRef} className="al-setup-log al-setup-log--error">
                {logLines.map((line, i) => (
                  <div key={i} className="al-setup-log__line">
                    {line}
                  </div>
                ))}
              </div>
            )}
            <div className="al-setup-phase__actions">
              <Button
                variant="primary"
                size="md"
                icon={<RefreshCw size={14} />}
                onClick={() => void runSetup()}
              >
                重試 Retry
              </Button>
            </div>
          </section>
        )}

        {/* ── Phase 5: Success (brief, before needsSetup flips) ── */}
        {isDone && !hasError && (
          <section className="al-setup-phase" aria-label="安裝完成">
            <div className="al-setup-phase__icon al-setup-phase__icon--green">
              <CheckCircle2 size={22} />
            </div>
            <h2 className="al-setup-phase__heading al-setup-phase__heading--green">
              安裝完成 Setup complete!
            </h2>
            <p className="al-setup-phase__body">
              辨識引擎已就緒。正在啟動後端…
              <br />
              <span className="al-setup-phase__en">
                Engine ready. Launching backend…
              </span>
            </p>
            <ProgressBar value={100} tone="green" />
          </section>
        )}

        {/* ── Status not yet loaded (initial skeleton) ── */}
        {status === null && !isRunning && (
          <section className="al-setup-phase al-setup-phase--loading">
            <Loader2 size={18} className="al-spin" />
            <span>檢查安裝狀態… Checking status…</span>
          </section>
        )}
      </div>

      <footer className="al-setup-screen__foot">
        <span>AutoLyrics &nbsp;·&nbsp; 本機 LOCAL-FIRST &nbsp;·&nbsp; 不需要網路帳號</span>
      </footer>
    </div>
  );
}
