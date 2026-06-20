/* ──────────────────────────────────────────────────────────────────
   SectionDynamics — the song's energy envelope with detected verse /
   chorus regions, overlaid with the per-section gain the macro-dynamics
   control applies (chorus louder / verse softer, or evened out).
   ────────────────────────────────────────────────────────────────── */

import { useT } from '../../../i18n';
import type { MasterAnalysis } from '../../../api/master';

interface Props {
  sections: MasterAnalysis['sections'];
}

const W = 720;
const H = 150;
const PAD = { l: 10, r: 10, t: 12, b: 20 };
const PLOT_W = W - PAD.l - PAD.r;
const PLOT_H = H - PAD.t - PAD.b;

export function SectionDynamics({ sections }: Props) {
  const t = useT();
  const { times_s: times, energy_db: energy, segments, gain_curve_db: gain, amount } = sections;
  if (!times || times.length < 2 || !energy || energy.length < 2) return null;

  const durMax = times[times.length - 1] || 1;
  const xAt = (s: number) => PAD.l + (s / durMax) * PLOT_W;

  const eMin = Math.min(...energy) - 1;
  const eMax = Math.max(...energy) + 1;
  const eRange = Math.max(1e-3, eMax - eMin);
  const yEnergy = (e: number) => PAD.t + (1 - (e - eMin) / eRange) * PLOT_H;

  const gMax = Math.max(3, ...gain.map((g) => Math.abs(g)));
  const midY = PAD.t + PLOT_H / 2;
  const yGain = (g: number) => midY - (g / gMax) * (PLOT_H * 0.42);

  const energyLine = times.map((s, i) => `${xAt(s).toFixed(1)},${yEnergy(energy[i] ?? eMin).toFixed(1)}`).join(' ');
  const energyArea = `${PAD.l},${PAD.t + PLOT_H} ${energyLine} ${PAD.l + PLOT_W},${PAD.t + PLOT_H}`;
  const gainLine = times.map((s, i) => `${xAt(s).toFixed(1)},${yGain(gain[i] ?? 0).toFixed(1)}`).join(' ');

  return (
    <div className="al-sect">
      <svg viewBox={`0 0 ${W} ${H}`} className="al-sect__svg" role="img"
           aria-label={t('master.viz.sectionsAria')} preserveAspectRatio="none">
        {/* chorus region shading */}
        {segments.map((seg, i) =>
          seg.type === 'chorus' ? (
            <rect key={i} x={xAt(seg.start_s)} y={PAD.t} width={Math.max(0, xAt(seg.end_s) - xAt(seg.start_s))}
                  height={PLOT_H} className="al-sect__chorus" />
          ) : null,
        )}

        {/* energy envelope */}
        <polygon points={energyArea} className="al-sect__energyfill" />
        <polyline points={energyLine} className="al-sect__energy" fill="none" />

        {/* gain zero baseline + applied gain curve */}
        <line x1={PAD.l} y1={midY} x2={PAD.l + PLOT_W} y2={midY} className="al-sect__gainzero" />
        {Math.abs(amount) > 1e-3 && <polyline points={gainLine} className="al-sect__gain" fill="none" />}

        {/* segment labels */}
        {segments.map((seg, i) => {
          const cx = (xAt(seg.start_s) + xAt(seg.end_s)) / 2;
          if (xAt(seg.end_s) - xAt(seg.start_s) < 40) return null;
          return (
            <text key={`l${i}`} x={cx} y={H - 6} className="al-sect__seglbl" textAnchor="middle">
              {seg.type === 'chorus' ? t('master.sect.chorus') : t('master.sect.verse')}
            </text>
          );
        })}
      </svg>

      <div className="al-sect__legend">
        <span className="al-sect__key al-sect__key--energy">{t('master.sect.energy')}</span>
        {Math.abs(amount) > 1e-3 && (
          <span className="al-sect__key al-sect__key--gain">
            {t('master.sect.applied')} (±{gMax.toFixed(1)} dB)
          </span>
        )}
        <span className="al-sect__key al-sect__key--chorus">{t('master.sect.chorus')}</span>
      </div>
    </div>
  );
}
