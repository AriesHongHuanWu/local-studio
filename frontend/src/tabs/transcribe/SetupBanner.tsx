/* ──────────────────────────────────────────────────────────────────
   SetupBanner — first-run Whisper model picker.

   Shown ONLY when useModels().anyWhisperInstalled === false AND the
   backend is reachable. Lets the user pick a Whisper size to download
   (small / medium / large-v3 with size + VRAM hints, large-v3
   recommended). Triggers downloadAndTrack → shows inline progress.
   Disappears automatically when any Whisper model becomes installed.

   Never blocks rendering when the backend is offline.
   ────────────────────────────────────────────────────────────────── */

import { useEffect } from 'react';
import { Download, Loader2, Star } from 'lucide-react';
import { Button, ProgressBar } from '../../components/primitives';
import { useModels } from '../../state/useModels';

// Ordered pick options for the banner (just Whisper models, curated display)
const PICK_OPTIONS = [
  {
    id: 'whisper-small',
    label: 'small',
    sizeMB: 500,
    vramHint: '~1.6 GB VRAM',
    blurb: '最快，草稿 / 低配 fastest',
    recommended: false,
  },
  {
    id: 'whisper-medium',
    label: 'medium',
    sizeMB: 1500,
    vramHint: '~3.1 GB VRAM',
    blurb: '速度與準度平衡 balanced',
    recommended: false,
  },
  {
    id: 'whisper-large-v3',
    label: 'large-v3',
    sizeMB: 3100,
    vramHint: '~6.2 GB VRAM',
    blurb: '最高準確度，建議 8 GB 卡 best accuracy',
    recommended: true,
  },
] as const;

type PickId = (typeof PICK_OPTIONS)[number]['id'];

// The three whisper pick ids — used to scope the active-download scan so the
// banner never reacts to demucs/aligner downloads started elsewhere.
const PICK_IDS: PickId[] = PICK_OPTIONS.map((o) => o.id);

export function SetupBanner() {
  const anyWhisperInstalled = useModels((s) => s.anyWhisperInstalled);
  const offline = useModels((s) => s.offline);
  const loading = useModels((s) => s.loading);
  const perId = useModels((s) => s.perId);
  const downloadAndTrack = useModels((s) => s.downloadAndTrack);
  const load = useModels((s) => s.load);
  const models = useModels((s) => s.models);

  // Kick off a load if the models list is empty (e.g. store just mounted)
  useEffect(() => {
    if (models.length === 0 && !offline && !loading) {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hide when a Whisper model is installed or backend is unreachable
  if (anyWhisperInstalled || offline) return null;

  // Still waiting for the first load — don't flash the banner yet
  if (loading && models.length === 0) return null;

  // Which whisper pick ID is currently downloading? Scope strictly to the
  // three whisper pick ids so demucs/aligner downloads can't hijack the banner.
  const activeId = PICK_IDS.find((id) => perId[id]?.status === 'running');
  const activeProgress = activeId ? perId[activeId] : undefined;

  return (
    <div className="al-setup-banner" role="region" aria-label="首次設定：下載辨識模型">
      <div className="al-setup-banner__head">
        <span className="al-setup-banner__title">
          下載一個辨識模型來開始使用
        </span>
        <span className="al-setup-banner__sub">
          Choose a Whisper model to download — only needed once.
        </span>
      </div>

      {/* Options row */}
      {!activeId && (
        <div className="al-setup-banner__picks">
          {PICK_OPTIONS.map((opt) => {
            const sizeGb = (opt.sizeMB / 1024).toFixed(1);
            return (
              <button
                key={opt.id}
                type="button"
                className={`al-setup-pick${opt.recommended ? ' al-setup-pick--rec' : ''}`}
                onClick={() => void downloadAndTrack(opt.id)}
              >
                <div className="al-setup-pick__top">
                  <span className="al-setup-pick__label">{opt.label}</span>
                  {opt.recommended && (
                    <span className="al-setup-pick__badge" title="建議 Recommended">
                      <Star size={9} strokeWidth={2.5} />
                      建議
                    </span>
                  )}
                </div>
                <div className="al-setup-pick__hint">{opt.vramHint}</div>
                <div className="al-setup-pick__blurb">{opt.blurb}</div>
                <div className="al-setup-pick__foot">
                  <span>{sizeGb} GB</span>
                  <Button
                    size="sm"
                    variant={opt.recommended ? 'primary' : 'default'}
                    icon={<Download size={13} />}
                    tabIndex={-1} // the whole card is the click target
                  >
                    下載
                  </Button>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Progress while downloading */}
      {activeId && activeProgress && (
        <div className="al-setup-banner__progress" aria-live="polite">
          <div className="al-setup-banner__prog-head">
            <Loader2 size={14} className="al-spin" />
            <span className="al-setup-banner__prog-label">
              下載中 {activeId.replace('whisper-', '')}…
            </span>
            <span className="al-setup-banner__prog-pct">
              {Math.round(activeProgress.pct)}%
            </span>
          </div>
          <ProgressBar value={activeProgress.pct} tone="gold" />
          <span className="al-setup-banner__prog-msg">{activeProgress.message}</span>
        </div>
      )}
    </div>
  );
}
