/* ──────────────────────────────────────────────────────────────────
   health — Environment health-check + self-heal banner strings.

   Keys prefixed 'health.*'. All user-visible text for the HealthBanner:
   severity headings, the "缺少…" enumeration, localized labels for known
   missing pieces (models + deps), reason codes, the Repair / Dismiss /
   Cancel actions, aggregated progress, and the "已修復" success note.

   DO NOT add here: model ids (large-v3, big-lama.pt), package names
   (torch, demucs), file extensions, units — those render verbatim from
   the API payload. The label map below covers the KNOWN ids so the user
   sees friendly names; unknown ids fall back to the API's `label`.
   ────────────────────────────────────────────────────────────────── */

import type { Entry } from '../types';

export const health: Record<string, Entry> = {
  // ── Severity headings ──
  'health.titleRequired': { zh: '缺少必要組件', en: 'Missing required components' },
  'health.titleOptional': { zh: '有可選組件未安裝', en: 'Some optional components are not installed' },

  // ── Enumeration of what is missing ("缺少：A、B、C") ──
  'health.missingPrefix': { zh: '缺少：', en: 'Missing: ' },
  /** Joiner between enumerated items (CJK uses 、; en uses ", "). */
  'health.listJoin': { zh: '、', en: ', ' },

  // ── Body lines per severity ──
  'health.requiredBody': {
    zh: '部分核心功能無法使用，正在自動重新載入需要的組件（會重複使用已下載的快取）。',
    en: 'Some core features are unavailable. Re-fetching the required components automatically (already-cached files are reused).',
  },
  'health.optionalBody': {
    zh: '這些是可選組件，現在的功能仍可使用。你可以在需要時手動修復。',
    en: 'These are optional. The app still works without them — repair them manually whenever you need them.',
  },

  // ── Actions ──
  'health.repair': { zh: '立即修復', en: 'Repair' },
  'health.repairAll': { zh: '修復全部', en: 'Repair all' },
  'health.cancel': { zh: '取消', en: 'Cancel' },
  'health.dismiss': { zh: '略過', en: 'Dismiss' },
  'health.recheck': { zh: '重新檢查', en: 'Re-check' },

  // ── Aggregated progress ──
  'health.repairing': { zh: '修復中…', en: 'Repairing…' },
  'health.repairingProgress': {
    zh: '修復中… {done}/{total}',
    en: 'Repairing… {done}/{total}',
  },
  'health.repairingItem': { zh: '正在處理 {label}…', en: 'Working on {label}…' },
  'health.installingDeps': {
    zh: '正在安裝相依套件（略過已安裝的）…',
    en: 'Installing dependencies (skipping already-installed)…',
  },
  'health.progressLabel': {
    zh: '修復進度 {pct}%',
    en: 'Repair progress {pct}%',
  },

  // ── Outcome ──
  'health.repaired': { zh: '已修復', en: 'Repaired' },
  'health.repairFailed': { zh: '修復失敗', en: 'Repair failed' },
  'health.repairFailedRetry': {
    zh: '部分組件修復失敗，請重試。',
    en: 'Some components could not be repaired. Please retry.',
  },

  // ── Category prefixes (used when an item has no localized label) ──
  'health.category.dep': { zh: '相依套件', en: 'dependency' },
  'health.category.model': { zh: '模型', en: 'model' },

  // ── Reason codes (why a feature needs this piece) ──
  'health.reason.cleanText': { zh: '文字移除需要', en: 'needed for Clean Text' },
  'health.reason.separation': { zh: '人聲分離需要', en: 'needed for vocal separation' },
  'health.reason.alignment': { zh: '逐字對齊需要', en: 'needed for word-level alignment' },
  'health.reason.transcribe': { zh: '辨識需要', en: 'needed for transcription' },
  'health.reason.core': { zh: '核心相依套件', en: 'core dependency' },
  'health.reason.gpu': { zh: 'GPU 加速需要', en: 'needed for GPU acceleration' },

  // ── a11y ──
  'health.bannerAria': { zh: '環境健檢', en: 'Environment health-check' },

  // ──────────────────────────────────────────────────────────────────
  // Localized friendly labels for KNOWN missing ids. Unknown ids fall
  // back to the raw `label` from the API. Model ids / package names stay
  // verbatim by design (proper nouns), so zh and en often match.
  // ──────────────────────────────────────────────────────────────────

  // Models
  'health.label.lama': { zh: 'LaMa 修補模型', en: 'LaMa inpainting model' },
  'health.label.aligner-mms': { zh: 'MMS 對齊模型', en: 'MMS aligner model' },
  'health.label.demucs-htdemucs': { zh: 'Demucs 人聲分離', en: 'Demucs separation' },
  'health.label.demucs-ft': { zh: 'Demucs 微調模型', en: 'Demucs fine-tuned' },
  'health.label.whisper': { zh: 'Whisper 辨識模型', en: 'Whisper model' },

  // Deps (package names kept verbatim, but described bilingually)
  'health.label.torch': { zh: 'PyTorch（torch）', en: 'PyTorch (torch)' },
  'health.label.torchaudio': { zh: 'torchaudio', en: 'torchaudio' },
  'health.label.faster-whisper': { zh: 'faster-whisper', en: 'faster-whisper' },
  'health.label.faster_whisper': { zh: 'faster-whisper', en: 'faster-whisper' },
  'health.label.demucs': { zh: 'Demucs', en: 'Demucs' },
  'health.label.av': { zh: 'PyAV（av）', en: 'PyAV (av)' },
  'health.label.cv2': { zh: 'OpenCV（cv2）', en: 'OpenCV (cv2)' },
  'health.label.opencv': { zh: 'OpenCV', en: 'OpenCV' },
  'health.label.simple_lama_inpainting': { zh: 'simple-lama-inpainting', en: 'simple-lama-inpainting' },
};
