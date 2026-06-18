import { Cpu, Sparkles, Wand2 } from 'lucide-react';
import { Segmented } from './Segmented';
import type { SegmentedOption } from './Segmented';
import type { Device } from '../../api/types';

export interface DevicePickerProps {
  value: Device;
  onChange: (device: Device) => void;
  /** From meta.gpu — GPU option disables when no CUDA device is present. */
  gpuAvailable: boolean;
}

/**
 * Compute-device selector: Auto / GPU (CUDA) / CPU. The GPU segment is
 * gated on `meta.gpu`; Auto prefers GPU when one exists, else CPU.
 */
export function DevicePicker({ value, onChange, gpuAvailable }: DevicePickerProps) {
  const options: SegmentedOption<Device>[] = [
    {
      value: 'auto',
      label: 'Auto',
      hint: gpuAvailable ? '優先 GPU prefer GPU' : '退回 CPU falls to CPU',
      icon: <Wand2 size={14} strokeWidth={1.75} />,
    },
    {
      value: 'cuda',
      label: 'GPU',
      hint: gpuAvailable ? 'CUDA · 最快 fastest' : '無 GPU no device',
      icon: <Sparkles size={14} strokeWidth={1.75} />,
      disabled: !gpuAvailable,
    },
    {
      value: 'cpu',
      label: 'CPU',
      hint: '相容 compatible',
      icon: <Cpu size={14} strokeWidth={1.75} />,
    },
  ];

  return <Segmented<Device> label="運算裝置 Device" value={value} options={options} onChange={onChange} />;
}
