/* ──────────────────────────────────────────────────────────────────
   video — strings for the "Video → Subtitles" product mode.

   These cover the mode-aware Transcribe copy (title / lede / dropzone)
   plus the video preview, subtitle overlay, cue list, and the
   "runs on any laptop" reassurance. The song/lyrics copy stays in the
   transcribe / common namespaces; this file holds only the subtitle face.

   SPLITTING RULE (see common.ts): one Entry { zh, en }; the UI shows
   only the active language. Do NOT translate file extensions
   (MP4 / WebM / MOV / MKV) or units.
   ────────────────────────────────────────────────────────────────── */

import type { Entry } from '../types';

export const video: Record<string, Entry> = {
  // ── Caption burn-in (動態字幕燒錄 / hard-sub) ──
  'caption.title': { zh: '動態字幕燒錄', en: 'Burn captions into video' },
  'caption.lede': {
    zh: '把逐字字幕直接燒進影片，輸出可直接上傳社群的 MP4（保留原音軌）。',
    en: 'Bake word-by-word captions into the video — a ready-to-post MP4 (original audio kept).',
  },
  'caption.styleAria': { zh: '字幕樣式', en: 'Caption style' },
  'caption.tpl.clean': { zh: '乾淨', en: 'Clean' },
  'caption.tpl.karaoke': { zh: '卡拉OK', en: 'Karaoke' },
  'caption.tpl.bold': { zh: '社群粗體', en: 'Bold' },
  'caption.tplDesc.clean': { zh: '白字＋黑框，正在說的字轉金色', en: 'White + outline, current word gold' },
  'caption.tplDesc.karaoke': { zh: '已過白／現在金／未到灰', en: 'Sung white · now gold · ahead gray' },
  'caption.tplDesc.bold': { zh: '正在說的字加金色色塊', en: 'Current word in a gold block' },
  'caption.start': { zh: '燒錄字幕', en: 'Burn captions' },
  'caption.running': { zh: '燒錄中…', en: 'Burning…' },
  'caption.rerun': { zh: '重新燒錄', en: 'Burn again' },
  'caption.preparing': { zh: '準備中…', en: 'Preparing…' },
  'caption.download': { zh: '下載 MP4', en: 'Download MP4' },
  'caption.error.job': { zh: '字幕燒錄失敗', en: 'Caption burn failed' },
  'caption.error.offline': { zh: '連不上本機後端', en: 'Cannot reach local backend' },

  // ── Mode-aware Transcribe header ──
  'video.title': { zh: '影片字幕', en: 'Video → Subtitles' },
  'video.lede': {
    zh: '拖入一段影片或音訊，就地產生乾淨字幕 — 不需分離人聲、不需參考歌詞，全程在本機完成。',
    en: 'Drop a video or audio file and get clean captions in place — no vocal separation, no reference needed, all on your machine.',
  },

  // ── Dropzone (video) ──
  'video.drop.ariaLabel': { zh: '拖放或選擇影片 / 音訊', en: 'Drop or choose a video or audio file' },
  'video.drop.lead': {
    zh: '拖入影片，產生字幕。',
    en: 'Drop a video; get subtitles.',
  },
  'video.drop.sub': { zh: 'MP4 · WebM · MOV · MKV', en: 'MP4 · WebM · MOV · MKV' },
  'video.drop.reject': {
    zh: '這不是影片或音訊檔。請試試 MP4 · WebM · MOV · MKV。',
    en: 'Not a video or audio file — try MP4 · WebM · MOV · MKV.',
  },

  // ── Section eyebrow override (the song flow uses transcribe.section.*) ──
  'video.section.preview': { zh: '預覽', en: 'Preview' },

  // ── Run / progress copy reused under speech mode ──
  'video.run.start': { zh: '產生字幕', en: 'Generate subtitles' },
  'video.run.dropFirst': { zh: '先放一段影片', en: 'Drop a video first' },

  // ── Video preview ──
  'video.preview.ariaLabel': { zh: '影片預覽', en: 'Video preview' },
  'video.preview.empty': {
    zh: '選一段影片後，這裡會顯示預覽與字幕。',
    en: 'Choose a video to preview it with live captions here.',
  },

  // ── Subtitle overlay ──
  'video.overlay.ariaLabel': { zh: '字幕', en: 'Caption' },

  // ── Cue list ──
  'video.cues.title': { zh: '字幕段落', en: 'Subtitle cues' },
  'video.cues.ariaLabel': { zh: '字幕段落，點擊跳轉', en: 'Subtitle cues — click to seek' },
  'video.cues.empty': {
    zh: '完成後，每一句字幕都會列在這裡。',
    en: 'Once it finishes, every caption cue is listed here.',
  },
  'video.cues.count': { zh: '{count} 段', en: '{count} cues' },
  'video.cues.seekTitle': { zh: '跳到這一句', en: 'Seek to this cue' },

  // ── No-GPU reassurance (video empty state) ──
  'video.noGpu.title': {
    zh: '任何筆電都能跑 — 不需要獨立顯卡',
    en: 'Runs on any laptop — no GPU needed',
  },
  'video.noGpu.body': {
    zh: '我們會自動挑選適合 CPU 的快速模型；有獨立顯卡時則自動加速。一切都在本機進行，檔案不會上傳。',
    en: 'We auto-pick a fast, CPU-friendly model, and use your GPU automatically when one is present. Everything stays on this machine — nothing is uploaded.',
  },
  'video.noGpu.modelNote': {
    zh: '已選用快速模型：{model}',
    en: 'Using fast model: {model}',
  },

  // ── Subtitle editor (Editor tab in Video mode) ──
  'video.editor.title': { zh: '字幕編輯', en: 'Subtitle editor' },
  'video.editor.empty.title': { zh: '尚無字幕', en: 'No subtitles yet' },
  'video.editor.empty.body': {
    zh: '先在「辨識」分頁放入一段影片並產生字幕，每一句都會在這裡變成可編輯的字幕段落。',
    en: 'Drop a video in Transcribe and generate subtitles — every cue becomes editable here.',
  },
  'video.editor.badge.edited': { zh: '已編輯', en: 'Edited' },
  'video.editor.badge.demo': { zh: '示範', en: 'Demo' },
  'video.editor.cues.title': { zh: '字幕段落', en: 'Subtitle cues' },
  'video.editor.cues.count': { zh: '{count} 段', en: '{count} cues' },
  'video.editor.cues.ariaLabel': { zh: '字幕段落，點擊跳轉並可編輯', en: 'Subtitle cues — click to seek, edit inline' },
  'video.editor.hint': {
    zh: '點段落跳轉 · 編輯文字 · ± 微調 0.1 秒',
    en: 'Click a cue to seek · edit text · ± nudge 0.1s',
  },

  // ── Preview (audio-only fallback when no <video> track) ──
  'video.editor.preview.audioOnly.title': { zh: '純音訊來源', en: 'Audio-only source' },
  'video.editor.preview.audioOnly.body': {
    zh: '此來源沒有影像；下方仍可逐句校對字幕的文字與時間。',
    en: 'This source has no video track — you can still proofread cue text and timing below.',
  },
  'video.editor.preview.none.title': { zh: '沒有可預覽的來源', en: 'No source to preview' },
  'video.editor.preview.none.body': {
    zh: '在「辨識」分頁放入影片後，預覽會出現在這裡。',
    en: 'Drop a file in Transcribe and the preview appears here.',
  },

  // ── Mini transport ──
  'video.editor.transport.play': { zh: '播放', en: 'Play' },
  'video.editor.transport.pause': { zh: '暫停', en: 'Pause' },
  'video.editor.transport.seek': { zh: '拖動時間軸', en: 'Seek' },

  // ── Cue row controls ──
  'video.editor.cue.textAriaLabel': { zh: '字幕文字', en: 'Cue text' },
  'video.editor.cue.textPlaceholder': { zh: '（空白字幕）', en: '(empty cue)' },
  'video.editor.cue.seekTitle': { zh: '跳到這一句', en: 'Seek to this cue' },
  'video.editor.cue.startLabel': { zh: '起', en: 'In' },
  'video.editor.cue.endLabel': { zh: '迄', en: 'Out' },
  'video.editor.cue.startMinus': { zh: '起點 −0.1 秒', en: 'Start −0.1s' },
  'video.editor.cue.startPlus': { zh: '起點 +0.1 秒', en: 'Start +0.1s' },
  'video.editor.cue.endMinus': { zh: '終點 −0.1 秒', en: 'End −0.1s' },
  'video.editor.cue.endPlus': { zh: '終點 +0.1 秒', en: 'End +0.1s' },

  // ── Clean-mode fallback note (Editor tab is normally hidden in clean mode) ──
  'video.editor.clean.title': { zh: '文字移除沒有獨立編輯器', en: 'Clean Text has no separate editor' },
  'video.editor.clean.body': {
    zh: '文字移除是一條到底的流程 — 在「辨識」分頁框選文字、處理並下載成品影片即可。',
    en: 'Clean Text is a single flow — box the text in Transcribe, run it, and download the finished video.',
  },
};
