/* ──────────────────────────────────────────────────────────────────
   ModeSwitch — the top-level product-mode toggle.

   🎵 歌曲歌詞 / 🎬 影片字幕  (zh)   ·   Lyrics / Subtitles  (en)

   An on-brand segmented radiogroup (gold active) that lives in the
   TabRail head, just under the wordmark. Keyboard-accessible: roving
   tabindex + arrow keys, exactly like Segmented / LanguageToggle.
   ────────────────────────────────────────────────────────────────── */

import { useCallback, useRef } from 'react';
import { Music, Clapperboard, Eraser } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useMode } from '../../state/useMode';
import type { AppMode } from '../../state/useMode';
import { useT } from '../../i18n';
import './mode-switch.css';

interface ModeDef {
  mode: AppMode;
  labelKey: string;
  titleKey: string;
  icon: LucideIcon;
}

const MODES: ModeDef[] = [
  { mode: 'song', labelKey: 'common.mode.song', titleKey: 'common.mode.songTitle', icon: Music },
  { mode: 'video', labelKey: 'common.mode.video', titleKey: 'common.mode.videoTitle', icon: Clapperboard },
  { mode: 'clean', labelKey: 'common.mode.clean', titleKey: 'common.mode.cleanTitle', icon: Eraser },
];

export interface ModeSwitchProps {
  /** Icon-only when the rail is collapsed (narrow window). */
  collapsed?: boolean;
}

export function ModeSwitch({ collapsed = false }: ModeSwitchProps) {
  const t = useT();
  const mode = useMode((s) => s.mode);
  const setMode = useMode((s) => s.setMode);
  const listRef = useRef<HTMLDivElement>(null);

  const focusIndex = (i: number) => {
    const clamped = (i + MODES.length) % MODES.length;
    listRef.current
      ?.querySelectorAll<HTMLButtonElement>('.al-modesw__seg')
      [clamped]?.focus();
  };

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        focusIndex(index + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        focusIndex(index - 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        focusIndex(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        focusIndex(MODES.length - 1);
      }
    },
    [],
  );

  const activeIndex = Math.max(0, MODES.findIndex((m) => m.mode === mode));

  return (
    <div
      ref={listRef}
      className={`al-modesw${collapsed ? ' al-modesw--collapsed' : ''}`}
      role="radiogroup"
      aria-label={t('common.mode.switchAria')}
    >
      {MODES.map((m, i) => {
        const active = m.mode === mode;
        const Icon = m.icon;
        return (
          <button
            key={m.mode}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={i === activeIndex ? 0 : -1}
            className={`al-modesw__seg${active ? ' al-modesw__seg--active' : ''}`}
            onClick={() => setMode(m.mode)}
            onKeyDown={(e) => onKeyDown(e, i)}
            title={t(m.titleKey)}
          >
            <span className="al-modesw__icon" aria-hidden="true">
              <Icon size={14} strokeWidth={1.9} />
            </span>
            <span className="al-modesw__label">{t(m.labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
