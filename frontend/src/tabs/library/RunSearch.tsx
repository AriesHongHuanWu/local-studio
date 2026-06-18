import { Search, X } from 'lucide-react';

export interface RunSearchProps {
  value: string;
  onChange: (value: string) => void;
  /** Number of matches currently shown (rendered as a quiet mono count). */
  count: number;
  /** Total runs available (so "3 / 12" reads honestly). */
  total: number;
}

/**
 * RunSearch — filter the run history by name / mode / language.
 * Quiet, single-line. A clear button appears once there's a query.
 */
export function RunSearch({ value, onChange, count, total }: RunSearchProps) {
  const filtering = value.trim().length > 0;
  return (
    <div className="al-runsearch" role="search">
      <Search size={15} className="al-runsearch__icon" aria-hidden="true" />
      <input
        type="search"
        className="al-runsearch__input"
        placeholder="搜尋名稱 / 模式 / 語言 — Search name, mode, language"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="搜尋紀錄 Search runs"
        spellCheck={false}
        autoComplete="off"
      />
      <span className="al-runsearch__count" aria-live="polite">
        {filtering ? `${count} / ${total}` : `${total}`}
      </span>
      {filtering && (
        <button
          type="button"
          className="al-runsearch__clear"
          onClick={() => onChange('')}
          aria-label="清除搜尋 Clear search"
          title="清除 Clear"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
