/* ──────────────────────────────────────────────────────────────────
   common — shell + shared strings (app brand, nav tab labels, the
   StatusStrip, window controls, language toggle, and the generic
   buttons reused across tabs: 取消 / 下載 / 重試 …).

   SPLITTING RULE: an old inline bilingual string like "辨識 · Transcribe"
   becomes ONE Entry { zh: '辨識', en: 'Transcribe' }. The UI renders only
   the active language.

   DO NOT add here: model ids (large-v3), 'whisper', file extensions,
   units (GB / ms), API keys, console logs — those stay verbatim.
   ────────────────────────────────────────────────────────────────── */

import type { Entry } from '../types';

export const common: Record<string, Entry> = {
  // ── App brand ──
  'common.appName': { zh: 'Ai Caption', en: 'Ai Caption' },
  'common.appTagline': {
    zh: '本地 AI 字幕 ・ 逐字歌詞',
    en: 'Local AI captions & word-level lyrics',
  },
  'common.localFirst': { zh: '本機', en: 'LOCAL-FIRST' },

  // ── Top-level product mode (Song lyrics / Video → Subtitles / Clean Text) ──
  'common.mode.switchAria': { zh: '產品模式', en: 'Product mode' },
  'common.mode.song': { zh: '歌曲歌詞', en: 'Lyrics' },
  'common.mode.video': { zh: '影片字幕', en: 'Subtitles' },
  'common.mode.clean': { zh: '文字移除', en: 'Clean Text' },
  'common.mode.songTitle': {
    zh: '歌曲歌詞 — 分離人聲、辨識、對齊出逐字卡拉 OK',
    en: 'Song lyrics — separate vocals, transcribe, align word-level karaoke',
  },
  'common.mode.videoTitle': {
    zh: '影片字幕 — 影片或音訊轉成乾淨字幕',
    en: 'Video → Subtitles — turn a video or audio file into clean captions',
  },
  'common.mode.cleanTitle': {
    zh: '文字移除 — 框出影片上多餘的文字，AI 逐幀填補成背景並保留原音軌',
    en: 'Clean Text — box unwanted text on a video; AI fills it in frame-by-frame and keeps the original audio',
  },

  // ── Window controls (titlebar) ──
  'common.window.minimize': { zh: '最小化', en: 'Minimize' },
  'common.window.maximize': { zh: '最大化', en: 'Maximize' },
  'common.window.close': { zh: '關閉', en: 'Close' },

  // ── Navigation (tab rail) — the locked 5-tab IA ──
  'common.nav.aria': { zh: '主要分頁', en: 'Primary navigation' },
  'common.nav.transcribe': { zh: '辨識', en: 'Transcribe' },
  'common.nav.editor': { zh: '編輯', en: 'Editor' },
  'common.nav.export': { zh: '匯出', en: 'Export' },
  'common.nav.library': { zh: '紀錄', en: 'Library' },
  'common.nav.settings': { zh: '設定', en: 'Settings' },

  // ── StatusStrip ──
  'common.status.gpuOnline': { zh: 'GPU 已就緒', en: 'GPU online' },
  'common.status.cpuOnly': { zh: '僅 CPU', en: 'CPU only' },
  'common.status.offline': { zh: '離線預覽', en: 'OFFLINE' },
  'common.status.offlineTitle': {
    zh: '後端未連線 — UI 為離線預覽',
    en: 'Backend not reachable — UI in offline preview',
  },

  // ── Language toggle ──
  'common.lang.aria': { zh: '介面語言', en: 'Interface language' },
  'common.lang.zh': { zh: '中', en: '中' },
  'common.lang.en': { zh: 'EN', en: 'EN' },

  // ── Generic, reusable action buttons (shared by tabs) ──
  'common.action.cancel': { zh: '取消', en: 'Cancel' },
  'common.action.download': { zh: '下載', en: 'Download' },
  'common.action.retry': { zh: '重試', en: 'Retry' },
  'common.action.confirm': { zh: '確定', en: 'Confirm' },
  'common.action.close': { zh: '關閉', en: 'Close' },
  'common.action.save': { zh: '儲存', en: 'Save' },
  'common.action.delete': { zh: '刪除', en: 'Delete' },
  'common.action.remove': { zh: '移除', en: 'Remove' },
  'common.action.copy': { zh: '複製', en: 'Copy' },
  'common.action.copied': { zh: '已複製', en: 'Copied' },
  'common.action.open': { zh: '開啟', en: 'Open' },
  'common.action.back': { zh: '返回', en: 'Back' },
  'common.action.next': { zh: '下一步', en: 'Next' },
  'common.action.done': { zh: '完成', en: 'Done' },

  // ── Generic status words (shared) ──
  'common.state.loading': { zh: '載入中…', en: 'Loading…' },
  'common.state.empty': { zh: '沒有資料', en: 'Nothing here yet' },
  'common.state.error': { zh: '發生錯誤', en: 'Something went wrong' },

  // ── Misc shared fallbacks ──
  'common.untitledRun': { zh: '未命名項目', en: 'Untitled run' },

  // ── Mode names (job modes — shared across Transcribe / Library) ──
  'common.mode.auto': { zh: '自動', en: 'Auto' },
  'common.mode.full': { zh: '完整歌詞', en: 'Full lyrics' },
  'common.mode.partial': { zh: '片段歌詞', en: 'Partial lyrics' },
  'common.mode.style': { zh: '風格提示', en: 'Style hint' },
};
