/* ──────────────────────────────────────────────────────────────────
   AnalysisPanel — composes the intelligent-analysis visualizations into
   one panel: score + problems, pro metric cards, frequency spectrum,
   band balance, and section (verse/chorus) dynamics.

   Also exports ResultCompare for the before→after view on a finished
   master (original vs mastered spectrum + final metrics).
   ────────────────────────────────────────────────────────────────── */

import { useT } from '../../../i18n';
import type { MasterAnalysis } from '../../../api/master';
import { SpectrumChart } from './SpectrumChart';
import { BandBars } from './BandBars';
import { AnalysisCards } from './AnalysisCards';
import { ProblemList } from './ProblemList';
import { SectionDynamics } from './SectionDynamics';

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="al-an__block">
      <span className="al-an__blocktitle">{title}</span>
      {children}
    </div>
  );
}

export function AnalysisPanel({ analysis, targetLufs }: {
  analysis: MasterAnalysis;
  targetLufs?: number | null;
}) {
  const t = useT();
  return (
    <div className="al-an">
      <ProblemList score={analysis.overall_score} problems={analysis.problems} />
      <Block title={t('master.an.metrics')}>
        <AnalysisCards analysis={analysis} targetLufs={targetLufs} />
      </Block>
      <Block title={t('master.an.spectrum')}>
        <SpectrumChart spectrum={analysis.spectrum} showAfter />
      </Block>
      <Block title={t('master.an.bands')}>
        <BandBars bands={analysis.bands} problems={analysis.problems} />
      </Block>
      <Block title={t('master.an.sections')}>
        <SectionDynamics sections={analysis.sections} />
      </Block>
    </div>
  );
}

/** Before → after view for a finished master. */
export function ResultCompare({ before, after, targetLufs }: {
  before: MasterAnalysis;
  after: MasterAnalysis;
  targetLufs?: number | null;
}) {
  const t = useT();
  // Overlay original (before) vs mastered (after's own spectrum).
  const compareSpectrum = {
    freqs: after.spectrum.freqs,
    before_db: before.spectrum.before_db,
    after_db: after.spectrum.before_db,
    target_db: after.spectrum.target_db,
  };
  const delta = after.overall_score - before.overall_score;
  return (
    <div className="al-an">
      <div className="al-an__delta">
        <span className="al-an__deltascore">{before.overall_score} → {after.overall_score}</span>
        <span className={`al-an__deltatag ${delta >= 0 ? 'al-an__deltatag--up' : 'al-an__deltatag--down'}`}>
          {delta >= 0 ? `+${delta}` : delta} {t('master.an.scoreDelta')}
        </span>
      </div>
      <Block title={t('master.an.compare')}>
        <SpectrumChart spectrum={compareSpectrum} showAfter afterLabel={t('master.mastered')} />
      </Block>
      <Block title={t('master.an.finalMetrics')}>
        <AnalysisCards analysis={after} targetLufs={targetLufs} />
      </Block>
      <Block title={t('master.an.sections')}>
        <SectionDynamics sections={after.sections} />
      </Block>
    </div>
  );
}
