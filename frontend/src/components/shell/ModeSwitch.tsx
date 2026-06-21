/* ──────────────────────────────────────────────────────────────────
   ModeSwitch — the top-level tool picker, organised into categories so
   the product can grow, with pin-to-top favourites.

   📌 Pinned  ·  🎵 Audio (lyrics / mastering)  ·  🎬 Video (subtitles /
   text removal). A pinned tool rises into the "Pinned" section; its
   category shows the rest. Keyboard-accessible roving radiogroup.
   ────────────────────────────────────────────────────────────────── */

import { useCallback, useRef } from 'react';
import { Music, Clapperboard, Eraser, Disc3, Pin, Wrench, DownloadCloud, Library } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useMode } from '../../state/useMode';
import type { AppMode } from '../../state/useMode';
import { usePinned } from '../../state/usePinned';
import { useT } from '../../i18n';
import './mode-switch.css';

const MODE_DEFS: Record<AppMode, { labelKey: string; titleKey: string; icon: LucideIcon }> = {
  catalog: { labelKey: 'common.mode.catalog', titleKey: 'common.mode.catalogTitle', icon: Library },
  song: { labelKey: 'common.mode.song', titleKey: 'common.mode.songTitle', icon: Music },
  video: { labelKey: 'common.mode.video', titleKey: 'common.mode.videoTitle', icon: Clapperboard },
  clean: { labelKey: 'common.mode.clean', titleKey: 'common.mode.cleanTitle', icon: Eraser },
  master: { labelKey: 'common.mode.master', titleKey: 'common.mode.masterTitle', icon: Disc3 },
  tools: { labelKey: 'common.mode.tools', titleKey: 'common.mode.toolsTitle', icon: Wrench },
  download: { labelKey: 'common.mode.download', titleKey: 'common.mode.downloadTitle', icon: DownloadCloud },
};

const CATEGORIES: { key: string; labelKey: string; modes: AppMode[] }[] = [
  { key: 'home', labelKey: 'common.cat.home', modes: ['catalog'] },
  { key: 'get', labelKey: 'common.cat.get', modes: ['download'] },
  { key: 'audio', labelKey: 'common.cat.audio', modes: ['song', 'master', 'tools'] },
  { key: 'video', labelKey: 'common.cat.video', modes: ['video', 'clean'] },
];

export interface ModeSwitchProps {
  /** Icon-only when the rail is collapsed (narrow window). */
  collapsed?: boolean;
}

export function ModeSwitch({ collapsed = false }: ModeSwitchProps) {
  const t = useT();
  const mode = useMode((s) => s.mode);
  const setMode = useMode((s) => s.setMode);
  const pinned = usePinned((s) => s.pinned);
  const togglePin = usePinned((s) => s.togglePin);
  const listRef = useRef<HTMLDivElement>(null);

  // Sections: Pinned (if any) + each category's NON-pinned tools (no duplicates).
  const sections: { key: string; labelKey: string; modes: AppMode[] }[] = [];
  if (pinned.length) sections.push({ key: 'pinned', labelKey: 'common.cat.pinned', modes: pinned });
  for (const c of CATEGORIES) {
    const modes = c.modes.filter((m) => !pinned.includes(m));
    if (modes.length) sections.push(c.key === 'pinned' ? c : { ...c, modes });
  }
  const order: AppMode[] = sections.flatMap((s) => s.modes);
  const activeIndex = Math.max(0, order.indexOf(mode));

  const focusIndex = (i: number) => {
    const clamped = (i + order.length) % order.length;
    listRef.current?.querySelectorAll<HTMLButtonElement>('.al-modesw__seg')[clamped]?.focus();
  };
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); focusIndex(index + 1); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); focusIndex(index - 1); }
      else if (e.key === 'Home') { e.preventDefault(); focusIndex(0); }
      else if (e.key === 'End') { e.preventDefault(); focusIndex(order.length - 1); }
    },
    [order.length], // eslint-disable-line react-hooks/exhaustive-deps
  );

  let idx = -1;
  return (
    <div
      ref={listRef}
      className={`al-modesw${collapsed ? ' al-modesw--collapsed' : ''}`}
      role="radiogroup"
      aria-label={t('common.mode.switchAria')}
    >
      {sections.map((sec) => (
        <div key={sec.key} className="al-modesw__group">
          {!collapsed && (
            <div className="al-modesw__cat">
              {sec.key === 'pinned' && <Pin size={11} strokeWidth={2} />} {t(sec.labelKey)}
            </div>
          )}
          {sec.modes.map((m) => {
            idx += 1;
            const i = idx;
            const def = MODE_DEFS[m];
            const Icon = def.icon;
            const active = m === mode;
            const isPin = pinned.includes(m);
            return (
              <button
                key={`${sec.key}-${m}`}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={i === activeIndex ? 0 : -1}
                className={`al-modesw__seg${active ? ' al-modesw__seg--active' : ''}`}
                onClick={() => setMode(m)}
                onKeyDown={(e) => onKeyDown(e, i)}
                title={t(def.titleKey)}
                aria-label={t(def.labelKey)}
              >
                <span className="al-modesw__icon" aria-hidden="true">
                  <Icon size={16} strokeWidth={1.9} />
                </span>
                <span className="al-modesw__label">{t(def.labelKey)}</span>
                {!collapsed && (
                  <span
                    role="button"
                    tabIndex={-1}
                    className={`al-modesw__pin${isPin ? ' al-modesw__pin--on' : ''}`}
                    onClick={(e) => { e.stopPropagation(); togglePin(m); }}
                    title={t(isPin ? 'common.pin.remove' : 'common.pin.add')}
                    aria-label={t(isPin ? 'common.pin.remove' : 'common.pin.add')}
                  >
                    <Pin size={12} strokeWidth={2} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
