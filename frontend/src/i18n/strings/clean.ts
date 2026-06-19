/* ──────────────────────────────────────────────────────────────────
   clean — strings for the "Clean Text / 文字移除" product mode (mode 3).

   The user boxes a burned-in text region on a video; AI inpainting (LaMa)
   erases it every frame and re-encodes an mp4 with the ORIGINAL audio.

   SPLITTING RULE (see common.ts): one Entry { zh, en }; the UI shows only
   the active language. Do NOT translate file extensions (MP4) or the
   engine names (LaMa / OpenCV).
   ────────────────────────────────────────────────────────────────── */

import type { Entry } from '../types';

export const clean: Record<string, Entry> = {
  // ── Header ──
  'clean.title': { zh: '文字移除', en: 'Clean Text' },
  'clean.lede': {
    zh: '框出不小心加上的文字，AI 逐幀填補成背景，並保留原音軌。',
    en: 'Box the text you accidentally added; AI fills it in frame-by-frame and keeps the original audio.',
  },

  // ── Dropzone (clean) ──
  'clean.drop.ariaLabel': { zh: '拖放或選擇影片', en: 'Drop or choose a video' },
  'clean.drop.lead': { zh: '拖入影片', en: 'Drop a video' },
  'clean.drop.sub': { zh: 'MP4 · WebM · MOV · MKV', en: 'MP4 · WebM · MOV · MKV' },
  'clean.drop.reject': {
    zh: '這不是影片檔。請試試 MP4 · WebM · MOV · MKV。',
    en: 'Not a video file — try MP4 · WebM · MOV · MKV.',
  },

  // ── Section eyebrows ──
  'clean.section.source': { zh: '影片', en: 'Source' },
  'clean.section.box': { zh: '框出文字', en: 'Box the text' },
  'clean.section.engine': { zh: '引擎', en: 'Engine' },
  'clean.section.result': { zh: '結果', en: 'Result' },

  // ── Frame fetch ──
  'clean.frame.loading': { zh: '正在擷取畫面…', en: 'Grabbing a frame…' },

  // ── Box canvas ──
  'clean.box.ariaLabel': { zh: '在畫面上框出要移除的文字', en: 'Box the text to remove on the frame' },
  'clean.box.hint': { zh: '在文字上拉一個框', en: 'Drag a box over the text' },
  'clean.box.remove': { zh: '移除這個框', en: 'Remove this box' },
  'clean.box.count': { zh: '{count} 個框', en: '{count} boxes' },
  'clean.box.clearAll': { zh: '全部清除', en: 'Clear all' },

  // ── Engine ──
  'clean.engine.label': { zh: '填補引擎', en: 'Inpaint engine' },
  'clean.engine.lama': { zh: 'AI · LaMa（預設）', en: 'AI · LaMa (default)' },
  'clean.engine.opencv': { zh: '快速 · OpenCV', en: 'Fast · OpenCV' },
  'clean.engine.hintLama': {
    zh: 'AI 填補，效果最自然；有顯卡時自動加速。',
    en: 'AI inpainting — most natural fill; uses your GPU automatically when present.',
  },
  'clean.engine.hintOpencv': {
    zh: '傳統演算法，速度快，適合單純背景。',
    en: 'Classical algorithm — faster, best on simple backgrounds.',
  },

  // ── Run ──
  'clean.run.start': { zh: 'AI 去除文字', en: 'Remove text' },
  'clean.run.running': { zh: '處理中…', en: 'Working…' },
  'clean.run.preparing': { zh: '準備中…', en: 'Preparing…' },
  'clean.run.done': { zh: '完成 — 文字已移除，音軌保留。', en: 'Done — text removed, audio preserved.' },
  'clean.run.reset': { zh: '重新開始', en: 'Start over' },
  'clean.run.resetTitle': { zh: '清除這次結果，重新框選', en: 'Clear this result and re-box' },
  'clean.run.boxFirst': { zh: '先在文字上拉一個框', en: 'Drag a box over the text first' },

  // ── Result (before / after) ──
  'clean.result.toggleAria': { zh: '原片 / 處理後切換', en: 'Before / after toggle' },
  'clean.result.before': { zh: '原片', en: 'Before' },
  'clean.result.after': { zh: '處理後', en: 'After' },

  // ── Errors ──
  'clean.error.offline': {
    zh: '無法連線到本機後端 — 請確認服務已啟動。',
    en: 'Cannot reach the local backend — make sure it is running.',
  },
  'clean.error.frame': { zh: '擷取畫面失敗。', en: 'Could not grab a frame.' },
  'clean.error.job': { zh: '文字移除失敗。', en: 'Text removal failed.' },
};
