/* ──────────────────────────────────────────────────────────────────
   BandBars — 7-band spectral balance vs the target curve.

   Each bar diverges from a 0 center (= on target). Positive = too much
   energy in that band, negative = deficit. Bands flagged by a problem are
   tinted by severity. A small tick shows the suggested corrective EQ.
   ────────────────────────────────────────────────────────────────── */

import { useT } from '../../../i18n';
import type { AnalysisBand, AnalysisProblem } from '../../../api/master';
import { dbY, fmtDb } from './vizUtils';

interface Props {
  bands: AnalysisBand[];
  problems: AnalysisProblem[];
}

const W = 720;
const H = 168;
const PAD = { l: 30, r: 12, t: 10, b: 28 };
const PLOT_W = W - PAD.l - PAD.r;
const PLOT_H = H - PAD.t - PAD.b;
const DEV_MAX = 8;

const BAND_LABEL: Record<string, string> = {
  sub: 'master.band.sub',
  bass: 'master.band.bass',
  low_mid: 'master.band.lowMid',
  mid: 'master.band.mid',
  high_mid: 'master.band.highMid',
  presence: 'master.band.presence',
  air: 'master.band.air',
};

export function BandBars({ bands, problems }: Props) {
  const t = useT();
  if (!bands || bands.length === 0) return null;

  const flagged = new Map<string, string>();
  for (const p of problems) flagged.set(p.area, p.severity);

  const zeroY = dbY(0, -DEV_MAX, DEV_MAX, PAD.t, PLOT_H);
  const slot = PLOT_W / bands.length;
  const barW = slot * 0.5;

  return (
    <div className="al-bands">
      <svg viewBox={`0 0 ${W} ${H}`} className="al-bands__svg" role="img"
           aria-label={t('master.viz.bandsAria')} preserveAspectRatio="none">
        {/* center (on-target) line + ±3/±6 guides */}
        {[-6, -3, 3, 6].map((d) => {
          const y = dbY(d, -DEV_MAX, DEV_MAX, PAD.t, PLOT_H);
          return <line key={d} x1={PAD.l} y1={y} x2={PAD.l + PLOT_W} y2={y} className="al-bands__guide" />;
        })}
        <line x1={PAD.l} y1={zeroY} x2={PAD.l + PLOT_W} y2={zeroY} className="al-bands__zero" />
        <text x={PAD.l - 5} y={zeroY + 3} className="al-bands__axislbl" textAnchor="end">0</text>
        <text x={PAD.l - 5} y={dbY(6, -DEV_MAX, DEV_MAX, PAD.t, PLOT_H) + 3} className="al-bands__axislbl" textAnchor="end">+6</text>
        <text x={PAD.l - 5} y={dbY(-6, -DEV_MAX, DEV_MAX, PAD.t, PLOT_H) + 3} className="al-bands__axislbl" textAnchor="end">−6</text>

        {bands.map((b, i) => {
          const cx = PAD.l + slot * i + slot / 2;
          const dev = b.deviation_db;
          const y = dbY(dev, -DEV_MAX, DEV_MAX, PAD.t, PLOT_H);
          const top = Math.min(y, zeroY);
          const h = Math.abs(y - zeroY);
          const sev = flagged.get(b.name);
          const cls = sev
            ? `al-bands__bar al-bands__bar--${sev}`
            : Math.abs(dev) < 1.5
              ? 'al-bands__bar al-bands__bar--ok'
              : 'al-bands__bar';
          // suggested EQ tick (where the correction would move it)
          const tickY = dbY(-b.eq_gain_db, -DEV_MAX, DEV_MAX, PAD.t, PLOT_H);
          return (
            <g key={b.name}>
              <rect x={cx - barW / 2} y={top} width={barW} height={Math.max(1, h)} rx={2} className={cls} />
              {Math.abs(b.eq_gain_db) > 0.2 && (
                <line x1={cx - barW / 2 - 2} y1={tickY} x2={cx + barW / 2 + 2} y2={tickY} className="al-bands__tick" />
              )}
              <text x={cx} y={H - 14} className="al-bands__name" textAnchor="middle">{t(BAND_LABEL[b.name] ?? b.name)}</text>
              <text x={cx} y={H - 3} className="al-bands__dev" textAnchor="middle">{fmtDb(dev, 1)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
