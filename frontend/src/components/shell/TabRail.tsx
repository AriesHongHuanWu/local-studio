import { useRef } from 'react';
import { TABS, tabsForMode } from './tabs';
import type { TabKey } from './tabs';
import { ModeSwitch } from './ModeSwitch';
import { useMode } from '../../state/useMode';
import { useT } from '../../i18n';

export interface TabRailProps {
  active: TabKey;
  onChange: (key: TabKey) => void;
  /** Collapse to icons-only (narrow window). */
  collapsed?: boolean;
}

/** Left vertical bilingual nav with gold active underline.
    Renders only the tabs the current product mode surfaces (tabsForMode). */
export function TabRail({ active, onChange, collapsed = false }: TabRailProps) {
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const mode = useMode((s) => s.mode);
  const t = useT();

  // The TabDefs for THIS mode, in the mode's declared order. Keyboard nav and
  // focus indices below operate over this filtered set, not the full TABS.
  const visibleKeys = tabsForMode(mode);
  const tabs = visibleKeys
    .map((key) => TABS.find((td) => td.key === key))
    .filter((td): td is (typeof TABS)[number] => Boolean(td));

  /** Move selection AND DOM focus together so arrow keys stay conformant. */
  const go = (index: number) => {
    const next = (index + tabs.length) % tabs.length;
    onChange(tabs[next].key);
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
      go(tabs.length - 1);
    }
  };

  return (
    <nav
      className={`al-rail ${collapsed ? 'al-rail--collapsed' : ''}`}
      aria-label={t('common.nav.aria')}
    >
      <div className="al-rail__head">
        <div className="al-rail__title">{t('common.appName')}</div>
        <div className="al-rail__sub">{t('common.appTagline')}</div>
      </div>

      {/* Top-level product mode — stays visible (icons-only) when collapsed,
          so it sits OUTSIDE the head (which is hidden in the collapsed rail). */}
      <ModeSwitch collapsed={collapsed} />

      {tabs.map((tab, i) => {
        const Icon = tab.icon;
        const isActive = tab.key === active;
        const label = t(tab.labelKey);
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
            title={label}
          >
            <span className="al-tab__icon">
              <Icon size={19} strokeWidth={1.75} />
            </span>
            <span className="al-tab__labels">
              <span className="al-tab__zh">{label}</span>
            </span>
            {isActive && <span className="al-tab__underline" />}
          </button>
        );
      })}
    </nav>
  );
}
