/* ──────────────────────────────────────────────────────────────────
   GET /api/meta — capabilities + option lists. Ships a FALLBACK Meta so
   every tab is fully visible/designable offline (CRITICAL OFFLINE RULE).
   ────────────────────────────────────────────────────────────────── */

import { client } from './client';
import type { Meta } from './types';

/**
 * Sensible offline defaults so selects, chips and gates always render.
 * gpu/demucs/aligner default to `true` so the full feature surface shows;
 * the StatusStrip separately reflects real connectivity.
 */
// NOTE: the `label` fields below are only a last-resort fallback for unknown
// server keys/codes. The Transcribe UI renders localized labels via i18n keys
// (transcribe.style.<key> / library.lang.<code>) for every known entry, so
// these labels are single-language by design — never inline-bilingual.
export const FALLBACK_META: Meta = {
  styles: [
    { key: 'pop', label: 'Pop' },
    { key: 'ballad', label: 'Ballad' },
    { key: 'rock', label: 'Rock' },
    { key: 'rap', label: 'Rap / Hip-hop' },
    { key: 'electronic', label: 'Electronic' },
    { key: 'folk', label: 'Folk' },
    { key: 'rnb', label: 'R&B / Soul' },
    { key: 'jazz', label: 'Jazz' },
    { key: 'classical', label: 'Classical' },
    { key: 'kids', label: 'Kids' },
  ],
  languages: [
    { code: 'zh', label: 'Mandarin', iso3: 'zho' },
    { code: 'yue', label: 'Cantonese', iso3: 'yue' },
    { code: 'en', label: 'English', iso3: 'eng' },
    { code: 'ja', label: 'Japanese', iso3: 'jpn' },
    { code: 'ko', label: 'Korean', iso3: 'kor' },
  ],
  modelSizes: ['large-v3', 'medium', 'small'],
  engines: ['whisper'],
  gpu: true,
  demucs: true,
  aligner: true,
  caption: true,
  captionTemplates: ['clean', 'karaoke', 'bold'],
  version: '0.1.0-local',
};

/** Fetch /api/meta; throws ApiError on failure (caller decides fallback). */
export async function fetchMeta(signal?: AbortSignal): Promise<Meta> {
  return client.get<Meta>('/api/meta', undefined, signal);
}
