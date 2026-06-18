import { useRef } from 'react';
import { TABS } from './tabs';
import type { TabKey } from './tabs';

export interface TabRailProps {
  active: TabKey;
  onChange: (key: TabKey) => void;
  /** Collapse to icons-only (narrow window). */
  collapsed?: boolean;
}

/** Left vertical bilingual 5-tab nav with gold active underline. */
export function TabRail({ active, onChange, collapsed = false }: TabRailProps) {
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  /** Move selection AND DOM focus together so arrow keys stay conformant. */
  const go = (index: number) => {
    const next = (index + TABS.length) % TABS.length;
    onChange(TABS[next].key);
    btnRefs.current[next]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      go(index + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      go(index - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      go(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      go(TABS.length - 1);
    }
  };

  return (
    <nav
      className={`al-rail ${collapsed ? 'al-rail--collapsed' : ''}`}
      aria-label="主要分頁 Primary navigation"
    >
      <div className="al-rail__head">
        <div className="al-rail__title">AutoLyrics</div>
        <div className="al-rail__sub">逐字時間軸歌詞</div>
      </div>

      {TABS.map((tab, i) => {
        const Icon = tab.icon;
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            ref={(el) => {
              btnRefs.current[i] = el;
            }}
            className={`al-tab ${isActive ? 'al-tab--active' : ''}`}
            onClick={() => onChange(tab.key)}
            onKeyDown={(e) => onKeyDown(e, i)}
            aria-current={isActive ? 'page' : undefined}
            title={`${tab.zh} · ${tab.en}`}
          >
            <span className="al-tab__icon">
              <Icon size={19} strokeWidth={1.75} />
            </span>
            <span className="al-tab__labels">
              <span className="al-tab__zh">{tab.zh}</span>
              <span className="al-tab__en">{tab.en}</span>
            </span>
            {isActive && <span className="al-tab__underline" />}
          </button>
        );
      })}
    </nav>
  );
}
