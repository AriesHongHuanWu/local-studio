/* ──────────────────────────────────────────────────────────────────
   ProblemList — overall score ring + prioritized, plain-language issues
   the engine detected, each with the corrective action it will take.
   ────────────────────────────────────────────────────────────────── */

import { useT, useLang } from '../../../i18n';
import type { AnalysisProblem } from '../../../api/master';
import { scoreVerdict } from './vizUtils';

interface Props {
  score: number;
  problems: AnalysisProblem[];
}

const R = 26;
const CIRC = 2 * Math.PI * R;

export function ProblemList({ score, problems }: Props) {
  const t = useT();
  const lang = useLang();
  const verdict = scoreVerdict(score);
  const dash = (score / 100) * CIRC;

  return (
    <div className="al-diag">
      <div className={`al-diag__score al-diag__score--${verdict}`}>
        <svg viewBox="0 0 64 64" className="al-diag__ring" aria-hidden="true">
          <circle cx="32" cy="32" r={R} className="al-diag__ringbg" />
          <circle
            cx="32" cy="32" r={R} className="al-diag__ringfg"
            strokeDasharray={`${dash} ${CIRC}`} transform="rotate(-90 32 32)"
          />
        </svg>
        <div className="al-diag__scoretext">
          <span className="al-diag__scorenum">{score}</span>
          <span className="al-diag__scorelbl">{t('master.diag.score')}</span>
        </div>
      </div>

      <div className="al-diag__list">
        {problems.length === 0 ? (
          <p className="al-diag__clean">{t('master.diag.clean')}</p>
        ) : (
          problems.map((p, i) => (
            <div key={`${p.id}-${i}`} className={`al-diag__item al-diag__item--${p.severity}`}>
              <span className="al-diag__sev" aria-hidden="true" />
              <div className="al-diag__body">
                <span className="al-diag__msg">{lang === 'en' ? p.messageEn : p.message}</span>
                <span className="al-diag__act">{lang === 'en' ? p.actionEn : p.action}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
