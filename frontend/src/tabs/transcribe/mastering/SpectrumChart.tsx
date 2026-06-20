/* ──────────────────────────────────────────────────────────────────
   SpectrumChart — log-frequency magnitude curve.

   Draws the measured spectrum (before), the predicted spectrum after the
   suggested EQ (after), and the target master curve, all on a shared
   log-x / dB-y axis. Pure SVG, themed via design tokens.
   ────────────────────────────────────────────────────────────────── */

import { useT } from '../../../i18n';
import type { MasterAnalysis } from '../../../api/master';
import { logX, dbY, fmtHz } from './vizUtils';

interface Props {
  spectrum: MasterAnalysis['spectrum'];
  /** Show the "after" (predicted) curve. Off for the result A/B where after is real. */
  showAfter?: boolean;
  /** Override the "after" label (e.g. "Mastered" on the result view). */
  afterLabel?: string;
}

const W = 720;
const H = 210;
const PAD = { l: 34, r: 12, t: 12, b: 22 };
const PLOT_W = W - PAD.l - PAD.r;
const PLOT_H = H - PAD.t - PAD.b;
const DB_MIN = -54;
const DB_MAX = 6;
const FMIN = 20;
const FMAX = 20000;

const GRID_HZ = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
const LABEL_HZ = new Set([100, 1000, 10000]);
const GRID_DB = [0, -12, -24, -36, -48];

function buildPoints(freqs: number[], db: number[]): string {
  return freqs
    .map((f, i) => `${logX(f, FMIN, FMAX, PAD.l, PLOT_W).toFixed(1)},${dbY(db[i], DB_MIN, DB_MAX, PAD.t, PLOT_H).toFixed(1)}`)
    .join(' ');
}

export function SpectrumChart({ spectrum, showAfter = true, afterLabel }: Props) {
  const t = useT();
  const { freqs } = spectrum;
  if (!freqs || freqs.length === 0) return null;

  const beforePts = buildPoints(freqs, spectrum.before_db);
  const afterPts = buildPoints(freqs, spectrum.after_db);
  const targetPts = buildPoints(freqs, spectrum.target_db);
  // Filled area under the "before" curve for body.
  const baseY = dbY(DB_MIN, DB_MIN, DB_MAX, PAD.t, PLOT_H);
  const areaPts = `${PAD.l},${baseY} ${beforePts} ${PAD.l + PLOT_W},${baseY}`;

  return (
    <div className="al-spec">
      <svg viewBox={`0 0 ${W} ${H}`} className="al-spec__svg" role="img"
           aria-label={t('master.viz.spectrumAria')} preserveAspectRatio="none">
        <defs>
          <linearGradient id="al-spec-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--al-gold)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--al-gold)" stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {/* dB gridlines */}
        {GRID_DB.map((d) => {
          const y = dbY(d, DB_MIN, DB_MAX, PAD.t, PLOT_H);
          return (
            <g key={`db${d}`}>
              <line x1={PAD.l} y1={y} x2={PAD.l + PLOT_W} y2={y} className="al-spec__grid" />
              <text x={PAD.l - 5} y={y + 3} className="al-spec__axislbl" textAnchor="end">{d}</text>
            </g>
          );
        })}

        {/* frequency gridlines */}
        {GRID_HZ.map((f) => {
          const x = logX(f, FMIN, FMAX, PAD.l, PLOT_W);
          return (
            <g key={`hz${f}`}>
              <line x1={x} y1={PAD.t} x2={x} y2={PAD.t + PLOT_H} className="al-spec__grid" />
              {LABEL_HZ.has(f) && (
                <text x={x} y={H - 6} className="al-spec__axislbl" textAnchor="middle">{fmtHz(f)}</text>
              )}
            </g>
          );
        })}

        {/* target curve (dim, dashed) */}
        <polyline points={targetPts} className="al-spec__target" fill="none" />

        {/* before: filled area + line */}
        <polygon points={areaPts} fill="url(#al-spec-fill)" stroke="none" />
        <polyline points={beforePts} className="al-spec__before" fill="none" />

        {/* after: predicted/mastered (green) */}
        {showAfter && <polyline points={afterPts} className="al-spec__after" fill="none" />}
      </svg>

      <div className="al-spec__legend">
        <span className="al-spec__key al-spec__key--before">{t('master.viz.before')}</span>
        {showAfter && (
          <span className="al-spec__key al-spec__key--after">{afterLabel ?? t('master.viz.predicted')}</span>
        )}
        <span className="al-spec__key al-spec__key--target">{t('master.viz.target')}</span>
        <span className="al-spec__hz">Hz →</span>
      </div>
    </div>
  );
}
