import { useCallback, useMemo, useRef, useState } from 'react';
import type { PeakData } from '../../lib/waveform';
import { peaksToPath, visibleWindow } from '../../lib/waveform';
import { magnetize } from '../../lib/onset';
import type { Onset } from '../../lib/onset';
import { formatTimecode } from '../../lib/timecode';

export interface BoundaryMarker {
  id: 'start' | 'end';
  /** Absolute time in seconds. */
  time: number;
  /** Commit a (possibly magnetized) time as the user drags / releases. */
  onChange: (time: number) => void;
}

export interface WaveformStripProps {
  peaks: PeakData | null;
  currentTime: number;
  duration: number;
  /** Seek on click/scrub (suppressed while dragging a boundary handle). */
  onSeek: (time: number) => void;
  height?: number;
  /** Render only a time slice [windowStart, windowEnd] (inspector mini-wave). */
  windowStart?: number;
  windowEnd?: number;
  /** Draggable word-boundary handles (inspector retiming). */
  markers?: BoundaryMarker[];
  /** Onsets for magnetize-on-release. */
  onsets?: Onset[];
  /** Magnetize snap window in seconds. */
  magnetWindow?: number;
}

/**
 * Bounded, decimated waveform with a gold playhead. Click to seek; optionally
 * render draggable word-boundary handles that magnetize to the nearest vocal
 * onset on release (grab-the-word retiming) over a hairline waveform slice.
 */
export function WaveformStrip({
  peaks,
  currentTime,
  duration,
  onSeek,
  height = 64,
  windowStart,
  windowEnd,
  markers,
  onsets,
  magnetWindow = 0.08,
}: WaveformStripProps) {
  const ref = useRef<HTMLDivElement>(null);
  const W = 1000; // viewBox width; SVG scales to container
  const dur = duration || peaks?.duration || 0;

  // Windowed view (inspector) vs full strip (transport).
  const win = useMemo(() => {
    const hasWindow =
      typeof windowStart === 'number' && typeof windowEnd === 'number' && windowEnd > windowStart;
    const start = hasWindow ? Math.max(0, windowStart!) : 0;
    const end = hasWindow ? Math.min(dur || windowEnd!, windowEnd!) : dur;
    return { start, end: Math.max(start + 0.001, end), windowed: hasWindow };
  }, [windowStart, windowEnd, dur]);

  const path = useMemo(() => {
    if (!peaks) return '';
    const slice = win.windowed ? visibleWindow(peaks, win.start, win.end) : peaks.peaks;
    return peaksToPath(slice, W, height);
  }, [peaks, height, win]);

  /** Map an absolute time → fraction across the current view. */
  const timeToPct = useCallback(
    (t: number) => {
      const span = win.end - win.start;
      if (span <= 0) return 0;
      return Math.max(0, Math.min(1, (t - win.start) / span));
    },
    [win],
  );

  /** Map a clientX → absolute time within the current view. */
  const xToTime = useCallback(
    (clientX: number): number => {
      const el = ref.current;
      if (!el) return win.start;
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return win.start + ratio * (win.end - win.start);
    },
    [win],
  );

  const pct = timeToPct(currentTime);
  const showPlayhead =
    !win.windowed || (currentTime >= win.start - 0.001 && currentTime <= win.end + 0.001);

  // ── Boundary-handle drag with onset magnetize ─────────────────────────
  const [drag, setDrag] = useState<{
    id: 'start' | 'end';
    time: number;
    snapped: boolean;
  } | null>(null);
  const dragRef = useRef<{ id: 'start' | 'end'; onChange: (t: number) => void } | null>(null);

  const beginDrag = (marker: BoundaryMarker, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { id: marker.id, onChange: marker.onChange };
    setDrag({ id: marker.id, time: marker.time, snapped: false });
  };

  const moveDrag = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const raw = xToTime(e.clientX);
    const snapTo = onsets ? magnetize(onsets, raw, magnetWindow) : raw;
    const snapped = onsets ? Math.abs(snapTo - raw) > 1e-6 : false;
    setDrag({ id: dragRef.current.id, time: snapTo, snapped });
    dragRef.current.onChange(snapTo);
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
    setDrag(null);
  };

  const isDragging = drag !== null;

  return (
    <div
      ref={ref}
      className={`al-wavestrip ${win.windowed ? 'al-wavestrip--mini' : ''}`}
      style={{ height }}
      onClick={(e) => {
        if (isDragging) return;
        onSeek(xToTime(e.clientX));
      }}
      role="slider"
      aria-label="波形時間軸 Waveform seek"
      aria-valuemin={Math.round(win.start)}
      aria-valuemax={Math.round(win.end)}
      aria-valuenow={Math.round(currentTime)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          onSeek(Math.min(dur, currentTime + 5));
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          onSeek(Math.max(0, currentTime - 5));
        }
      }}
    >
      <svg
        className="al-wavestrip__svg"
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {path ? (
          <path d={path} className="al-wavestrip__peaks" />
        ) : (
          <line
            x1={0}
            y1={height / 2}
            x2={W}
            y2={height / 2}
            stroke="var(--al-hairline-strong)"
            strokeWidth={1}
          />
        )}
        {showPlayhead && (
          <rect x={0} y={0} width={W * pct} height={height} fill="var(--al-gold-glow)" />
        )}
        {/* onset-magnetize flash on the snapped boundary */}
        {drag?.snapped && (
          <rect
            className="al-wavestrip__flash"
            x={Math.max(0, W * timeToPct(drag.time) - 6)}
            y={0}
            width={12}
            height={height}
          />
        )}
      </svg>

      {showPlayhead && (
        <div className="al-wavestrip__playhead" style={{ left: `${pct * 100}%` }} />
      )}

      {/* draggable boundary handles (inspector) */}
      {markers?.map((m) => {
        const live = isDragging && drag?.id === m.id ? drag.time : m.time;
        const nudgeBoundary = (e: React.KeyboardEvent, steps: number) => {
          // Coarse step on Shift; clamp inside the rendered window.
          const delta = (e.shiftKey ? 0.1 : 0.01) * steps;
          const next = Math.max(win.start, Math.min(win.end, m.time + delta));
          m.onChange(next);
        };
        return (
          <div
            key={m.id}
            className={`al-wavestrip__handle al-wavestrip__handle--${m.id} ${
              drag?.id === m.id ? 'is-dragging' : ''
            } ${drag?.id === m.id && drag.snapped ? 'is-snapped' : ''}`}
            style={{ left: `${timeToPct(live) * 100}%` }}
            role="slider"
            aria-label={m.id === 'start' ? '起點邊界 Start boundary' : '終點邊界 End boundary'}
            aria-valuemin={Math.round(win.start * 1000)}
            aria-valuemax={Math.round(win.end * 1000)}
            aria-valuenow={Math.round(live * 1000)}
            aria-valuetext={formatTimecode(live)}
            tabIndex={0}
            onPointerDown={(e) => beginDrag(m, e)}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={(e) => {
              // Nudge the boundary; never let the parent's 5 s seek also fire.
              if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                e.preventDefault();
                e.stopPropagation();
                nudgeBoundary(e, 1);
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                e.preventDefault();
                e.stopPropagation();
                nudgeBoundary(e, -1);
              }
            }}
          >
            <span className="al-wavestrip__handle-grip" />
          </div>
        );
      })}

      {/* floating tape readout while dragging a boundary */}
      {drag && (
        <div
          className="al-wavestrip__tape"
          style={{ left: `${timeToPct(drag.time) * 100}%` }}
        >
          {formatTimecode(drag.time)}
        </div>
      )}
    </div>
  );
}
