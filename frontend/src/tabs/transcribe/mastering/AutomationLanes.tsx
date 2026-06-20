/* ──────────────────────────────────────────────────────────────────
   AutomationLanes — DAW-style EQ automation. Each lane is an RBJ
   peaking bell at a chosen frequency whose gain is drawn as a curve
   over the song (x = time, y = gain dB). Drag points, click to add,
   double-click to remove. Multiple lanes; one selected/editable.

   Point times are stored NORMALIZED (0..1 of song length) so they map
   to the correct position regardless of the decoder's reported length;
   the duration prop is used only to label the time axis.
   ────────────────────────────────────────────────────────────────── */

import { useRef, useState } from 'react';
import { useT } from '../../../i18n';

export interface AutoLane {
  freq: number;
  q: number;
  points: [number, number][]; // [timeNorm 0..1, gainDb], sorted by time
}

export function newLane(): AutoLane {
  return { freq: 3000, q: 1.5, points: [[0, 0], [1, 0]] };
}

/** Serialize to backend (normalized times); drop flat lanes (no audible automation). */
export function toBackendAutomation(lanes: AutoLane[]): string {
  return JSON.stringify(
    lanes
      .filter((l) => l.points.some((p) => Math.abs(p[1]) > 0.05))
      .map((l) => ({ freq: l.freq, q: l.q, points: l.points })),
  );
}

export function hasAutomation(lanes: AutoLane[]): boolean {
  return lanes.some((l) => l.points.some((p) => Math.abs(p[1]) > 0.05));
}

const W = 600;
const H = 200;
const PAD = { l: 34, r: 10, t: 12, b: 20 };
const PW = W - PAD.l - PAD.r;
const PH = H - PAD.t - PAD.b;
const GAIN = 12; // ± dB shown

const LANE_COLORS = ['var(--al-accent)', '#e8a33d', '#3db1e8', '#c069e0', '#5fc77e'];
const MAX_LANES = 5;

interface Props {
  lanes: AutoLane[];
  duration: number; // seconds — for axis labels only
  onChange: (lanes: AutoLane[]) => void;
  disabled?: boolean;
}

export function AutomationLanes({ lanes, duration, onChange, disabled }: Props) {
  const t = useT();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [sel, setSel] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const dur = Math.max(1, duration || 1);

  const tx = (tn: number) => PAD.l + tn * PW; // tn normalized 0..1
  const ty = (db: number) => PAD.t + (1 - (db + GAIN) / (2 * GAIN)) * PH;
  const xToT = (px: number) => Math.min(1, Math.max(0, (px - PAD.l) / PW));
  const gainAt = (py: number) => {
    const g = (1 - (py - PAD.t) / PH) * (2 * GAIN) - GAIN;
    return Math.min(GAIN, Math.max(-GAIN, g));
  };

  const toLocal = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { px: ((e.clientX - r.left) / r.width) * W, py: ((e.clientY - r.top) / r.height) * H };
  };

  const setLane = (i: number, patch: Partial<AutoLane>) =>
    onChange(lanes.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const onPointDown = (e: React.PointerEvent, idx: number) => {
    if (disabled) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag(idx);
  };
  const onMove = (e: React.PointerEvent) => {
    if (drag === null || disabled) return;
    const { px, py } = toLocal(e);
    const pts = lanes[sel].points.slice();
    // endpoints re-anchor to 0 and 1 (so they can't get stuck off the timeline).
    const tn = drag === 0 ? 0 : drag === pts.length - 1 ? 1 : xToT(px);
    pts[drag] = [tn, Math.round(gainAt(py) * 10) / 10];
    onChange(lanes.map((l, j) => (j === sel ? { ...l, points: pts } : l)));
  };
  const onUp = () => setDrag(null);

  const onCanvasDown = (e: React.PointerEvent) => {
    if (disabled || drag !== null) return;
    const { px, py } = toLocal(e);
    // only inside the plot rectangle
    if (px < PAD.l || px > W - PAD.r || py < PAD.t || py > H - PAD.b) return;
    // ignore near-misses on an existing node (let the node's own handler drag it).
    if (lanes[sel].points.some((p) => Math.hypot(tx(p[0]) - px, ty(p[1]) - py) < 10)) return;
    const np: [number, number] = [Math.round(xToT(px) * 1000) / 1000, Math.round(gainAt(py) * 10) / 10];
    setLane(sel, { points: [...lanes[sel].points, np].sort((a, b) => a[0] - b[0]) });
  };
  const removePoint = (i: number, pi: number) => {
    if (lanes[i].points.length <= 2 || disabled) return;
    setLane(i, { points: lanes[i].points.filter((_, j) => j !== pi) });
  };

  const addLane = () => {
    if (lanes.length >= MAX_LANES) return;
    onChange([...lanes, newLane()]);
    setSel(lanes.length);
  };
  const removeLane = (i: number) => {
    if (lanes.length <= 1) return;
    onChange(lanes.filter((_, j) => j !== i));
    setSel(Math.max(0, Math.min(sel, lanes.length - 2)));
  };

  const fmtFreq = (hz: number) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz % 1000 ? 1 : 0)}k` : `${Math.round(hz)}`);
  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  return (
    <div className="al-auto">
      <div className="al-auto__lanes">
        {lanes.map((l, i) => (
          <button
            key={i}
            type="button"
            className={`al-auto__lanechip${i === sel ? ' al-auto__lanechip--on' : ''}`}
            onClick={() => setSel(i)}
            disabled={disabled}
          >
            <span className="al-auto__dot" style={{ background: LANE_COLORS[i % LANE_COLORS.length] }} />
            {fmtFreq(l.freq)} Hz
          </button>
        ))}
        <button type="button" className="al-auto__add" onClick={addLane} disabled={disabled || lanes.length >= MAX_LANES}>
          {t('master.auto.add')}
        </button>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="al-auto__svg"
        onPointerDown={onCanvasDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
      >
        {[-12, -6, 0, 6, 12].map((db) => (
          <g key={db}>
            <line x1={PAD.l} y1={ty(db)} x2={W - PAD.r} y2={ty(db)} className={db === 0 ? 'al-auto__zero' : 'al-auto__grid'} />
            <text x={4} y={ty(db) + 3} className="al-auto__axis">{db > 0 ? `+${db}` : db}</text>
          </g>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <text key={f} x={tx(f)} y={H - 6} className="al-auto__axis" textAnchor="middle">{fmtTime(f * dur)}</text>
        ))}

        {lanes.map((l, i) =>
          i === sel ? null : (
            <polyline
              key={i}
              points={l.points.map((p) => `${tx(p[0])},${ty(p[1])}`).join(' ')}
              className="al-auto__line al-auto__line--dim"
              style={{ stroke: LANE_COLORS[i % LANE_COLORS.length] }}
            />
          ),
        )}
        {lanes[sel] && (
          <>
            <polyline
              points={lanes[sel].points.map((p) => `${tx(p[0])},${ty(p[1])}`).join(' ')}
              className="al-auto__line"
              style={{ stroke: LANE_COLORS[sel % LANE_COLORS.length] }}
            />
            {lanes[sel].points.map((p, pi) => (
              <circle
                key={pi}
                cx={tx(p[0])}
                cy={ty(p[1])}
                r={5}
                className="al-auto__node"
                style={{ fill: LANE_COLORS[sel % LANE_COLORS.length] }}
                onPointerDown={(e) => onPointDown(e, pi)}
                onDoubleClick={() => removePoint(sel, pi)}
              />
            ))}
          </>
        )}
      </svg>

      {lanes[sel] && (
        <div className="al-auto__ctrls">
          <label className="al-auto__field">
            <span>{t('master.auto.freq')}</span>
            <input type="number" min={20} max={20000} step={10} value={Math.round(lanes[sel].freq)}
              disabled={disabled} onChange={(e) => setLane(sel, { freq: Number(e.target.value) })} />
          </label>
          <label className="al-auto__field">
            <span>Q</span>
            <input type="number" min={0.1} max={12} step={0.1} value={lanes[sel].q}
              disabled={disabled} onChange={(e) => setLane(sel, { q: Number(e.target.value) })} />
          </label>
          <span className="al-auto__tip">{t('master.auto.tip')}</span>
          {lanes.length > 1 && (
            <button type="button" className="al-auto__rm" onClick={() => removeLane(sel)} disabled={disabled}>
              {t('master.auto.remove')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
