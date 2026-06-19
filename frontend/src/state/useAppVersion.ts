/* ──────────────────────────────────────────────────────────────────
   useAppVersion — the REAL installed app version.

   Inside Tauri we read it from the bundle via @tauri-apps/api/app
   getVersion() (the single source of truth for "what's installed").
   In plain-browser / before it resolves we fall back to the backend's
   reported meta.version — which can be the offline "0.1.0-local"
   fallback, so it must NOT be the primary source for the version label.
   ────────────────────────────────────────────────────────────────── */

import { useEffect, useState } from 'react';
import { useMeta } from './useMeta';

const IN_TAURI = '__TAURI_INTERNALS__' in window;

export function useAppVersion(): string | null {
  const metaVersion = useMeta((s) => s.meta.version);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!IN_TAURI) return;
    let alive = true;
    import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then((v) => {
        if (alive) setAppVersion(v);
      })
      .catch(() => {
        /* keep falling back to meta.version */
      });
    return () => {
      alive = false;
    };
  }, []);

  return appVersion ?? metaVersion ?? null;
}
