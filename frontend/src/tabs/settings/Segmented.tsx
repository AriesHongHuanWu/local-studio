import type { ReactNode } from 'react';
import { useCallback } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Optional sub-caption under the label (mono, muted). */
  hint?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  /** Accessible group name. */
  label: string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
}

/**
 * A small radiogroup segmented control — the shared shape for the engine
 * and device pickers. Roving arrow-key navigation, gold only on the
 * chosen segment. Tab-local (no shared module owns this).
 */
export function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  const enabled = options.filter((o) => !o.disabled);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (enabled.length === 0) return;
      const idx = enabled.findIndex((o) => o.value === value);
      let next = idx;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % enabled.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
        next = (idx - 1 + enabled.length) % enabled.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = enabled.length - 1;
      else return;
      e.preventDefault();
      const target = enabled[next];
      if (target && target.value !== value) onChange(target.value);
    },
    [enabled, value, onChange],
  );

  return (
    <div
      className="al-seg"
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            type="button"
            key={opt.value}
            role="radio"
            aria-checked={active}
            disabled={opt.disabled}
            tabIndex={active ? 0 : -1}
            className={`al-seg__opt${active ? ' al-seg__opt--active' : ''}`}
            onClick={() => !opt.disabled && onChange(opt.value)}
          >
            <span className="al-seg__label">
              {opt.icon}
              {opt.label}
            </span>
            {opt.hint && <span className="al-seg__hint">{opt.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
