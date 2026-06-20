/* ──────────────────────────────────────────────────────────────────
   MultibandPanel — Pro manual multiband compressor. N bands split by
   user crossover frequencies, each with its own threshold / ratio /
   attack / release / knee / makeup + Mid-Side routing + stereo width.
   ────────────────────────────────────────────────────────────────── */

import { useT } from '../../../i18n';

export interface MbBand {
  threshold: number; // dB
  ratio: number; // :1
  attack: number; // ms
  release: number; // ms
  knee: number; // dB
  makeup: number; // dB
  width: number; // ×  (1 = unchanged, 0 = mono, >1 wider)
  ms: boolean; // compress Mid/Side separately
  bypass: boolean;
}

export function newMbBand(): MbBand {
  return { threshold: -24, ratio: 2, attack: 20, release: 150, knee: 6, makeup: 0, width: 1, ms: false, bypass: false };
}

/** Default 3-band layout (low / mid / high). */
export function defaultMultiband(): { crossovers: number[]; bands: MbBand[] } {
  return { crossovers: [120, 2000], bands: [newMbBand(), newMbBand(), newMbBand()] };
}

/** Serialize to the backend shape (a JSON string is appended to the form). */
export function toBackendMultiband(crossovers: number[], bands: MbBand[]): string {
  return JSON.stringify({
    crossovers,
    bands: bands.map((b) => ({
      threshold: b.threshold, ratio: b.ratio, attack: b.attack, release: b.release,
      knee: b.knee, makeup: b.makeup, width: b.width, ms: b.ms, bypass: b.bypass,
    })),
  });
}

const MAX_BANDS = 5;
const MIN_BANDS = 2;

interface Props {
  crossovers: number[];
  bands: MbBand[];
  onChange: (crossovers: number[], bands: MbBand[]) => void;
  disabled?: boolean;
}

export function MultibandPanel({ crossovers, bands, onChange, disabled }: Props) {
  const t = useT();

  const setBand = (i: number, patch: Partial<MbBand>) => {
    onChange(crossovers, bands.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  };
  const setCrossover = (i: number, hz: number) => {
    const next = crossovers.slice();
    // clamp strictly between neighbours so the band ranges always stay ordered and match the backend.
    const lo = (i === 0 ? 20 : next[i - 1]) * 1.001;
    const hi = (i === crossovers.length - 1 ? 20000 : next[i + 1]) * 0.999;
    next[i] = Math.min(Math.max(hz, lo), hi);
    next.sort((a, b) => a - b);
    onChange(next, bands);
  };
  const addBand = () => {
    if (bands.length >= MAX_BANDS) return;
    // split the widest band: insert a crossover at the geometric midpoint.
    const edges = [20, ...crossovers, 20000];
    let widest = 0;
    let ratio = 0;
    for (let i = 0; i < edges.length - 1; i++) {
      const r = edges[i + 1] / edges[i];
      if (r > ratio) { ratio = r; widest = i; }
    }
    const mid = Math.round(Math.sqrt(edges[widest] * edges[widest + 1]));
    const nextCross = [...crossovers.slice(0, widest), mid, ...crossovers.slice(widest)].sort((a, b) => a - b);
    const nextBands = [...bands.slice(0, widest + 1), newMbBand(), ...bands.slice(widest + 1)];
    onChange(nextCross, nextBands);
  };
  const removeBand = (i: number) => {
    if (bands.length <= MIN_BANDS) return;
    // drop band i and the crossover that bordered it (merge into neighbour).
    const xi = i === 0 ? 0 : i - 1;
    onChange(crossovers.filter((_, j) => j !== xi), bands.filter((_, j) => j !== i));
  };

  const edges = [20, ...crossovers, 20000];
  const fmt = (hz: number) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)}k` : `${Math.round(hz)}`);

  return (
    <div className="al-mb">
      <div className="al-mb__head">
        <span className="al-mb__count">{t('master.mb.bands').replace('{n}', String(bands.length))}</span>
        <button type="button" className="al-mb__add" onClick={addBand} disabled={disabled || bands.length >= MAX_BANDS}>
          {t('master.mb.add')}
        </button>
      </div>

      {bands.map((b, i) => (
        <div key={i} className={`al-mb__band${b.bypass ? ' al-mb__band--off' : ''}`}>
          <div className="al-mb__bandhead">
            <span className="al-mb__range">{fmt(edges[i])}–{fmt(edges[i + 1])} Hz</span>
            <div className="al-mb__bandtools">
              <button type="button" className={`al-mb__chip${b.ms ? ' al-mb__chip--on' : ''}`}
                onClick={() => setBand(i, { ms: !b.ms })} disabled={disabled} title={t('master.mb.msHint')}>
                {b.ms ? 'M/S' : 'L/R'}
              </button>
              <button type="button" className={`al-mb__chip${b.bypass ? ' al-mb__chip--on' : ''}`}
                onClick={() => setBand(i, { bypass: !b.bypass })} disabled={disabled}>
                {t('master.mb.bypass')}
              </button>
              {bands.length > MIN_BANDS && (
                <button type="button" className="al-mb__rm" onClick={() => removeBand(i)} disabled={disabled}>×</button>
              )}
            </div>
          </div>
          <div className="al-mb__knobs">
            <Knob label={t('master.mb.threshold')} value={b.threshold} min={-60} max={0} step={0.5} unit="dB"
              onChange={(v) => setBand(i, { threshold: v })} disabled={disabled || b.bypass} />
            <Knob label={t('master.mb.ratio')} value={b.ratio} min={1} max={20} step={0.1} unit=":1"
              onChange={(v) => setBand(i, { ratio: v })} disabled={disabled || b.bypass} />
            <Knob label={t('master.mb.attack')} value={b.attack} min={0.5} max={120} step={0.5} unit="ms"
              onChange={(v) => setBand(i, { attack: v })} disabled={disabled || b.bypass} />
            <Knob label={t('master.mb.release')} value={b.release} min={20} max={1000} step={5} unit="ms"
              onChange={(v) => setBand(i, { release: v })} disabled={disabled || b.bypass} />
            <Knob label={t('master.mb.knee')} value={b.knee} min={0} max={24} step={0.5} unit="dB"
              onChange={(v) => setBand(i, { knee: v })} disabled={disabled || b.bypass} />
            <Knob label={t('master.mb.makeup')} value={b.makeup} min={0} max={12} step={0.25} unit="dB"
              onChange={(v) => setBand(i, { makeup: v })} disabled={disabled || b.bypass} />
            <Knob label={t('master.mb.width')} value={b.width} min={0} max={2} step={0.05} unit="×"
              onChange={(v) => setBand(i, { width: v })} disabled={disabled || b.bypass} />
          </div>
          {i < bands.length - 1 && (
            <div className="al-mb__cross">
              <span>{t('master.mb.split')}</span>
              <input type="range" min={Math.round(edges[i] * 1.2)} max={Math.round(edges[i + 2] * 0.83)}
                value={crossovers[i]} step={5} disabled={disabled}
                onChange={(e) => setCrossover(i, Number(e.target.value))} className="al-mb__crossrange" />
              <span className="al-mb__crossval">{fmt(crossovers[i])} Hz</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Knob({ label, value, min, max, step, unit, onChange, disabled }: {
  label: string; value: number; min: number; max: number; step: number; unit: string;
  onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <label className="al-mb__knob">
      <span className="al-mb__knoblabel">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))} className="al-mb__knobrange" />
      <span className="al-mb__knobval">{value}{unit}</span>
    </label>
  );
}
