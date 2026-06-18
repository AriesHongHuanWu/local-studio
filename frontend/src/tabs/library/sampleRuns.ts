/* ──────────────────────────────────────────────────────────────────
   sampleRuns — built-in illustrative history so the Library tab is fully
   visible / designable when there are no real runs yet (and the backend
   is down). These are rendered as read-only "範例 Sample" rows; the tab
   still works identically the moment a real run is stored.
   ────────────────────────────────────────────────────────────────── */

import type { RunRecord } from '../../state/useLibrary';
import type { Result, JobMode } from '../../api/types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Minimal but valid Result so a sample row is shape-complete. */
function demoResult(
  language: string,
  modeUsed: JobMode,
  modelSize: string,
  durationSec: number,
  separated: boolean,
  text: string,
): Result {
  const words = text.split(' ').map((w, i) => ({
    start: i * 0.45,
    end: i * 0.45 + 0.4,
    word: w,
    prob: 0.92,
  }));
  return {
    language,
    modeUsed,
    segments: [{ id: 0, start: 0, end: words.length * 0.45, text, words }],
    meta: { modelSize, separated, durationSec, engine: 'whisper' },
  };
}

const NOW = Date.now();

export const SAMPLE_RUNS: RunRecord[] = [
  {
    id: 'sample-1',
    title: '夜空中最亮的星',
    mode: 'align',
    language: 'zh',
    modelSize: 'large-v3',
    engine: 'whisper',
    durationSec: 252,
    createdAt: NOW - 2 * HOUR,
    result: demoResult('zh', 'align', 'large-v3', 252, true, '夜空 中 最亮 的 星'),
  },
  {
    id: 'sample-2',
    title: 'Bohemian Rhapsody',
    mode: 'biasing',
    language: 'en',
    modelSize: 'large-v3',
    engine: 'whisper',
    durationSec: 355,
    createdAt: NOW - 1 * DAY,
    result: demoResult('en', 'biasing', 'large-v3', 355, false, 'Is this the real life'),
  },
  {
    id: 'sample-3',
    title: '海闊天空',
    mode: 'align',
    language: 'yue',
    modelSize: 'medium',
    engine: 'whisper',
    durationSec: 326,
    createdAt: NOW - 3 * DAY,
    result: demoResult('yue', 'align', 'medium', 326, true, '今天 我 寒夜裡 看 雪 飄過'),
  },
  {
    id: 'sample-4',
    title: 'Lemon — 米津玄師',
    mode: 'auto',
    language: 'ja',
    modelSize: 'small',
    engine: 'whisper',
    durationSec: 256,
    createdAt: NOW - 8 * DAY,
    result: demoResult('ja', 'auto', 'small', 256, false, '夢ならば どれほど よかった でしょう'),
  },
];
