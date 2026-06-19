/* ──────────────────────────────────────────────────────────────────
   UpdateSettingsRow — A compact "Check for updates" affordance for
   the Settings tab.  Shows:
     • Current version (from the meta store, same as privacy section)
     • Status badge: idle / checking / up-to-date / available / error
     • "Check for updates" button (disabled while checking)
     • When available: surfaces the version + "Update now" link
   Only visible inside Tauri; returns null in plain-browser mode.
   ────────────────────────────────────────────────────────────────── */

import { RefreshCw, CheckCircle2, ArrowUpCircle, AlertTriangle, Loader } from 'lucide-react';
import { useUpdater } from '../../state/useUpdater';
import { useAppVersion } from '../../state/useAppVersion';
import { Button } from '../primitives';
import { useT } from '../../i18n';
import './update.css';

const IN_TAURI = '__TAURI_INTERNALS__' in window;

export function UpdateSettingsRow() {
  const t = useT();
  const { status, version: remoteVersion, progress, checkNow, downloadAndInstall } = useUpdater();
  const currentVersion = useAppVersion();

  if (!IN_TAURI) return null;

  const isChecking = status === 'checking';
  const isAvailable = status === 'available';
  const isDownloading = status === 'downloading' || status === 'ready';
  const isError = status === 'error';
  const isUpToDate = status === 'idle' && !isAvailable;

  return (
    <div className="al-panel al-update-row">
      {/* Version meta */}
      <div className="al-update-row__meta">
        <span className="al-update-row__label">{t('update.currentVersion')}</span>
        <span className="al-update-row__version">
          <code>{currentVersion || '—'}</code>
        </span>
        {/* Status line */}
        {isChecking && (
          <span className="al-update-row__status">
            <Loader size={11} className="al-spinner-icon" aria-hidden /> {t('update.checking')}
          </span>
        )}
        {isUpToDate && (
          <span className="al-update-row__status al-update-row__status--ok">
            <CheckCircle2 size={11} aria-hidden /> {t('update.upToDate')}
          </span>
        )}
        {isAvailable && (
          <span className="al-update-row__status al-update-row__status--available">
            <ArrowUpCircle size={11} aria-hidden />{' '}
            {remoteVersion
              ? t('update.titleWithVersion', { version: remoteVersion })
              : t('update.title')}
          </span>
        )}
        {isDownloading && (
          <span className="al-update-row__status">
            <Loader size={11} className="al-spinner-icon" aria-hidden /> {t('update.downloading', { pct: String(progress) })}
          </span>
        )}
        {isError && (
          <span className="al-update-row__status al-update-row__status--error">
            <AlertTriangle size={11} aria-hidden /> {t('update.errorCheck')}
          </span>
        )}
      </div>

      {/* Actions */}
      {isAvailable ? (
        <Button
          variant="primary"
          size="sm"
          icon={<ArrowUpCircle size={13} />}
          onClick={() => void downloadAndInstall()}
          aria-label={t('update.install')}
        >
          {t('update.install')}
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          icon={isChecking ? <Loader size={13} className="al-spinner-icon" /> : <RefreshCw size={13} />}
          onClick={() => void checkNow()}
          disabled={isChecking || isDownloading}
          aria-label={t('update.checkNow')}
          title={t('update.checkNow')}
        >
          {t('update.checkNow')}
        </Button>
      )}
    </div>
  );
}
