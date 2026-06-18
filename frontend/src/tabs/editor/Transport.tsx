import { Pause, Play, Rewind, FastForward } from 'lucide-react';
import { IconButton } from '../../components/primitives';
import { WaveformStrip } from './WaveformStrip';
import { formatClock } from '../../lib/timecode';
import type { PeakData } from '../../lib/waveform';

export interface TransportProps {
  playing: boolean;
  currentTime: number;
  duration: number;
  peaks: PeakData | null;
  onToggle: () => void;
  onSkip: (delta: number) => void;
  onSeek: (time: number) => void;
}

/** Edge-docked transport: play/pause, ±5 s, waveform strip, current/total. */
export function Transport({
  playing,
  currentTime,
  duration,
  peaks,
  onToggle,
  onSkip,
  onSeek,
}: TransportProps) {
  return (
    <div className="al-transport">
      <IconButton label="後退 5 秒 Back 5s" icon={<Rewind size={17} />} onClick={() => onSkip(-5)} />
      <IconButton
        label={playing ? '暫停 Pause' : '播放 Play'}
        icon={playing ? <Pause size={18} /> : <Play size={18} />}
        onClick={onToggle}
        active={playing}
      />
      <IconButton
        label="前進 5 秒 Forward 5s"
        icon={<FastForward size={17} />}
        onClick={() => onSkip(5)}
      />

      <div className="al-transport__wave">
        <WaveformStrip
          peaks={peaks}
          currentTime={currentTime}
          duration={duration}
          onSeek={onSeek}
          height={44}
        />
      </div>

      <span className="al-transport__time">
        {formatClock(currentTime)}
        <span className="sep">/</span>
        {formatClock(duration)}
      </span>
    </div>
  );
}
