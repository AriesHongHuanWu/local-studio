import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible label — required (icon-only button). */
  label: string;
  icon: ReactNode;
  active?: boolean;
  size?: 'sm' | 'md';
}

export function IconButton({
  label,
  icon,
  active = false,
  size = 'md',
  className = '',
  type = 'button',
  ...rest
}: IconButtonProps) {
  const cls = [
    'al-iconbtn',
    active ? 'al-iconbtn--active' : '',
    size === 'sm' ? 'al-iconbtn--sm' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={cls} aria-label={label} title={label} {...rest}>
      {icon}
    </button>
  );
}
