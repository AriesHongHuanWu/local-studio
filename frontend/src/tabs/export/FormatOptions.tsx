import type { ReactNode } from 'react';
import { Pill } from '../../components/primitives';
import type { ExportLevel } from '../../api/types';
import {
  capabilitiesFor,
  type AssSweepStyle,
  type Encoding,
  type ExportConfig,
} from './exportOptions';

export interface FormatOptionsProps {
  config: ExportConfig;
  onChange: (patch: Partial<ExportConfig>) => void;
}

interface SegRowProps {
  label: string;
  hint?: string;
  children: ReactNode;
}

function OptionRow({ label, hint, children }: SegRowProps) {
  return (
    <div className="al-optrow">
      <div className="al-optrow__label">
        <span>{label}</span>
        {hint && <span className="al-optrow__hint">{hint}</span>}
      </div>
      <div className="al-optrow__controls">{children}</div>
    </div>
  );
}

/** Per-format options — only the groups meaningful to the format are shown. */
export function FormatOptions({ config, onChange }: FormatOptionsProps) {
  const caps = capabilitiesFor(config.fmt);

  return (
    <div className="al-options">
      {caps.level && (
        <OptionRow label="層級 Level">
          <Pill
            active={config.level === 'line'}
            onClick={() => onChange({ level: 'line' as ExportLevel })}
            title="一行一個時間標記 One stamp per line"
          >
            逐行 Line
          </Pill>
          <Pill
            active={config.level === 'word'}
            onClick={() => onChange({ level: 'word' as ExportLevel })}
            title="每字一個時間標記 Per-word stamps"
          >
            逐字 Word
          </Pill>
        </OptionRow>
      )}

      {caps.sweep && (
        <OptionRow label="掃動 Sweep" hint="preview only">
          {(
            [
              ['gradient', '漸層 Gradient'],
              ['wipe', '抹過 Wipe'],
              ['fill', '填滿 Fill'],
            ] as [AssSweepStyle, string][]
          ).map(([key, lbl]) => (
            <Pill
              key={key}
              active={config.assSweep === key}
              onClick={() => onChange({ assSweep: key })}
            >
              {lbl}
            </Pill>
          ))}
        </OptionRow>
      )}

      {caps.precision && (
        <OptionRow label="精度 Precision">
          <Pill
            active={!config.precisionMs}
            onClick={() => onChange({ precisionMs: false })}
            title="百分之一秒 Centisecond (native LRC/ASS)"
          >
            10 ms · cs
          </Pill>
          <Pill
            active={config.precisionMs}
            onClick={() => onChange({ precisionMs: true })}
            title="毫秒 Millisecond"
          >
            1 ms
          </Pill>
        </OptionRow>
      )}

      {caps.encoding && (
        <OptionRow label="編碼 Encoding">
          {(
            [
              ['utf-8', 'UTF-8'],
              ['utf-8-bom', 'UTF-8 BOM'],
            ] as [Encoding, string][]
          ).map(([key, lbl]) => (
            <Pill
              key={key}
              active={config.encoding === key}
              onClick={() => onChange({ encoding: key })}
              title={
                key === 'utf-8-bom'
                  ? '加上 BOM — 部分舊播放器需要 Adds a BOM for legacy players'
                  : '純 UTF-8'
              }
            >
              {lbl}
            </Pill>
          ))}
        </OptionRow>
      )}
    </div>
  );
}
