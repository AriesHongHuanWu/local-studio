/* The LOCKED 5-tab IA (DESIGN.md section 4). Single source for nav + router. */
import type { LucideIcon } from 'lucide-react';
import {
  AudioLines,
  TextCursorInput,
  FileOutput,
  Library,
  SlidersHorizontal,
} from 'lucide-react';
import type { AppMode } from '../../state/useMode';

export type TabKey = 'transcribe' | 'editor' | 'export' | 'library' | 'settings';

export interface TabDef {
  key: TabKey;
  /** i18n key for the tab label (resolved via t() at render). */
  labelKey: string;
  icon: LucideIcon;
}

export const TABS: TabDef[] = [
  { key: 'transcribe', labelKey: 'common.nav.transcribe', icon: AudioLines },
  { key: 'editor', labelKey: 'common.nav.editor', icon: TextCursorInput },
  { key: 'export', labelKey: 'common.nav.export', icon: FileOutput },
  { key: 'library', labelKey: 'common.nav.library', icon: Library },
  { key: 'settings', labelKey: 'common.nav.settings', icon: SlidersHorizontal },
];

/* ──────────────────────────────────────────────────────────────────
   Per-mode tab visibility. The TABS array above stays the single source
   of label/icon metadata; this just decides WHICH keys each product mode
   surfaces (and in what order).

     • song  → the full lyric workflow: 辨識 / 編輯 / 匯出 / 紀錄 / 設定.
     • video → same five tabs, but the Editor + Export are subtitle-shaped
               (Agent B reskins the Editor; Export already defaults to SRT).
     • clean → a focused video-out flow: the CleanTextFlow lives in 辨識,
               and 設定 stays reachable. 編輯/匯出/紀錄 are lyric-oriented
               and irrelevant to a clean job, so they're hidden.
   ────────────────────────────────────────────────────────────────── */
const TABS_BY_MODE: Record<AppMode, TabKey[]> = {
  song: ['transcribe', 'editor', 'export', 'library', 'settings'],
  video: ['transcribe', 'editor', 'export', 'library', 'settings'],
  clean: ['transcribe', 'settings'],
  // master → a focused audio-out flow: the MasteringFlow lives in 辨識; 設定 stays.
  master: ['transcribe', 'settings'],
  // tools → the Audio Toolbox lives in 辨識; 設定 stays.
  tools: ['transcribe', 'settings'],
  // download → the Downloader + Song Analyzer lives in 辨識; 設定 stays.
  download: ['transcribe', 'settings'],
  // catalog → the projects home lives in 辨識; 設定 stays.
  catalog: ['transcribe', 'settings'],
  // visualizer → the audio-reactive visualizer lives in 辨識; 設定 stays.
  visualizer: ['transcribe', 'settings'],
};

/** The ordered TabKeys a given product mode should show in the rail/router. */
export function tabsForMode(mode: AppMode): TabKey[] {
  return TABS_BY_MODE[mode];
}
