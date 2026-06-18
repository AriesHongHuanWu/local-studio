import { Cpu, WifiOff } from 'lucide-react';
import { Badge } from '../primitives';
import { useMeta } from '../../state/useMeta';
import type { TabKey } from './tabs';
import { TABS } from './tabs';

export interface StatusStripProps {
  activeTab: TabKey;
}

/** Top status bar: GPU·VRAM chip (green when online), active mode, version. */
export function StatusStrip({ activeTab }: StatusStripProps) {
  const meta = useMeta((s) => s.meta);
  const online = useMeta((s) => s.online);
  const tab = TABS.find((t) => t.key === activeTab);

  return (
    <div className="al-status">
      <div className="al-status__group">
        <span className="al-status__mode">
          {tab ? `${tab.zh} · ${tab.en}` : ''}
        </span>
      </div>

      <div className="al-status__group">
        {online ? (
          meta.gpu ? (
            <Badge tone="green" dot title="GPU online">
              <Cpu size={12} strokeWidth={2} /> GPU
            </Badge>
          ) : (
            <Badge tone="neutral" dot title="CPU only">
              <Cpu size={12} strokeWidth={2} /> CPU
            </Badge>
          )
        ) : (
          <Badge tone="neutral" title="Backend not reachable — UI in offline preview">
            <WifiOff size={12} strokeWidth={2} /> 離線預覽 OFFLINE
          </Badge>
        )}
        <span className="al-status__version">v{meta.version}</span>
      </div>
    </div>
  );
}
