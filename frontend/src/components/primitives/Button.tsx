import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon (e.g. a lucide-react element). */
  icon?: ReactNode;
  children?: ReactNode;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  default: '',
  primary: 'al-btn--primary',
  ghost: 'al-btn--ghost',
  danger: 'al-btn--danger',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'al-btn--sm',
  md: '',
  lg: 'al-btn--lg',
};

export function Button({
  variant = 'default',
  size = 'md',
  icon,
  children,
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  const cls = ['al-btn', VARIANT_CLASS[variant], SIZE_CLASS[size], className]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={cls} {...rest}>
      {icon}
      {children}
    </button>
  );
}
