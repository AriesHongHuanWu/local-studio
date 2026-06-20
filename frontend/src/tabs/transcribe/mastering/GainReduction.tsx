/* ──────────────────────────────────────────────────────────────────
   GainReduction — per-band multiband GR strips + de-ess activity, drawn
   from the master meta's GR envelopes (看要壓縮多少 visualized).
   ────────────────────────────────────────────────────────────────── */

import { useT } from '../../../i18n';
import type { MasterMeters } from '../../../api/master';

interface Props {
  meters: MasterMeters;
}

const W = 480;
const H = 34;
const GR_FLOOR = -12; // dB shown

function GrStrip({ name, gr, max }: { name: string; gr: number[]; max: number }) {
  if (!gr || gr.length === 0) return null;
  const step = W / gr.length;
  // GR is <=0; draw bars hanging from the top, length ∝ reduction.
  const bars = gr.map((db, i) => {
    const frac = Math.min(1, Math.abs(db) / Math.abs(GR_FLOOR));
    const h = frac * (H - 2);
    return <rect key={i} x={(i * step).toFixed(1)} y={0} width={Math.max(0.6, step - 0.3)} height={h.toFixed(1)} />;
  });
  return (
    <div className="al-gr__row">
      <span className="al-gr__name">{name}</span>
      <svg viewBox={`0 0 ${W} ${H}`} className="al-gr__svg" preserveAspectRatio="none">
        <g className="al-gr__bars">{bars}</g>
      </svg>
      <span className="al-gr__max">{max.toFixed(1)} dB</span>
    </div>
  );
}

export function GainReduction({ meters }: Props) {
  const t = useT();
  const mb = meters.multiband;
  const de = meters.deess;
  if (!mb?.active && !de?.active) return null;

  return (
    <div className="al-gr">
      {mb?.active && (
        <>
          {mb.bands.low && <GrStrip name={t('master.gr.low')} gr={mb.bands.low.gr_db} max={mb.bands.low.max_gr_db} />}
          {mb.bands.mid && <GrStrip name={t('master.gr.mid')} gr={mb.bands.mid.gr_db} max={mb.bands.mid.max_gr_db} />}
          {mb.bands.high && <GrStrip name={t('master.gr.high')} gr={mb.bands.high.gr_db} max={mb.bands.high.max_gr_db} />}
        </>
      )}
      {de?.active && de.gr_db && (
        <GrStrip name={t('master.gr.deess')} gr={de.gr_db} max={-(de.max_reduction_db ?? 0)} />
      )}
    </div>
  );
}
