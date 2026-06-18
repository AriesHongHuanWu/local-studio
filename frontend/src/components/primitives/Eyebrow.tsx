import type { ReactNode } from 'react';

export interface EyebrowProps {
  /** Optional section number (rendered in gold). */
  num?: string | number;
  children: ReactNode;
  /** Draw a trailing hairline that fills remaining width. */
  rule?: boolean;
}

/** Mono caps + tracking section label — quiet scaffolding for columns. */
export function Eyebrow({ num, children, rule = true }: EyebrowProps) {
  return (
    <div className="al-eyebrow">
      {num !== undefined && <span className="al-eyebrow__num">{String(num).padStart(2, '0')}</span>}
      <span>{children}</span>
      {rule && <span className="al-eyebrow__line" />}
    </div>
  );
}
