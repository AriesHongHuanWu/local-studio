/* ──────────────────────────────────────────────────────────────────
   UpdateBanner — auto-popup update DIALOG (modal).

   When the startup/auto check finds a newer version, this pops up a
   centered modal over the app showing the new version + the FULL release
   notes (scrollable), with "立即更新 / 稍後". It also drives the
   download-progress + error states.

   Visibility:
     • Only inside Tauri (IN_TAURI guard — harmless no-op in browser/dev).
     • Shown when status is 'available' (and not dismissed), 'downloading',
       'ready', or 'error'.

   This is a MODAL (role=dialog, aria-modal), so auto-focusing the primary
   action is correct (unlike the old passive strip). Esc / backdrop / X close
   it (except mid-download, which keeps running in the background regardless).
   ────────────────────────────────────────────────────────────────── */

import { useEffect, useRef } from 'react';
import { Download, RefreshCw, X, AlertTriangle, Sparkles } from 'lucide-react';
import { useUpdater } from '../../state/useUpdater';
import { Button, ProgressBar } from '../primitives';
import { useT } from '../../i18n';
import './update.css';

const IN_TAURI = '__TAURI_INTERNALS__' in window;

export function UpdateBanner() {
  const t = useT();
  const { status, version, notes, progress, error, dismissed, downloadAndInstall, dismiss, checkNow } =
    useUpdater();
  const modalRef = useRef<HTMLDivElement>(null);

  const isVisible =
    IN_TAURI &&
    ((status === 'available' && !dismissed) ||
      status === 'downloading' ||
      status === 'ready' ||
      status === 'error');

  const canClose = status === 'available' || status === 'error';

  // Modal → move focus to the primary action when it appears (correct for a
  // dialog; the old non-modal strip deliberately did not).
  useEffect(() => {
    if (isVisible) {
      modalRef.current?.querySelector<HTMLButtonElement>('.al-btn--primary')?.focus();
    }
  }, [isVisible, status]);

  // Esc closes (only when not mid-download).
  useEffect(() => {
    if (!isVisible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && canClose) dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isVisible, canClose, dismiss]);

  if (!isVisible) return null;

  const busy = status === 'downloading' || status === 'ready';
  const titleText =
    status === 'error'
      ? t('update.errorCheck')
      : version
        ? t('update.titleWithVersion', { version })
        : t('update.title');

  return (
    <div
      className="al-update-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && canClose) dismiss();
      }}
    >
      <div
        ref={modalRef}
        className="al-update-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="al-update-title"
      >
        <div className="al-update-modal__head">
          {status === 'error' ? (
            <AlertTriangle size={18} className="al-update-modal__icon al-update-modal__icon--error" aria-hidden />
          ) : (
            <Sparkles size={18} className="al-update-modal__icon al-update-modal__icon--gold" aria-hidden />
          )}
          <h2 id="al-update-title" className="al-update-modal__title">
            {titleText}
          </h2>
          {canClose && (
            <button
              type="button"
              className="al-update-modal__close"
              onClick={dismiss}
              aria-label={t('update.later')}
            >
              <X size={16} />
            </button>
          )}
        </div>

        {status === 'error' ? (
          <p className="al-update-modal__error">
            {error === '__offline__' ? t('update.errorOffline') : error ?? ''}
          </p>
        ) : busy ? (
          <div className="al-update-modal__progress">
            <span className="al-update-modal__progressMsg">
              {status === 'ready'
                ? t('update.installing')
                : progress > 0
                  ? t('update.downloading', { pct: String(progress) })
                  : t('update.downloadingIndeterminate')}
            </span>
            <ProgressBar value={progress} indeterminate={progress === 0 && status !== 'ready'} tone="gold" />
            <span className="al-update-modal__restartNote">{t('update.restartNote')}</span>
          </div>
        ) : notes ? (
          <>
            <div className="al-update-modal__notesLabel">{t('update.notes')}</div>
            <div className="al-update-modal__notes">{notes}</div>
          </>
        ) : null}

        {!busy && (
          <div className="al-update-modal__actions">
            {status === 'error' ? (
              <>
                <Button variant="primary" size="md" icon={<RefreshCw size={14} />} onClick={() => void checkNow(true)}>
                  {t('update.retry')}
                </Button>
                <Button variant="ghost" size="md" onClick={dismiss}>
                  {t('update.later')}
                </Button>
              </>
            ) : (
              <>
                <Button variant="primary" size="md" icon={<Download size={14} />} onClick={() => void downloadAndInstall()}>
                  {t('update.install')}
                </Button>
                <Button variant="ghost" size="md" onClick={dismiss}>
                  {t('update.later')}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
