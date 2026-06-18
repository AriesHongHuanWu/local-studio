import { useEffect, useRef, useState } from 'react';
import { formatTimecode, parseTimecode } from '../../lib/timecode';

export interface TapeCounterProps {
  /** Time in seconds. */
  value: number;
  /** Small uppercase label (e.g. "START", "DUR"). */
  label?: string;
  /** When provided, the field is editable and commits parsed seconds. */
  onCommit?: (seconds: number) => void;
  /** Render raw text instead of a timecode (e.g. a duration string). */
  display?: string;
  className?: string;
}

/** Recessed glowing mono digit field — shared timecode primitive. */
export function TapeCounter({ value, label, onCommit, display, className = '' }: TapeCounterProps) {
  const editable = typeof onCommit === 'function';
  const [draft, setDraft] = useState<string>(() => formatTimecode(value));
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(formatTimecode(value));
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const parsed = parseTimecode(draft);
    if (parsed !== null && onCommit) onCommit(parsed);
    else setDraft(formatTimecode(value));
  };

  const cls = ['al-tape', editable ? 'al-tape--editable' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={cls}>
      {label && <span className="al-tape__label">{label}</span>}
      {editable ? (
        <input
          ref={inputRef}
          className="al-tape__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setEditing(true)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              setDraft(formatTimecode(value));
              setEditing(false);
              e.currentTarget.blur();
            }
          }}
          spellCheck={false}
          inputMode="numeric"
        />
      ) : (
        <span>{display ?? formatTimecode(value)}</span>
      )}
    </span>
  );
}
