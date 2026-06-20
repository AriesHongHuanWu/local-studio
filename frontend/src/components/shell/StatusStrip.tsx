import { useEffect, useState } from 'react';
import { Cpu, WifiOff, Loader2 } from 'lucide-react';
import { Badge } from '../primitives';
import { useMeta } from '../../state/useMeta';
import type { TabKey } from './tabs';
import { TABS } from './tabs';
import { useT, LanguageToggle } from '../../i18n';

const IN_TAURI = '__TAURI_INTERNALS__' in window;

export interface StatusStripProps {
  activeTab: TabKey;
}

/** Top status bar: active mode · GPU/CPU chip (green when online) · version · language toggle. */
export function StatusStrip({ activeTab }: StatusStripProps) {
  const meta = useMeta((s) => s.meta);
  const online = useMeta((s) => s.online);
  const connecting = useMeta((s) => s.connecting);
  const t = useT();
  const tab = TABS.find((t2) => t2.key === activeTab);

  // The authoritative version is the Tauri app version (from tauri.conf), NOT
  // the backend's /api/meta version (which is hardcoded and lagged). Read it
  // once inside the desktop app; fall back to meta.version in plain browser/dev.
  const [appVersion, setAppVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!IN_TAURI) return;
    import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then(setAppVersion)
      .catch(() => {});
  }, []);

  return (
    <div className="al-status">
      <div className="al-status__group">
        <span className="al-status__mode">{tab ? t(tab.labelKey) : ''}</span>
      </div>

      <div className="al-status__group">
        {online ? (
          meta.gpu ? (
            <Badge tone="green" dot title={t('common.status.gpuOnline')}>
              <Cpu size={12} strokeWidth={2} /> GPU
            </Badge>
          ) : (
            <Badge tone="neutral" dot title={t('common.status.cpuOnly')}>
              <Cpu size={12} strokeWidth={2} /> CPU
            </Badge>
          )
        ) : connecting ? (
          <Badge tone="neutral" title={t('common.status.startingTitle')}>
            <Loader2 size={12} strokeWidth={2} className="al-spin" /> {t('common.status.starting')}
          </Badge>
        ) : (
          <Badge tone="neutral" title={t('common.status.offlineTitle')}>
            <WifiOff size={12} strokeWidth={2} /> {t('common.status.offline')}
          </Badge>
        )}
        <span className="al-status__version">v{appVersion ?? meta.version}</span>
        <LanguageToggle />
      </div>
    </div>
  );
}
