/* ──────────────────────────────────────────────────────────────────
   ParametricEQ — the Pro-mode centerpiece. A draggable frequency-response
   curve: drag a band node (freq ↔ x, gain ↔ y), pick its type / Q /
   PHASE (min ↔ linear) / CHANNEL (Stereo/Mid/Side/L/R). The curve updates
   instantly (computed client-side); the backend applies the same bands.
   ────────────────────────────────────────────────────────────────── */

import { useCallback, useMemo, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useT } from '../../../i18n';
import type { EqBand, EqType, EqChannel } from './eqMath';
import { combinedResponse } from './eqMath';

interface Props {
  bands: EqBand[];
  onChange: (bands: EqBand[]) => void;
  sr?: number;
}

const W = 720;
const H = 240;
const PAD = { l: 30, r: 12, t: 10, b: 22 };
const PW = W - PAD.l - PAD.r;
const PH = H - PAD.t - PAD.b;
const FMIN = 20;
const FMAX = 20000;
const DB = 18;
const NPTS = 180;

const TYPES: EqType[] = ['bell', 'low_shelf', 'high_shelf', 'high_pass', 'low_pass', 'notch', 'allpass'];
const CHANNELS: EqChannel[] = ['stereo', 'mid', 'side', 'left', 'right'];
const LA = Math.log10(FMIN);
const LB = Math.log10(FMAX);

const fToX = (f: number) => PAD.l + ((Math.log10(Math.min(FMAX, Math.max(FMIN, f))) - LA) / (LB - LA)) * PW;
const xToF = (x: number) => Math.pow(10, LA + ((x - PAD.l) / PW) * (LB - LA));
const gToY = (g: number) => PAD.t + (1 - (g + DB) / (2 * DB)) * PH;
const yToG = (y: number) => (1 - (y - PAD.t) / PH) * 2 * DB - DB;

const GRID_HZ = [50, 100, 500, 1000, 5000, 10000];
const fmtHz = (f: number) => (f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 0 : 1)}k` : `${Math.round(f)}`);

let _bandSeq = 0;
function newBand(): EqBand {
  _bandSeq += 1;
  return { id: `b${_bandSeq}_${Math.round(performance.now())}`, enabled: true, type: 'bell', freq: 1000, gain: 0, q: 1.0, phase: 'min', channel: 'stereo' };
}

export function ParametricEQ({ bands, onChange, sr = 44100 }: Props) {
  const t = useT();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [sel, setSel] = useState<string | null>(bands[0]?.id ?? null);
  const dragRef = useRef<string | null>(null);

  const freqs = useMemo(() => Array.from({ length: NPTS }, (_, i) => Math.pow(10, LA + (i / (NPTS - 1)) * (LB - LA))), []);
  const curve = useMemo(() => combinedResponse(bands, sr, freqs), [bands, sr, freqs]);
  const curvePts = curve.map((db, i) => `${fToX(freqs[i]).toFixed(1)},${gToY(db).toFixed(1)}`).join(' ');

  const patch = useCallback((id: string, p: Partial<EqBand>) => {
    onChange(bands.map((b) => (b.id === id ? { ...b, ...p } : b)));
  }, [bands, onChange]);

  const svgPoint = useCallback((clientX: number, clientY: number) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: ((clientX - r.left) / r.width) * W, y: ((clientY - r.top) / r.height) * H };
  }, []);

  const onNodeDown = useCallback((e: React.PointerEvent, id: string) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = id;
    setSel(id);
  }, []);

  const onMove = useCallback((e: React.PointerEvent) => {
    const id = dragRef.current;
    if (!id) return;
    const { x, y } = svgPoint(e.clientX, e.clientY);
    const f = Math.min(FMAX, Math.max(FMIN, xToF(x)));
    const g = Math.min(DB, Math.max(-DB, yToG(y)));
    const band = bands.find((b) => b.id === id);
    const gainType = band && ['bell', 'low_shelf', 'high_shelf'].includes(band.type);
    patch(id, gainType ? { freq: Math.round(f), gain: Math.round(g * 10) / 10 } : { freq: Math.round(f) });
  }, [bands, patch, svgPoint]);

  const onUp = useCallback(() => { dragRef.current = null; }, []);

  const add = useCallback(() => {
    const b = newBand();
    onChange([...bands, b]);
    setSel(b.id);
  }, [bands, onChange]);

  const remove = useCallback((id: string) => {
    const next = bands.filter((b) => b.id !== id);
    onChange(next);
    setSel(next[0]?.id ?? null);
  }, [bands, onChange]);

  const selBand = bands.find((b) => b.id === sel) ?? null;

  return (
    <div className="al-peq">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="al-peq__svg" onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
        {[-12, -6, 0, 6, 12].map((d) => (
          <g key={d}>
            <line x1={PAD.l} y1={gToY(d)} x2={PAD.l + PW} y2={gToY(d)} className={d === 0 ? 'al-peq__zero' : 'al-peq__grid'} />
            <text x={PAD.l - 4} y={gToY(d) + 3} className="al-peq__axis" textAnchor="end">{d > 0 ? `+${d}` : d}</text>
          </g>
        ))}
        {GRID_HZ.map((f) => (
          <g key={f}>
            <line x1={fToX(f)} y1={PAD.t} x2={fToX(f)} y2={PAD.t + PH} className="al-peq__grid" />
            <text x={fToX(f)} y={H - 6} className="al-peq__axis" textAnchor="middle">{fmtHz(f)}</text>
          </g>
        ))}
        <polyline points={curvePts} className="al-peq__curve" fill="none" />
        {bands.map((b) => {
          const gy = ['bell', 'low_shelf', 'high_shelf'].includes(b.type) ? gToY(b.gain) : gToY(0);
          return (
            <circle
              key={b.id}
              cx={fToX(b.freq)} cy={gy} r={sel === b.id ? 7 : 5}
              className={`al-peq__node${sel === b.id ? ' al-peq__node--sel' : ''}${b.enabled ? '' : ' al-peq__node--off'}`}
              onPointerDown={(e) => onNodeDown(e, b.id)}
              onClick={() => setSel(b.id)}
            />
          );
        })}
      </svg>

      <div className="al-peq__bar">
        <button type="button" className="al-peq__add" onClick={add}><Plus size={13} /> {t('master.peq.add')}</button>
        <span className="al-peq__count">{t('master.peq.bands', { n: String(bands.filter((b) => b.enabled).length) })}</span>
      </div>

      {selBand && (
        <div className="al-peq__ctrls">
          <label className="al-peq__field">
            <span>{t('master.peq.type')}</span>
            <select value={selBand.type} onChange={(e) => patch(selBand.id, { type: e.target.value as EqType })}>
              {TYPES.map((ty) => <option key={ty} value={ty}>{t(`master.peq.t.${ty}`)}</option>)}
            </select>
          </label>
          <label className="al-peq__field">
            <span>{t('master.peq.freq')}</span>
            <input type="number" min={20} max={20000} value={Math.round(selBand.freq)}
                   onChange={(e) => patch(selBand.id, { freq: Number(e.target.value) })} />
          </label>
          <label className="al-peq__field">
            <span>{t('master.peq.gain')}</span>
            <input type="number" min={-18} max={18} step={0.5}
                   disabled={!['bell', 'low_shelf', 'high_shelf'].includes(selBand.type)}
                   value={selBand.gain} onChange={(e) => patch(selBand.id, { gain: Number(e.target.value) })} />
          </label>
          <label className="al-peq__field">
            <span>{t('master.peq.q')}</span>
            <input type="number" min={0.1} max={18} step={0.1} value={selBand.q}
                   onChange={(e) => patch(selBand.id, { q: Number(e.target.value) })} />
          </label>
          <label className="al-peq__field">
            <span>{t('master.peq.phase')}</span>
            <div className="al-peq__seg">
              <button type="button" className={selBand.phase === 'min' ? 'on' : ''} onClick={() => patch(selBand.id, { phase: 'min' })}>{t('master.peq.min')}</button>
              <button type="button" className={selBand.phase === 'linear' ? 'on' : ''} onClick={() => patch(selBand.id, { phase: 'linear' })}>{t('master.peq.linear')}</button>
            </div>
          </label>
          <label className="al-peq__field">
            <span>{t('master.peq.channel')}</span>
            <select value={selBand.channel} onChange={(e) => patch(selBand.id, { channel: e.target.value as EqChannel })}>
              {CHANNELS.map((c) => <option key={c} value={c}>{t(`master.peq.ch.${c}`)}</option>)}
            </select>
          </label>
          <button type="button" className="al-peq__del" onClick={() => remove(selBand.id)} aria-label={t('master.peq.remove')}>
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

export { newBand };
