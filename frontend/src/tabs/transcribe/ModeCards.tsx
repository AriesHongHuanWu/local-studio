import { useRef } from 'react';
import { Sparkles, Target, Crosshair, type LucideIcon } from 'lucide-react';
import { ProgressBar } from '../../components/primitives';
import type { JobMode } from '../../api/types';

export interface ModeCardsProps {
  value: JobMode;
  onChange: (mode: JobMode) => void;
  /** Forced-Align availability (meta.aligner). */
  alignerEnabled: boolean;
  /** 0..1 readiness per mode, computed from supplied reference + style. */
  readiness: Record<JobMode, number>;
}

interface ModeDef {
  key: JobMode;
  zh: string;
  en: string;
  icon: LucideIcon;
  desc: string;
  /** Plain-language note describing what the meter is reading. */
  meterNote: string;
}

const MODES: ModeDef[] = [
  {
    key: 'auto',
    zh: '自動辨識',
    en: 'Auto',
    icon: Sparkles,
    desc: '什麼都不貼 — 乾淨的逐字轉錄。Nothing to paste; pure transcription.',
    meterNote: '只需要一首歌 Just needs a song',
  },
  {
    key: 'biasing',
    zh: '偏向',
    en: 'Biasing',
    icon: Target,
    desc: '貼片段歌詞 + 風格提示 — 引導辨識器。Fragments + style hint guide it.',
    meterNote: '加風格與片段更準 Style + fragments sharpen it',
  },
  {
    key: 'align',
    zh: '強制對齊',
    en: 'Forced-Align',
    icon: Crosshair,
    desc: '貼完整歌詞 — 近乎完美的逐字時間。Full lyrics → near-perfect timing.',
    meterNote: '貼越完整，越接近完美 The fuller the lyrics, the better',
  },
];

const ORDER: JobMode[] = ['auto', 'biasing', 'align'];

/** Three first-class mode cards, each with a plain-language readiness meter. */
export function ModeCards({ value, onChange, alignerEnabled, readiness }: ModeCardsProps) {
  const refs = useRef<Record<JobMode, HTMLButtonElement | null>>({
    auto: null,
    biasing: null,
    align: null,
  });

  const isDisabled = (key: JobMode) => key === 'align' && !alignerEnabled;

  // roving radiogroup: arrow keys move selection across enabled cards
  const onKeyNav = (e: React.KeyboardEvent, key: JobMode) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp')
      return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    const idx = ORDER.indexOf(key);
    const n = ORDER.length;
    for (let step = 1; step <= n; step++) {
      const next = ORDER[(((idx + dir * step) % n) + n) % n];
      if (!isDisabled(next)) {
        onChange(next);
        refs.current[next]?.focus();
        return;
      }
    }
  };

  return (
    <div className="al-modecards" role="radiogroup" aria-label="辨識模式 Recognition mode">
      {MODES.map((m) => {
        const disabled = isDisabled(m.key);
        const active = value === m.key;
        const r = Math.round((readiness[m.key] ?? 0) * 100);
        const Icon = m.icon;
        const ready = r >= 80;
        return (
          <button
            key={m.key}
            ref={(el) => {
              refs.current[m.key] = el;
            }}
            type="button"
            className={`al-modecard${active ? ' al-modecard--active' : ''}`}
            onClick={() => !disabled && onChange(m.key)}
            onKeyDown={(e) => onKeyNav(e, m.key)}
            disabled={disabled}
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            title={
              disabled ? '此機器未提供強制對齊 Aligner unavailable' : `${m.zh} · ${m.en}`
            }
          >
            <div className="al-modecard__head">
              <span className="al-modecard__icon" aria-hidden="true">
                <Icon size={17} strokeWidth={1.75} />
              </span>
              <span className="al-modecard__titles">
                <span className="al-modecard__title">{m.zh}</span>
                <span className="al-modecard__en">{m.en}</span>
              </span>
            </div>

            <span className="al-modecard__desc">{m.desc}</span>

            <div className="al-readiness">
              <div className="al-readiness__label">
                <span>{m.meterNote}</span>
                <span className={ready ? 'al-readiness__pct--ready' : ''}>{r}%</span>
              </div>
              <ProgressBar value={r} tone={ready ? 'green' : 'gold'} />
            </div>
          </button>
        );
      })}
    </div>
  );
}
