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
export const FALLBACK_META: Meta = {
  styles: [
    { key: 'pop', label: '流行 Pop' },
    { key: 'ballad', label: '抒情 Ballad' },
    { key: 'rock', label: '搖滾 Rock' },
    { key: 'rap', label: '饒舌 Rap / Hip-hop' },
    { key: 'electronic', label: '電子 Electronic' },
    { key: 'folk', label: '民謠 Folk' },
    { key: 'rnb', label: 'R&B / Soul' },
    { key: 'jazz', label: '爵士 Jazz' },
    { key: 'classical', label: '古典 Classical' },
    { key: 'kids', label: '兒歌 Kids' },
  ],
  languages: [
    { code: 'zh', label: '中文國語 Mandarin', iso3: 'zho' },
    { code: 'yue', label: '粵語 Cantonese', iso3: 'yue' },
    { code: 'en', label: 'English', iso3: 'eng' },
    { code: 'ja', label: '日本語 Japanese', iso3: 'jpn' },
    { code: 'ko', label: '한국어 Korean', iso3: 'kor' },
  ],
  modelSizes: ['large-v3', 'medium', 'small'],
  engines: ['whisper'],
  gpu: true,
  demucs: true,
  aligner: true,
  version: '0.1.0-local',
};

/** Fetch /api/meta; throws ApiError on failure (caller decides fallback). */
export async function fetchMeta(signal?: AbortSignal): Promise<Meta> {
  return client.get<Meta>('/api/meta', undefined, signal);
}
