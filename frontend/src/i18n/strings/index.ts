/* ──────────────────────────────────────────────────────────────────
   STRINGS — the single flat, namespaced string table.

   Every namespace module exports a `Record<string, Entry>` keyed by
   dotted, namespaced keys (e.g. 'transcribe.title', 'settings.hardware').
   We merge them all into one flat map so `t('transcribe.title')` is a
   simple lookup. Tab agents only edit their own namespace file; this
   index needs no changes when they add keys.
   ────────────────────────────────────────────────────────────────── */

import type { Entry } from '../types';
import { common } from './common';
import { transcribe } from './transcribe';
import { editor } from './editor';
import { exportStrings } from './export';
import { library } from './library';
import { settings } from './settings';
import { setup } from './setup';
import { hardware } from './hardware';
import { update } from './update';
import { video } from './video';
import { clean } from './clean';

/** Flat, namespaced string table. Keys look like 'namespace.key'. */
export const STRINGS: Record<string, Entry> = {
  ...common,
  ...transcribe,
  ...editor,
  ...exportStrings,
  ...library,
  ...settings,
  ...setup,
  ...hardware,
  ...update,
  ...video,
  ...clean,
};

// Dev-only guard: catch accidental key collisions across namespaces.
// (Spreading would silently let a later namespace clobber an earlier one.)
if (import.meta.env?.DEV) {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const ns of [common, transcribe, editor, exportStrings, library, settings, setup, hardware, update, video, clean]) {
    for (const key of Object.keys(ns)) {
      if (seen.has(key)) dupes.push(key);
      seen.add(key);
    }
  }
  if (dupes.length) {
    // eslint-disable-next-line no-console
    console.warn('[i18n] duplicate string keys across namespaces:', dupes);
  }
}
