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
  'common.appName': { zh: 'Local Studio', en: 'Local Studio' },
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
  'common.mode.master': { zh: '母帶', en: 'Mastering' },
  'common.mode.masterTitle': {
    zh: '母帶 — 依曲風或參考曲自動 EQ／壓縮／響度，輸出錄音室級母帶',
    en: 'Auto-Mastering — genre/reference EQ, compression & loudness for a release-ready master',
  },

  // ── Auto-Mastering (母帶) mode ──
  'master.title': { zh: '母帶處理', en: 'Auto-Mastering' },
  'master.lede': {
    zh: '上傳混音，選曲風或參考曲，本機 AI 自動 EQ／壓縮／立體聲寬度／響度，輸出可直接發佈的母帶。',
    en: 'Drop a mix, pick a genre or reference, and the local AI does EQ, compression, width & loudness for a release-ready master.',
  },
  'master.section.source': { zh: '來源', en: 'Source' },
  'master.section.style': { zh: '風格', en: 'Style' },
  'master.section.loudness': { zh: '響度目標', en: 'Loudness target' },
  'master.section.result': { zh: '結果', en: 'Result' },
  'master.drop': { zh: '拖放或選擇一首混音', en: 'Drop or choose a mix' },
  'master.original': { zh: '原始', en: 'Original' },
  'master.mastered': { zh: '母帶後', en: 'Mastered' },
  'master.genreLabel': { zh: '曲風預設', en: 'Genre preset' },
  'master.refLabel': { zh: '參考曲（選用）', en: 'Reference track (optional)' },
  'master.refDrop': { zh: '上傳一首「想要的聲音」', en: 'Upload a track you want to sound like' },
  'master.refHint': {
    zh: '有參考曲時，會比對它的音色（頻譜）來調整，忽略曲風預設。',
    en: 'With a reference, it matches that track’s tonal balance instead of the genre preset.',
  },
  'master.loud.streaming': { zh: '串流', en: 'Streaming' },
  'master.loud.balanced': { zh: '平衡', en: 'Balanced' },
  'master.loud.social': { zh: '社群', en: 'Social' },
  'master.loudDesc.streaming': { zh: 'Spotify/Apple/YouTube 標準', en: 'Spotify/Apple/YouTube standard' },
  'master.loudDesc.balanced': { zh: '較動態、通用', en: 'More dynamic, all-round' },
  'master.loudDesc.social': { zh: '較大聲，手機更有衝擊力', en: 'Louder, punchier on phones' },
  'master.start': { zh: '開始母帶處理', en: 'Master it' },
  'master.running': { zh: '處理中…', en: 'Mastering…' },
  'master.rerun': { zh: '重新處理', en: 'Master again' },
  'master.preparing': { zh: '準備中…', en: 'Preparing…' },
  'master.download': { zh: '下載母帶 (WAV)', en: 'Download master (WAV)' },
  'master.unavailable': {
    zh: '母帶相依未安裝 — 請到設定→修復，或重新安裝引擎。',
    en: 'Mastering deps not installed — repair in Settings or re-run setup.',
  },
  'master.stat.loudness': { zh: '響度', en: 'Loudness' },
  'master.stat.peak': { zh: '真峰', en: 'True peak' },
  'master.stat.gain': { zh: '增益', en: 'Gain' },
  'master.stat.gainSub': { zh: '響度提升', en: 'loudness lift' },
  'master.stat.source': { zh: '依據', en: 'Based on' },
  'master.stat.reference': { zh: '參考曲', en: 'Reference' },
  'master.error.job': { zh: '母帶處理失敗', en: 'Mastering failed' },
  'master.error.offline': { zh: '連不上本機後端', en: 'Cannot reach local backend' },

  // ── Section dynamics (verse/chorus) ──
  'master.section.dynamics': { zh: '區段動態（主歌／副歌）', en: 'Section dynamics' },
  'master.dyn.balance': { zh: '平衡', en: 'Balance' },
  'master.dyn.punch': { zh: '爆發力', en: 'Punch' },
  'master.dyn.punchHint': {
    zh: '把副歌（較滿的段落）推得更大、主歌壓小 → 對比更強、更有衝擊力。',
    en: 'Pushes the chorus louder and verses softer → stronger contrast, more impact.',
  },
  'master.dyn.balanceHint': {
    zh: '把各段落音量拉近 → 整首更一致、更耐聽。',
    en: 'Levels sections toward each other → more consistent, easier listen.',
  },
  'master.dyn.offHint': {
    zh: '保持原本的段落動態（不主動增減）。',
    en: 'Keeps the original section dynamics (no riding).',
  },

  // ── Advanced (manual) ──
  'master.advanced': { zh: '進階手動調整', en: 'Advanced (manual)' },
  'master.adv.eq': { zh: 'EQ 等化（疊加在預設上）', en: 'EQ (added on top of preset)' },
  'master.adv.bass': { zh: '低頻', en: 'Bass' },
  'master.adv.lowMid': { zh: '低中頻', en: 'Low-mid' },
  'master.adv.presence': { zh: '臨場', en: 'Presence' },
  'master.adv.air': { zh: '空氣感', en: 'Air' },
  'master.adv.dynamicsGroup': { zh: '動態與空間', en: 'Dynamics & space' },
  'master.adv.comp': { zh: '壓縮強度', en: 'Compression' },
  'master.adv.width': { zh: '立體聲寬度', en: 'Stereo width' },
  'master.adv.ceiling': { zh: '真峰天花板', en: 'True-peak ceiling' },
  'master.adv.reset': { zh: '重設進階', en: 'Reset advanced' },

  // ── Smart analysis (intelligent auto-mastering) ──
  'master.section.analysis': { zh: '智慧分析', en: 'Smart analysis' },
  'master.analyzing': { zh: '分析這首歌中…', en: 'Analyzing this track…' },

  // Auto-mode transparency banner
  'master.auto.title': { zh: '🪄 智慧自動將套用', en: '🪄 Auto will apply' },
  'master.auto.clean': { zh: '這首歌已相當均衡 —— 只做輕微優化與響度校正。', en: 'This track is already well-balanced — only light polish + loudness.' },
  'master.auto.lowcut': { zh: '低切', en: 'Low-cut' },
  'master.auto.monobass': { zh: '低頻單聲', en: 'Mono bass' },
  'master.auto.width': { zh: '寬度', en: 'Width' },

  // Auto-correction strength dial
  'master.strength.label': { zh: '自動校正力度', en: 'Auto-correction strength' },
  'master.strength.natural': { zh: '自然', en: 'Natural' },
  'master.strength.balanced': { zh: '平衡', en: 'Balanced' },
  'master.strength.strong': { zh: '強力', en: 'Strong' },
  'master.strength.hint': {
    zh: '越自然 = 修正越輕、越保留原味;越強力 = 越貼近「理想母帶」的頻率平衡。',
    en: 'Natural = lighter, keeps your character; Strong = pushes closer to the ideal target balance.',
  },

  // Loudness-matched A/B compare
  'master.dlSaved': { zh: '已儲存 ✓', en: 'Saved ✓' },
  'master.dlDone': { zh: '已下載 ✓', en: 'Downloaded ✓' },
  'master.dlFail': { zh: '下載失敗,請重試', en: 'Download failed — try again' },

  // Pro mode — fully-parametric EQ (per-band phase + Mid/Side/L/R routing)
  'master.pro.toggle': { zh: 'Pro 進階:全參數 EQ', en: 'Pro: parametric EQ' },
  'master.pro.hint': {
    zh: '拖曳曲線上的點調整每段(頻率↔左右、增益↔上下);每段可設類型、Q、相位(自然/線性)與聲道(立體聲/中/側/左/右)。',
    en: 'Drag a node (freq ↔ x, gain ↔ y). Each band has its own type, Q, phase (natural/linear) and channel (Stereo/Mid/Side/L/R).',
  },
  'master.adaptive.toggle': { zh: '適應性 EQ ·自動 automation', en: 'Adaptive EQ · auto automation' },
  'master.adaptive.hint': {
    zh: '把歌切成時間窗,讓校正曲線「隨段落自動改變」——主歌糊就修主歌、副歌刺就修副歌,過了就放開。等於工程師全程自動 ride EQ,整首歌都好聽。',
    en: 'Slices the song into windows so the corrective EQ rides the music section by section — tame a dull verse, soften a harsh chorus, then let go. Like an engineer automating the EQ across the whole song.',
  },
  'master.auto.toggle': { zh: 'EQ 自動化曲線(手動畫)', en: 'EQ automation (draw curves)' },
  'master.auto.hint': {
    zh: '像 DAW:自己畫「某頻段的增益隨時間變化」。例:副歌時把高頻拉亮、橋段把低頻收一點。拖點移動、點空白處新增、雙擊刪除。',
    en: 'Like a DAW: draw how a band\'s gain moves over the song — lift the highs in the chorus, dip the lows in the bridge. Drag points, click to add, double-click to remove.',
  },
  'master.auto.add': { zh: '＋ 新增曲線', en: '+ Add lane' },
  'master.auto.remove': { zh: '刪除此曲線', en: 'Remove lane' },
  'master.auto.freq': { zh: '頻率', en: 'Freq' },
  'master.auto.tip': { zh: '拖點 · 點空白新增 · 雙擊刪除', en: 'Drag · click to add · double-click to remove' },
  'master.chain.automation': { zh: 'EQ自動化', en: 'EQ Autom.' },
  'master.mb.toggle': { zh: '手動多頻段壓縮', en: 'Manual multiband compressor' },
  'master.mb.hint': {
    zh: '自訂分頻點切成多段,每段獨立壓縮(threshold/ratio/attack/release/knee/makeup)+ 中/側分壓 + 立體聲寬度。取代自動壓縮。',
    en: 'Split into custom bands; compress each independently (threshold/ratio/attack/release/knee/makeup) + Mid-Side + stereo width. Replaces auto compression.',
  },
  'master.mb.bands': { zh: '{n} 段', en: '{n} bands' },
  'master.mb.add': { zh: '＋ 分頻', en: '+ Split' },
  'master.mb.threshold': { zh: '門檻', en: 'Thresh' },
  'master.mb.ratio': { zh: '比率', en: 'Ratio' },
  'master.mb.attack': { zh: '起音', en: 'Attack' },
  'master.mb.release': { zh: '釋放', en: 'Release' },
  'master.mb.knee': { zh: '膝', en: 'Knee' },
  'master.mb.makeup': { zh: '補償', en: 'Makeup' },
  'master.mb.width': { zh: '寬度', en: 'Width' },
  'master.mb.bypass': { zh: '略過', en: 'Bypass' },
  'master.mb.split': { zh: '分頻點', en: 'Crossover' },
  'master.mb.msHint': { zh: '中/側分別壓縮(切換 L/R ↔ M/S)', en: 'Compress Mid/Side separately (toggle L/R ↔ M/S)' },
  'master.peq.add': { zh: '＋ 新增頻段', en: '+ Add band' },
  'master.peq.bands': { zh: '{n} 段啟用', en: '{n} band(s)' },
  'master.peq.type': { zh: '類型', en: 'Type' },
  'master.peq.freq': { zh: '頻率', en: 'Freq' },
  'master.peq.gain': { zh: '增益', en: 'Gain' },
  'master.peq.q': { zh: 'Q', en: 'Q' },
  'master.peq.phase': { zh: '相位', en: 'Phase' },
  'master.peq.min': { zh: '自然', en: 'Natural' },
  'master.peq.linear': { zh: '線性', en: 'Linear' },
  'master.peq.channel': { zh: '聲道', en: 'Channel' },
  'master.peq.remove': { zh: '刪除此段', en: 'Remove band' },
  'master.peq.t.bell': { zh: 'Bell', en: 'Bell' },
  'master.peq.t.low_shelf': { zh: '低棚', en: 'Low shelf' },
  'master.peq.t.high_shelf': { zh: '高棚', en: 'High shelf' },
  'master.peq.t.high_pass': { zh: '高通', en: 'High-pass' },
  'master.peq.t.low_pass': { zh: '低通', en: 'Low-pass' },
  'master.peq.t.notch': { zh: 'Notch', en: 'Notch' },
  'master.peq.t.allpass': { zh: 'All-pass', en: 'All-pass' },
  'master.peq.ch.stereo': { zh: '立體聲', en: 'Stereo' },
  'master.peq.ch.mid': { zh: '中 (M)', en: 'Mid' },
  'master.peq.ch.side': { zh: '側 (S)', en: 'Side' },
  'master.peq.ch.left': { zh: '左 (L)', en: 'Left' },
  'master.peq.ch.right': { zh: '右 (R)', en: 'Right' },

  'master.ab.label': { zh: 'A/B 對比', en: 'A/B compare' },
  'master.ab.mastered': { zh: 'A · 母帶後', en: 'A · Mastered' },
  'master.ab.original': { zh: 'B · 原曲', en: 'B · Original' },
  'master.ab.external': { zh: 'C · 外部母帶', en: 'C · External' },
  'master.ab.extUpload': { zh: '＋ 上傳外部母帶做三方比較', en: '+ Add an external master to compare' },
  'master.ab.matching': { zh: '匹配響度中…', en: 'Loudness-matching…' },
  'master.ab.extFail': { zh: '匹配失敗,請重試', en: 'Match failed — try again' },
  'master.ab.why3': {
    zh: '三方等響度比較:A 本軟體母帶 · B 原曲 · C 外部母帶(如 LANDR/Ozone)。全部調到同響度,直接聽哪個音色與動態最好 —— 公平、不被音量騙。空白鍵播放,A/B/C 鍵切換。',
    en: 'Three-way at equal loudness: A this app · B original · C external (e.g. LANDR/Ozone). All matched to the same loudness so you judge tone & dynamics directly. Space to play; A/B/C to switch.',
  },
  'master.ab.play': { zh: '播放', en: 'Play' },
  'master.ab.pause': { zh: '暫停', en: 'Pause' },
  'master.ab.seek': { zh: '進度', en: 'Seek' },
  'master.ab.loudnessMatch': { zh: '響度匹配', en: 'Loudness-matched' },
  'master.ab.lmatchOn': { zh: '開(同響度公平比較)', en: 'On (same loudness)' },
  'master.ab.lmatchOff': { zh: '關(聽得出變大聲)', en: 'Off (hear it get louder)' },
  'master.ab.why': {
    zh: '開「響度匹配」後,原曲會被調到和母帶一樣大聲 —— 你比較的是「音色與動態」,不會被「比較大聲」騙過去。關掉就能直接聽母帶讓整體變大聲多少。空白鍵播放,按 A / B 瞬間切換。',
    en: 'With loudness-matching on, the original is turned up to the master’s loudness — so you judge tone and dynamics, not just “louder = better.” Turn it off to hear how much louder mastering made it. Space to play; press A / B to switch.',
  },

  // Band labels
  'master.band.sub': { zh: '超低', en: 'Sub' },
  'master.band.bass': { zh: '低頻', en: 'Bass' },
  'master.band.lowMid': { zh: '低中', en: 'Lo-mid' },
  'master.band.mid': { zh: '中頻', en: 'Mid' },
  'master.band.highMid': { zh: '高中', en: 'Hi-mid' },
  'master.band.presence': { zh: '臨場', en: 'Presence' },
  'master.band.air': { zh: '空氣', en: 'Air' },

  // Analysis panel block titles
  'master.an.metrics': { zh: '專業量測', en: 'Pro metrics' },
  'master.an.spectrum': { zh: '頻譜', en: 'Spectrum' },
  'master.an.bands': { zh: '頻段平衡', en: 'Band balance' },
  'master.an.sections': { zh: '區段動態（主歌／副歌）', en: 'Section dynamics' },
  'master.an.compare': { zh: '處理前後頻譜', en: 'Before → after spectrum' },
  'master.an.finalMetrics': { zh: '母帶量測', en: 'Master metrics' },
  'master.an.scoreDelta': { zh: '分數', en: 'score' },

  // Viz labels / aria
  'master.viz.before': { zh: '原始', en: 'Original' },
  'master.viz.predicted': { zh: '預測', en: 'Predicted' },
  'master.viz.target': { zh: '目標', en: 'Target' },
  'master.viz.spectrumAria': { zh: '頻譜曲線', en: 'Frequency spectrum' },
  'master.viz.bandsAria': { zh: '頻段平衡長條圖', en: 'Band balance bars' },
  'master.viz.sectionsAria': { zh: '區段能量與增益', en: 'Section energy and gain' },

  // Metric cards
  'master.metric.loudness': { zh: '整合響度', en: 'Loudness' },
  'master.metric.integrated': { zh: 'Integrated', en: 'Integrated' },
  'master.metric.lra': { zh: '響度範圍', en: 'Loudness range' },
  'master.metric.lraSub': { zh: 'LRA · 動態幅度', en: 'LRA · dynamics' },
  'master.metric.truePeak': { zh: '真峰', en: 'True peak' },
  'master.metric.truePeakSub': { zh: '≤ −1 安全', en: '≤ −1 safe' },
  'master.metric.dynamics': { zh: '動態', en: 'Dynamics' },
  'master.metric.crest': { zh: '波峰因數', en: 'Crest' },
  'master.metric.stereo': { zh: '立體聲', en: 'Stereo' },
  'master.metric.correlation': { zh: '相關性', en: 'Correlation' },
  'master.metric.lowMono': { zh: '低頻單聲', en: 'Bass mono' },
  'master.metric.lowMonoSub': { zh: '<150Hz 相關', en: '<150Hz corr.' },

  // Diagnosis (score + problems)
  'master.diag.score': { zh: '分', en: 'score' },
  'master.diag.clean': { zh: '太棒了 —— 沒偵測到明顯問題。', en: 'Great — no notable issues detected.' },

  // Section dynamics legend
  'master.sect.chorus': { zh: '副歌', en: 'Chorus' },
  'master.sect.verse': { zh: '主歌', en: 'Verse' },
  'master.sect.energy': { zh: '能量', en: 'Energy' },
  'master.sect.applied': { zh: '套用增益', en: 'Applied gain' },

  // Pro chain (v0.1.17): live spectrum, imager, GR meters, chain view
  'master.live.original': { zh: '原始 · 即時頻譜', en: 'Original · live spectrum' },
  'master.live.mastered': { zh: '母帶 · 即時頻譜', en: 'Mastered · live spectrum' },
  'master.an.chain': { zh: '訊號鏈', en: 'Signal chain' },
  'master.an.gr': { zh: '壓縮量(增益衰減)', en: 'Compression (gain reduction)' },
  'master.an.imager': { zh: '立體聲音場', en: 'Stereo field' },
  'master.viz.gonioAria': { zh: '立體聲示波器', en: 'Stereo goniometer' },
  'master.imager.correlation': { zh: '相位相關', en: 'Phase corr.' },
  'master.imager.low': { zh: '低', en: 'Low' },
  'master.imager.mid': { zh: '中', en: 'Mid' },
  'master.imager.high': { zh: '高', en: 'High' },
  'master.gr.low': { zh: '低頻', en: 'Low' },
  'master.gr.mid': { zh: '中頻', en: 'Mid' },
  'master.gr.high': { zh: '高頻', en: 'High' },
  'master.gr.deess': { zh: '齒音', en: 'De-ess' },
  'master.gr.dyneq': { zh: '動態EQ', en: 'Dyn EQ' },
  'master.chain.aria': { zh: '母帶訊號鏈', en: 'Mastering signal chain' },
  'master.chain.eq': { zh: 'EQ', en: 'EQ' },
  'master.chain.adaptive': { zh: '適應EQ', en: 'Adaptive' },
  'master.chain.dyneq': { zh: '動態EQ', en: 'Dyn EQ' },
  'master.chain.deess': { zh: '齒音', en: 'De-ess' },
  'master.chain.multiband': { zh: '多頻段', en: 'Multiband' },
  'master.chain.dynamics': { zh: '區段', en: 'Dynamics' },
  'master.chain.saturate': { zh: '飽和', en: 'Saturate' },
  'master.chain.width': { zh: '寬度', en: 'Width' },
  'master.chain.residual': { zh: '二次EQ', en: 'EQ2' },
  'master.chain.limit': { zh: '限幅', en: 'Limit' },

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
  'common.status.starting': { zh: '啟動引擎中…', en: 'Starting engine…' },
  'common.status.startingTitle': {
    zh: '正在啟動本機引擎(首次載入需 20–30 秒)',
    en: 'Starting the local engine (20–30s on first load)',
  },

  // Boot-failed recovery (engine on disk but didn't answer in time)
  'common.boot.failed': {
    zh: '引擎啟動較久或未能就緒 —— 可再等一下並重試,或重新安裝引擎。',
    en: 'The engine is taking long or did not start — wait and retry, or reinstall it.',
  },
  'common.boot.retry': { zh: '重試連線', en: 'Retry' },
  'common.boot.repair': { zh: '重新安裝引擎', en: 'Reinstall engine' },

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
