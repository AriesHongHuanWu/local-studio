import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'gold' | 'green' | 'amber' | 'error';

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  /** Show a glowing leading status dot. */
  dot?: boolean;
  title?: string;
}

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: '',
  gold: 'al-badge--gold',
  green: 'al-badge--green',
  amber: 'al-badge--amber',
  error: 'al-badge--error',
};

export function Badge({ children, tone = 'neutral', dot = false, title }: BadgeProps) {
  const cls = ['al-badge', TONE_CLASS[tone], dot ? 'al-badge--dot' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <span className={cls} title={title}>
      {children}
    </span>
  );
}
