import type { ReactNode } from 'react';

export interface PillProps {
  children: ReactNode;
  active?: boolean;
  /** Non-interactive display pill. */
  static?: boolean;
  icon?: ReactNode;
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
}

export function Pill({
  children,
  active = false,
  static: isStatic = false,
  icon,
  onClick,
  title,
  disabled = false,
}: PillProps) {
  const cls = [
    'al-pill',
    active ? 'al-pill--active' : '',
    isStatic ? 'al-pill--static' : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (isStatic || !onClick) {
    return (
      <span className={cls} title={title}>
        {icon}
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      title={title}
      disabled={disabled}
      aria-pressed={active}
    >
      {icon}
      {children}
    </button>
  );
}
