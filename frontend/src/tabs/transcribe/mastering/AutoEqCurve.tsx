/* ──────────────────────────────────────────────────────────────────
   AutoEqCurve — draws the AI's auto corrective-EQ as a frequency curve
   (what the intelligent mode is doing to the tone), log-x / dB-y.
   ────────────────────────────────────────────────────────────────── */

import { useT } from '../../../i18n';
import { logX, fmtHz } from './vizUtils';

interface Props {
  curve: { f: number; db: number }[];
}

const W = 720;
const H = 140;
const PAD = { l: 30, r: 12, t: 10, b: 20 };
const PW = W - PAD.l - PAD.r;
const PH = H - PAD.t - PAD.b;
const DB = 12; // ± dB shown
const FMIN = 20;
const FMAX = 20000;

const GRID_HZ = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
const LABEL_HZ = new Set([100, 1000, 10000]);

const yDb = (db: number) => PAD.t + (1 - (Math.max(-DB, Math.min(DB, db)) + DB) / (2 * DB)) * PH;

export function AutoEqCurve({ curve }: Props) {
  const t = useT();
  if (!curve || curve.length < 2) return null;
  const pts = curve
    .map((p) => `${logX(p.f, FMIN, FMAX, PAD.l, PW).toFixed(1)},${yDb(p.db).toFixed(1)}`)
    .join(' ');
  const zeroY = yDb(0);
  const x0 = logX(curve[0].f, FMIN, FMAX, PAD.l, PW);
  const x1 = logX(curve[curve.length - 1].f, FMIN, FMAX, PAD.l, PW);
  const area = `${x0.toFixed(1)},${zeroY.toFixed(1)} ${pts} ${x1.toFixed(1)},${zeroY.toFixed(1)}`;
  const maxBoost = Math.max(...curve.map((p) => p.db));
  const maxCut = Math.min(...curve.map((p) => p.db));

  return (
    <div className="al-spec">
      <svg viewBox={`0 0 ${W} ${H}`} className="al-spec__svg" role="img"
           aria-label={t('master.viz.eqCurveAria')} preserveAspectRatio="none">
        <defs>
          <linearGradient id="al-eqc-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--al-gold)" stopOpacity="0.26" />
            <stop offset="100%" stopColor="var(--al-gold)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[6, 0, -6].map((d) => (
          <g key={d}>
            <line x1={PAD.l} y1={yDb(d)} x2={PAD.l + PW} y2={yDb(d)}
                  className={d === 0 ? 'al-spec__zero' : 'al-spec__grid'} />
            <text x={PAD.l - 4} y={yDb(d) + 3} className="al-spec__axislbl" textAnchor="end">
              {d > 0 ? `+${d}` : d}
            </text>
          </g>
        ))}
        {GRID_HZ.map((f) => {
          const x = logX(f, FMIN, FMAX, PAD.l, PW);
          return (
            <g key={f}>
              <line x1={x} y1={PAD.t} x2={x} y2={PAD.t + PH} className="al-spec__grid" />
              {LABEL_HZ.has(f) && (
                <text x={x} y={H - 6} className="al-spec__axislbl" textAnchor="middle">{fmtHz(f)}</text>
              )}
            </g>
          );
        })}
        <polygon points={area} fill="url(#al-eqc-fill)" stroke="none" />
        <polyline points={pts} className="al-eqc__line" fill="none" />
      </svg>
      <div className="al-spec__legend">
        <span className="al-spec__key al-spec__key--after">{t('master.viz.eqCurve')}</span>
        <span className="al-eqc__range">
          {maxBoost >= 0.1 ? `+${maxBoost.toFixed(1)}` : maxBoost.toFixed(1)} / {maxCut.toFixed(1)} dB
        </span>
        <span className="al-spec__hz">Hz →</span>
      </div>
    </div>
  );
}
