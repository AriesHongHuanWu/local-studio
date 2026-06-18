import { SelectField } from '../../components/primitives';
import type { LanguageOption } from '../../api/types';

export interface LanguageSelectProps {
  languages: LanguageOption[];
  /** null = auto-detect. */
  value: string | null;
  onChange: (code: string | null) => void;
}

const AUTO = '__auto__';

/** Language picker driven by /api/meta languages; Auto + multi supported. */
export function LanguageSelect({ languages, value, onChange }: LanguageSelectProps) {
  return (
    <SelectField
      label="語言 Language"
      value={value ?? AUTO}
      onChange={(e) => onChange(e.target.value === AUTO ? null : e.target.value)}
      hint="Auto 會自動偵測 — 或鎖定一種語言。Auto-detect, or lock a language."
    >
      <option value={AUTO}>自動偵測 · Auto-detect</option>
      {languages.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
      <option value="multi">多語混合 · Multi</option>
    </SelectField>
  );
}
