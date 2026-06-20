/* ──────────────────────────────────────────────────────────────────
   SignalChain — the pro signal-chain view: EQ → De-ess → Multiband →
   Saturate → Width → Limit, showing which stages ran (so it reads as
   "this really listened and adjusted", not a template).
   ────────────────────────────────────────────────────────────────── */

import { useT } from '../../../i18n';
import type { ChainState } from '../../../api/master';

interface Props {
  chain: ChainState;
}

// Canonical display order + the i18n label key + how to detect "active".
const STAGES: { id: string; key: string; match: (s: string[]) => boolean }[] = [
  { id: 'eq', key: 'master.chain.eq', match: (s) => s.includes('corrective_eq') || s.includes('genre_eq') || s.includes('reference_match') },
  { id: 'deess', key: 'master.chain.deess', match: (s) => s.includes('de_ess') },
  { id: 'multiband', key: 'master.chain.multiband', match: (s) => s.includes('multiband') || s.includes('compress') },
  { id: 'dynamics', key: 'master.chain.dynamics', match: (s) => s.includes('macro_dynamics') },
  { id: 'saturate', key: 'master.chain.saturate', match: (s) => s.includes('saturation') },
  { id: 'width', key: 'master.chain.width', match: (s) => s.includes('width') },
  { id: 'eq2', key: 'master.chain.residual', match: (s) => s.includes('residual_eq') },
  { id: 'limit', key: 'master.chain.limit', match: () => true },
];

export function SignalChain({ chain }: Props) {
  const t = useT();
  const stages = chain.stages ?? [];
  return (
    <div className="al-chain" role="list" aria-label={t('master.chain.aria')}>
      {STAGES.map((st, i) => {
        const on = st.match(stages);
        return (
          <div key={st.id} className="al-chain__seg" role="listitem">
            <span className={`al-chain__node${on ? ' al-chain__node--on' : ''}`}>{t(st.key)}</span>
            {i < STAGES.length - 1 && <span className="al-chain__arrow" aria-hidden="true">→</span>}
          </div>
        );
      })}
    </div>
  );
}
