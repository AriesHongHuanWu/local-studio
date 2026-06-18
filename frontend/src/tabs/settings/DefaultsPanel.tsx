import { Globe, Languages, Layers, Scissors, SlidersHorizontal } from 'lucide-react';
import { Pill, SelectField } from '../../components/primitives';
import type { ExportFormat, JobMode, LanguageOption, ModelSize } from '../../api/types';

export interface DefaultsValue {
  modelSize: ModelSize;
  language: string | null;
  mode: JobMode;
  exportFormat: ExportFormat;
  separate: boolean;
}

export interface DefaultsPanelProps {
  value: DefaultsValue;
  languages: LanguageOption[];
  modelSizes: ModelSize[];
  /** From meta — gate Demucs + Forced-Align when unavailable. */
  demucsAvailable: boolean;
  alignerAvailable: boolean;
  onChange: (patch: Partial<DefaultsValue>) => void;
}

const AUTO = '__auto__';

const MODE_LABEL: Record<JobMode, string> = {
  auto: 'Auto · 純辨識',
  biasing: 'Biasing · 提示',
  align: 'Forced-Align · 對齊',
};

const FMT_LABEL: Record<ExportFormat, string> = {
  lrc: 'LRC',
  srt: 'SRT',
  ass: 'ASS karaoke',
  json: 'JSON',
};

/**
 * Default language / mode / export format (+ Demucs default) persisted by
 * the caller to localStorage. These seed the Transcribe/Export forms — so
 * the most common run never needs re-picking.
 */
export function DefaultsPanel({
  value,
  languages,
  modelSizes,
  demucsAvailable,
  alignerAvailable,
  onChange,
}: DefaultsPanelProps) {
  return (
    <div className="al-defaults">
      <div className="al-settings__grid">
        <SelectField
          label="預設模型 Default model"
          hint="新工作預先選好的大小"
          value={value.modelSize}
          onChange={(e) => onChange({ modelSize: e.target.value as ModelSize })}
        >
          {modelSizes.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </SelectField>

        <SelectField
          label="預設語言 Default language"
          hint="留空則自動偵測"
          value={value.language ?? AUTO}
          onChange={(e) =>
            onChange({ language: e.target.value === AUTO ? null : e.target.value })
          }
        >
          <option value={AUTO}>Auto-detect · 自動偵測</option>
          {languages.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </SelectField>

        <SelectField
          label="預設模式 Default mode"
          hint="辨識頁開啟時的起手式"
          value={value.mode}
          onChange={(e) => onChange({ mode: e.target.value as JobMode })}
        >
          <option value="auto">{MODE_LABEL.auto}</option>
          <option value="biasing">{MODE_LABEL.biasing}</option>
          <option value="align" disabled={!alignerAvailable}>
            {MODE_LABEL.align}
            {!alignerAvailable ? ' (無對齊器)' : ''}
          </option>
        </SelectField>

        <SelectField
          label="預設匯出 Default export"
          hint="匯出頁的起始格式"
          value={value.exportFormat}
          onChange={(e) => onChange({ exportFormat: e.target.value as ExportFormat })}
        >
          {(Object.keys(FMT_LABEL) as ExportFormat[]).map((f) => (
            <option key={f} value={f}>
              {FMT_LABEL[f]}
            </option>
          ))}
        </SelectField>
      </div>

      <div className="al-defaults__toggle">
        <Pill
          active={value.separate}
          icon={<Scissors size={13} />}
          onClick={() => demucsAvailable && onChange({ separate: !value.separate })}
          disabled={!demucsAvailable}
          title={
            demucsAvailable
              ? '新工作預設先用 Demucs 分離人聲'
              : '此機未提供 Demucs separation'
          }
        >
          預設分離人聲 · Default to Demucs separation
        </Pill>
        {!demucsAvailable && (
          <span className="al-defaults__gate">此機未安裝 Demucs · unavailable</span>
        )}
      </div>

      <ul className="al-defaults__legend" aria-hidden="true">
        <li>
          <SlidersHorizontal size={12} /> 預設值會自動帶入辨識與匯出頁
        </li>
        <li>
          <Languages size={12} /> 語言
        </li>
        <li>
          <Layers size={12} /> 模式
        </li>
        <li>
          <Globe size={12} /> 全部留在本機
        </li>
      </ul>
    </div>
  );
}
