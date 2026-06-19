/* ──────────────────────────────────────────────────────────────────
   storage — Settings → Storage panel ("儲存空間").

   Keys prefixed 'storage.*'. All user-visible text for the tiered-delete
   panel: the usage breakdown labels, the four tiers (single-model delete
   pointer + the three actions), each action's two-step confirm copy, the
   freed-space readout, the "desktop only" hint, and the success toasts.

   DO NOT add here: model ids (large-v3), 'venv', units (GB / MB), or
   the cache path — those render verbatim from the API payload.
   ────────────────────────────────────────────────────────────────── */

import type { Entry } from '../types';

export const storage: Record<string, Entry> = {
  // ── Section header ──
  'storage.title': { zh: '儲存空間', en: 'Storage' },
  'storage.lede': {
    zh: '看看磁碟用在哪，分層釋放空間 — 從清掉單一模型，到完全重置。',
    en: 'See where disk is used and free it in tiers — from a single model to a full reset.',
  },

  // ── Usage breakdown ──
  'storage.usage.title': { zh: '用量明細', en: 'Usage breakdown' },
  'storage.usage.venv': { zh: '後端環境', en: 'Backend env' },
  'storage.usage.venvHint': { zh: 'torch 等相依套件', en: 'torch & dependencies' },
  'storage.usage.models': { zh: '模型', en: 'Models' },
  'storage.usage.modelsHint': { zh: '已下載的模型檔', en: 'downloaded model files' },
  'storage.usage.total': { zh: '合計', en: 'Total' },
  'storage.usage.cacheDir': { zh: '模型快取資料夾', en: 'Model cache folder' },
  'storage.usage.cacheNote': {
    zh: '快取留在使用者目錄 — 重新安裝時會重複使用。',
    en: 'Cached in your user folder — reused on reinstall.',
  },
  'storage.usage.empty': { zh: '尚無已下載的模型', en: 'No models downloaded yet' },
  'storage.usage.loading': { zh: '讀取用量…', en: 'Loading usage…' },
  'storage.usage.offline': {
    zh: '後端離線 — 啟動伺服器後重整。',
    en: 'Backend offline — start the server and refresh.',
  },
  'storage.usage.refreshTitle': { zh: '重新整理用量', en: 'Refresh usage' },

  // ── Generic action chrome ──
  'storage.frees': { zh: '可釋放 {size}', en: 'Frees {size}' },
  'storage.confirmStep': { zh: '確認刪除', en: 'Confirm delete' },
  'storage.cancel': { zh: '取消', en: 'Cancel' },
  'storage.working': { zh: '處理中…', en: 'Working…' },
  'storage.desktopOnly': { zh: '桌面版可用', en: 'Desktop app only' },
  'storage.desktopOnlyHint': {
    zh: '完全重置只在桌面版可用。',
    en: 'Full reset is available in the desktop app.',
  },

  // ── Tier 1: single-model delete (pointer to the Model Manager above) ──
  'storage.single.title': { zh: '刪除單一模型', en: 'Delete a single model' },
  'storage.single.body': {
    zh: '想只移除某一個模型？在上方「模型管理」每列都有刪除鈕（必要模型會再次確認）。',
    en: 'Want to remove just one model? Each row in Models above has its own delete (required ones ask again).',
  },

  // ── Tier 2: clear all models (keep app) — amber ──
  'storage.clearModels.title': { zh: '清除所有模型（保留 App）', en: 'Clear all models (keep app)' },
  'storage.clearModels.body': {
    zh: '刪除所有已下載的模型檔（含必要模型）。App 保持安裝；下次使用時健檢會自動補回需要的模型。',
    en: 'Delete every downloaded model file (including required ones). The app stays installed; the health check re-fetches what is needed on next use.',
  },
  'storage.clearModels.action': { zh: '清除所有模型', en: 'Clear all models' },
  'storage.clearModels.confirm': {
    zh: '確定要刪除所有模型？App 會保留，需要時自動重新下載。',
    en: 'Delete all models? The app stays — needed models re-download automatically.',
  },
  'storage.clearModels.done': {
    zh: '已清除所有模型 · 釋放 {size}',
    en: 'Cleared all models · freed {size}',
  },
  'storage.clearModels.empty': {
    zh: '沒有已安裝的模型可清除。',
    en: 'No installed models to clear.',
  },

  // ── Tier 3: full reset · keep models — red/destructive ──
  'storage.resetKeep.title': { zh: '完全重置 · 保留模型', en: 'Full reset · keep models' },
  'storage.resetKeep.body': {
    zh: '刪除後端環境與工作資料；模型留在使用者快取，修復時可重複使用。下次啟動會重新跑安裝精靈。',
    en: 'Delete the backend env and work data; models stay in your user cache for reuse. The setup wizard runs again on next launch.',
  },
  'storage.resetKeep.action': { zh: '重置 · 保留模型', en: 'Reset · keep models' },
  'storage.resetKeep.confirm': {
    zh: '這會刪除後端環境並重新跑安裝精靈。模型會保留。確定繼續？',
    en: 'This deletes the backend env and re-runs the setup wizard. Models are kept. Continue?',
  },
  'storage.resetKeep.done': {
    zh: '已重置後端 · 下次啟動將重新安裝',
    en: 'Backend reset · reinstall on next launch',
  },

  // ── Tier 4: full reset · also delete models — red/destructive, strongest ──
  'storage.resetAll.title': { zh: '完全重置 · 連模型一起刪', en: 'Full reset · also delete models' },
  'storage.resetAll.body': {
    zh: '刪除所有模型「以及」後端環境 — 完全乾淨。下次啟動需重新下載數 GB 的模型。',
    en: 'Delete all models AND the backend env — a fully clean slate. Re-downloads several GB of models on next launch.',
  },
  'storage.resetAll.action': { zh: '全部刪除並重置', en: 'Delete everything · reset' },
  'storage.resetAll.confirm': {
    zh: '這會刪除所有模型「與」後端環境，無法復原。下次啟動需重新下載數 GB。確定要全部清除？',
    en: 'This deletes all models AND the backend env — not reversible. Next launch re-downloads several GB. Wipe everything?',
  },
  'storage.resetAll.done': {
    zh: '已完全重置 · 釋放 {size}',
    en: 'Full reset done · freed {size}',
  },

  // ── Errors ──
  'storage.error.generic': { zh: '操作失敗，請重試。', en: 'Action failed — please retry.' },
};
