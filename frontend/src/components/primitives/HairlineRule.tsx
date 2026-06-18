export interface HairlineRuleProps {
  strong?: boolean;
  vertical?: boolean;
  className?: string;
}

/** The only "border" in the system — a single hairline at ~7% warm-white. */
export function HairlineRule({ strong = false, vertical = false, className = '' }: HairlineRuleProps) {
  const cls = [
    'al-hairline',
    strong ? 'al-hairline--strong' : '',
    vertical ? 'al-hairline--vertical' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return <hr className={cls} aria-hidden="true" />;
}
