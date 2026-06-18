/* ──────────────────────────────────────────────────────────────────
   modelStatus — Settings-tab model facts + lightweight status types.

   The real install state now comes from the backend via the useModels
   store (GET /api/models → ModelInfo[]). This module no longer simulates
   downloads or seeds a fake-installed registry — it only carries:

     • MODEL_FACTS / RECOMMENDED_MODEL — curated display facts for the
       three primary whisper sizes (VRAM / speed / blurb), used by
       ModelSizePicker as a fallback when the backend does not supply a
       richer ModelInfo for a given size.
     • ModelStatus — the small {size, state, pct} shape SettingsTab maps
       backend ModelInfo into to drive the picker's "installed" mark.

   No backend probing, no localStorage, no progress machinery lives here.
   ────────────────────────────────────────────────────────────────── */

import type { ModelSize } from '../../api/types';

export type ModelState = 'absent' | 'downloading' | 'verifying' | 'installed';

export interface ModelFacts {
  /** On-disk size of the model weights. */
  diskGb: number;
  /** Peak VRAM at inference on the 8 GB target card. */
  vramGb: number;
  /** Plain-language VRAM headroom note for an 8 GB card. */
  vramHint: string;
  /** Relative speed note. */
  speedHint: string;
  /** Short trade-off blurb (zh · en). */
  blurb: string;
}

export interface ModelStatus {
  size: ModelSize;
  state: ModelState;
  /** 0..100 while downloading / verifying; undefined otherwise. */
  pct: number;
}

/* Curated facts, tuned for an RTX 5060 (8 GB). Gold-standard target is
   large-v3 fitting comfortably under 8 GB with Demucs headroom. */
export const MODEL_FACTS: Record<ModelSize, ModelFacts> = {
  'large-v3': {
    diskGb: 3.1,
    vramGb: 6.2,
    vramHint: '~6.2 GB · 8 GB 卡剛好 fits 8 GB',
    speedHint: '~1.0× 即時 realtime',
    blurb: '最高準確度，建議 8 GB 卡使用。Best accuracy — recommended for 8 GB.',
  },
  medium: {
    diskGb: 1.5,
    vramGb: 3.1,
    vramHint: '~3.1 GB · 充裕 roomy',
    speedHint: '~2.2× 即時 realtime',
    blurb: '速度與準度的平衡點。A balanced speed / accuracy pick.',
  },
  small: {
    diskGb: 0.5,
    vramGb: 1.6,
    vramHint: '~1.6 GB · 極省 frugal',
    speedHint: '~4.5× 即時 realtime',
    blurb: '最快，適合草稿或低階卡。Fastest — good for drafts / low VRAM.',
  },
};

/** Recommended default model for the 8 GB target. */
export const RECOMMENDED_MODEL: ModelSize = 'large-v3';
