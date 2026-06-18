import { defineConfig, type Plugin, type ResolvedConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

/* ──────────────────────────────────────────────────────────────────
   OneDrive-resilient production build.

   PROBLEM
   This project lives under a OneDrive-synced folder
   (…/OneDrive/文件/autolyrics). The frontend bundles ~1,430 tiny CJK
   web-font .woff2 files (public/fonts/noto-*). When Vite/Rollup writes
   the bundle + copies public/ directly into the OneDrive-synced dist/,
   OneDrive's filesystem filter driver intermittently corrupts the
   rapid write+rename storm and the Node process dies natively
   (STATUS_STACK_BUFFER_OVERRUN, exit 0xC0000409 / -1073740791) — AFTER
   all 1664 modules transform cleanly. It is purely an I/O-layer crash,
   not a code error: building into a non-OneDrive temp dir succeeds
   100% of the time; building into dist/ crashes intermittently.

   FIX (two cooperating plugins)
   1. redirectOutDirToTemp (enforce, runs first): rewrites build.outDir
      to a fresh temp dir OUTSIDE OneDrive (os.tmpdir()/autolyrics-dist-*)
      so all of Rollup's write+rename churn happens on a plain local
      volume the OneDrive driver never touches.
   2. syncTempToDist (post, runs in closeBundle): publishes the finished
      bundle into the real dist/ with Windows `robocopy /MIR` — the
      native bulk mirror tool, which performs the OneDrive-synced writes
      robustly where Node's libuv churn does not. Also copies public/ in
      the same mirror pass (copyPublicDir is disabled so Vite never
      walks the fonts itself). Non-Windows / robocopy-missing falls back
      to fs.cpSync.

   The canonical command (`npx vite build`, and therefore Tauri's
   beforeBuildCommand `npm run build`) is unchanged for callers and
   still emits a complete ../dist that frontendDist points at.
   ────────────────────────────────────────────────────────────────── */

const ROOT = __dirname;
const FINAL_DIST = resolve(ROOT, 'dist');
const PUBLIC_DIR = resolve(ROOT, 'public');
// Stable per-process temp out dir (one per build invocation).
const TEMP_OUT = join(tmpdir(), `autolyrics-dist-${process.pid}`);

/** Robocopy-mirror src → dest (Windows); fs.cpSync elsewhere / on failure. */
function mirror(src: string, dest: string, label: string, warn: (m: string) => void): void {
  if (!existsSync(src)) return;
  if (process.platform === 'win32') {
    // /MIR mirror (purge stale), /NFL /NDL /NJH /NJS /NP quiet,
    // /R:2 /W:1 brief retry (OneDrive may momentarily lock a file),
    // /MT:8 multi-threaded. robocopy exit codes <8 are SUCCESS.
    const r = spawnSync(
      'robocopy',
      [src, dest, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:2', '/W:1', '/MT:8'],
      { stdio: 'ignore' },
    );
    if (r.error || r.status === null || (typeof r.status === 'number' && r.status >= 8)) {
      warn(`robocopy ${label} returned ${r.status ?? r.error?.message}; falling back to fs.cpSync`);
      mkdirSync(dest, { recursive: true });
      cpSync(src, dest, { recursive: true });
    }
  } else {
    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true });
  }
}

/** (1) Force the bundle to be written outside OneDrive. */
function redirectOutDirToTemp(): Plugin {
  return {
    name: 'autolyrics-outdir-to-temp',
    apply: 'build',
    enforce: 'pre',
    config() {
      // Start each build from a clean temp dir.
      rmSync(TEMP_OUT, { recursive: true, force: true });
      mkdirSync(TEMP_OUT, { recursive: true });
      return {
        build: {
          // Vite walks the CJK fonts itself otherwise → same crash; we
          // mirror public/ in the closeBundle pass below instead.
          copyPublicDir: false,
          outDir: TEMP_OUT,
          emptyOutDir: true,
        },
      };
    },
  };
}

/** (2) Publish temp bundle + public/ into the real (OneDrive) dist/. */
function syncTempToDist(): Plugin {
  let resolved: ResolvedConfig;
  return {
    name: 'autolyrics-sync-temp-to-dist',
    apply: 'build',
    enforce: 'post',
    configResolved(c) {
      resolved = c;
    },
    closeBundle() {
      const warn = (m: string) => this.warn(m);
      // Mirror the freshly-built bundle (temp) into dist/, purging stale
      // hashed assets from previous builds.
      mirror(TEMP_OUT, FINAL_DIST, 'temp→dist', warn);
      // Layer the verbatim public/ assets (fonts etc.) on top WITHOUT
      // /MIR purge (must not delete the bundle we just mirrored): plain
      // recursive copy is fine here since public/ never collides with
      // hashed asset names.
      if (existsSync(PUBLIC_DIR)) {
        if (process.platform === 'win32') {
          const r = spawnSync(
            'robocopy',
            [PUBLIC_DIR, FINAL_DIST, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:2', '/W:1', '/MT:8'],
            { stdio: 'ignore' },
          );
          if (r.error || r.status === null || (typeof r.status === 'number' && r.status >= 8)) {
            warn(`robocopy public→dist returned ${r.status ?? r.error?.message}; falling back to fs.cpSync`);
            cpSync(PUBLIC_DIR, FINAL_DIST, { recursive: true });
          }
        } else {
          cpSync(PUBLIC_DIR, FINAL_DIST, { recursive: true });
        }
      }
      // Best-effort cleanup of the temp dir (ignore failures).
      try {
        rmSync(TEMP_OUT, { recursive: true, force: true });
      } catch {
        /* leave temp dir; OS cleans tmp eventually */
      }
      resolved?.logger.info(`\n  published bundle → ${FINAL_DIST} (OneDrive-safe via robocopy)`);
    },
  };
}

// AutoLyrics frontend — Tauri-ready (base './'), local-first dev on port 5174.
export default defineConfig({
  plugins: [react(), redirectOutDirToTemp(), syncTempToDist()],
  base: './',
  server: {
    port: 5174,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
