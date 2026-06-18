import { useEffect, useRef, useState } from 'react';
import { decodePeaks, peaksToPath, type PeakData } from '../../lib/waveform';

export interface WaveformThumbProps {
  /** Source song; decoded locally into a bounded peak strip. */
  file: File | null;
  width?: number;
  height?: number;
}

type DecodeState =
  | { kind: 'idle' }
  | { kind: 'decoding' }
  | { kind: 'ready'; path: string; sampleRate: number }
  | { kind: 'error' };

/**
 * A small, bounded, decimated waveform thumbnail for the loaded file card.
 * Decodes peaks off the File (never the whole buffer) and renders a static
 * SVG strip. Falls back to a quiet placeholder while decoding / on failure.
 */
export function WaveformThumb({ file, width = 124, height = 48 }: WaveformThumbProps) {
  const [state, setState] = useState<DecodeState>({ kind: 'idle' });
  // guards stale async results when the file changes mid-decode
  const tokenRef = useRef(0);

  useEffect(() => {
    if (!file) {
      setState({ kind: 'idle' });
      return;
    }
    const token = ++tokenRef.current;
    setState({ kind: 'decoding' });
    let cancelled = false;

    decodePeaks(file, 240)
      .then((data: PeakData) => {
        if (cancelled || token !== tokenRef.current) return;
        const path = peaksToPath(data.peaks, width, height);
        setState({ kind: 'ready', path, sampleRate: data.sampleRate });
      })
      .catch(() => {
        if (cancelled || token !== tokenRef.current) return;
        setState({ kind: 'error' });
      });

    return () => {
      cancelled = true;
    };
  }, [file, width, height]);

  if (state.kind === 'ready') {
    return (
      <svg
        className="al-wavethumb"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        role="presentation"
      >
        <path d={state.path} className="al-wavethumb__fill" />
      </svg>
    );
  }

  return (
    <div
      className={`al-wavethumb al-wavethumb--placeholder${
        state.kind === 'decoding' ? ' al-wavethumb--loading' : ''
      }`}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}
