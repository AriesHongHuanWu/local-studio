import { useMemo } from 'react';
import { AlignLeft, Crosshair } from 'lucide-react';
import { TextAreaField } from '../../components/primitives';

export interface ReferenceEditorProps {
  value: string;
  onChange: (text: string) => void;
  /** align = full lyrics expected; biasing = partial is fine. */
  mode: 'biasing' | 'align';
}

/** Full-width serif reference-lyrics editor (line breaks preserved). */
export function ReferenceEditor({ value, onChange, mode }: ReferenceEditorProps) {
  const align = mode === 'align';

  const { lines, chars } = useMemo(() => {
    const trimmed = value.trim();
    return {
      lines: trimmed === '' ? 0 : value.split('\n').filter((l) => l.trim()).length,
      chars: trimmed.length,
    };
  }, [value]);

  const placeholder = align
    ? '貼上完整歌詞，每行一句 — 換行會被保留。\nPaste the full lyrics, one line per phrase — every line break is honoured.'
    : '貼上你記得的片段 — 不必完整。\nPaste whatever fragments you remember — partial is fine.';

  return (
    <div className="al-refeditor">
      <div className="al-refeditor__head">
        <span className="al-refeditor__which">
          {align ? (
            <>
              <Crosshair size={12} strokeWidth={2} /> 完整歌詞 · Full lyrics
            </>
          ) : (
            <>
              <AlignLeft size={12} strokeWidth={2} /> 片段歌詞 · Fragments
            </>
          )}
        </span>
        <span className="al-refeditor__count">
          {lines} 行 lines · {chars} 字 chars
        </span>
      </div>

      <TextAreaField
        serif
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        hint={
          align
            ? '換行有意義 — 每行對齊一句。Line breaks are meaningful; each line aligns as one phrase.'
            : '換行有意義。Line breaks are meaningful.'
        }
        style={{ minHeight: align ? 184 : 148, fontSize: 'var(--al-text-lg)', lineHeight: 1.55 }}
        spellCheck={false}
        aria-label={align ? '完整歌詞 Full lyrics' : '片段歌詞 Fragment lyrics'}
      />
    </div>
  );
}
