export interface ProgressBarProps {
  /** 0..100. Ignored when indeterminate. */
  value?: number;
  indeterminate?: boolean;
  tone?: 'gold' | 'green';
  className?: string;
}

export function ProgressBar({
  value = 0,
  indeterminate = false,
  tone = 'gold',
  className = '',
}: ProgressBarProps) {
  const cls = [
    'al-progress',
    tone === 'green' ? 'al-progress--green' : '',
    indeterminate ? 'al-progress--indeterminate' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cls}
      role="progressbar"
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="al-progress__fill" style={indeterminate ? undefined : { width: `${pct}%` }} />
    </div>
  );
}
