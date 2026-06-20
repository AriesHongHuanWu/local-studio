/* ──────────────────────────────────────────────────────────────────
   AnalysisCards — professional metric readout (loudness / dynamics /
   stereo), each colour-coded green/amber/red against pro ranges.
   ────────────────────────────────────────────────────────────────── */

import { useT } from '../../../i18n';
import type { MasterAnalysis } from '../../../api/master';
import type { Verdict } from './vizUtils';
import {
  verdictLra, verdictTruePeak, verdictCrest, verdictDr,
  verdictCorrelation, verdictLowMono, verdictLoudness,
} from './vizUtils';

interface Props {
  analysis: MasterAnalysis;
  /** When set, the LUFS card is judged against this target. */
  targetLufs?: number | null;
}

function Card({ label, value, unit, sub, verdict }: {
  label: string; value: string; unit?: string; sub?: string; verdict: Verdict;
}) {
  return (
    <div className={`al-mcard al-mcard--${verdict}`}>
      <span className="al-mcard__dot" aria-hidden="true" />
      <span className="al-mcard__label">{label}</span>
      <span className="al-mcard__value">
        {value}{unit && <span className="al-mcard__unit">{unit}</span>}
      </span>
      {sub && <span className="al-mcard__sub">{sub}</span>}
    </div>
  );
}

export function AnalysisCards({ analysis, targetLufs }: Props) {
  const t = useT();
  const { loudness: l, dynamics: d, stereo: s } = analysis;

  const drStr = d.dr_est == null ? '—' : `DR${d.dr_est}`;

  return (
    <div className="al-mcards">
      <Card
        label={t('master.metric.loudness')}
        value={l.integrated_lufs.toFixed(1)} unit=" LUFS"
        sub={targetLufs != null ? `→ ${targetLufs} LUFS` : t('master.metric.integrated')}
        verdict={targetLufs != null ? verdictLoudness(l.integrated_lufs, targetLufs) : 'neutral'}
      />
      <Card
        label={t('master.metric.lra')}
        value={l.lra_lu.toFixed(1)} unit=" LU"
        sub={t('master.metric.lraSub')}
        verdict={verdictLra(l.lra_lu)}
      />
      <Card
        label={t('master.metric.truePeak')}
        value={l.true_peak_dbtp.toFixed(1)} unit=" dBTP"
        sub={t('master.metric.truePeakSub')}
        verdict={verdictTruePeak(l.true_peak_dbtp)}
      />
      <Card
        label={t('master.metric.dynamics')}
        value={d.crest_factor_db.toFixed(1)} unit=" dB"
        sub={`${t('master.metric.crest')} · ${drStr}`}
        verdict={d.dr_est != null ? verdictDr(d.dr_est) : verdictCrest(d.crest_factor_db)}
      />
      <Card
        label={t('master.metric.stereo')}
        value={s.correlation.toFixed(2)}
        sub={t('master.metric.correlation')}
        verdict={verdictCorrelation(s.correlation)}
      />
      <Card
        label={t('master.metric.lowMono')}
        value={s.low_mono_corr.toFixed(2)}
        sub={t('master.metric.lowMonoSub')}
        verdict={verdictLowMono(s.low_mono_corr)}
      />
    </div>
  );
}
