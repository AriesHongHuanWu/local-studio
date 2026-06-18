/* The LOCKED 5-tab IA (DESIGN.md section 4). Single source for nav + router. */
import type { LucideIcon } from 'lucide-react';
import {
  AudioLines,
  TextCursorInput,
  FileOutput,
  Library,
  SlidersHorizontal,
} from 'lucide-react';

export type TabKey = 'transcribe' | 'editor' | 'export' | 'library' | 'settings';

export interface TabDef {
  key: TabKey;
  zh: string;
  en: string;
  icon: LucideIcon;
}

export const TABS: TabDef[] = [
  { key: 'transcribe', zh: '辨識', en: 'Transcribe', icon: AudioLines },
  { key: 'editor', zh: '編輯', en: 'Editor', icon: TextCursorInput },
  { key: 'export', zh: '匯出', en: 'Export', icon: FileOutput },
  { key: 'library', zh: '紀錄', en: 'Library', icon: Library },
  { key: 'settings', zh: '設定', en: 'Settings', icon: SlidersHorizontal },
];
