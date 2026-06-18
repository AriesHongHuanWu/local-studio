import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef } from 'react';

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Absolute position relative to the nearest positioned ancestor. */
  style?: CSSProperties;
  className?: string;
  /** Accessible name for the dialog (required for SR conformance). */
  label?: string;
  /** ...or reference an existing label element by id. */
  labelledby?: string;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Positioned modal popover: dialog semantics, focus trap, focus restore, Esc. */
export function Popover({
  open,
  onClose,
  children,
  style,
  className = '',
  label,
  labelledby,
}: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // On open: remember the opener, move focus inside. On close: restore focus.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = (document.activeElement as HTMLElement) ?? null;
    const panel = panelRef.current;
    if (panel) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel).focus();
    }
    return () => {
      restoreRef.current?.focus?.();
    };
  }, [open]);

  // Trap Tab / Shift+Tab within the panel while open.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
    if (items.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const activeEl = document.activeElement;
    if (e.shiftKey && (activeEl === first || activeEl === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && activeEl === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;
  return (
    <>
      <div className="al-popover__backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className={`al-popover ${className}`}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-label={labelledby ? undefined : label}
        aria-labelledby={labelledby}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </>
  );
}
