import { AudioLines } from 'lucide-react';
import { Segmented } from './Segmented';
import type { SegmentedOption } from './Segmented';
import type { Engine } from '../../api/types';

export interface EnginePickerProps {
  engines: Engine[];
  value: Engine;
  onChange: (engine: Engine) => void;
}

const ENGINE_HINT: Record<Engine, string> = {
  whisper: 'faster-whisper · word timestamps',
};

/** Recognition-engine selector. Today whisper is the only engine. */
export function EnginePicker({ engines, value, onChange }: EnginePickerProps) {
  const options: SegmentedOption<Engine>[] = engines.map((eng) => ({
    value: eng,
    label: eng,
    hint: ENGINE_HINT[eng],
    icon: <AudioLines size={14} strokeWidth={1.75} />,
  }));

  return <Segmented<Engine> label="引擎 Engine" value={value} options={options} onChange={onChange} />;
}
