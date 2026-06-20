#!/usr/bin/env node
/* ──────────────────────────────────────────────────────────────────────────
   make-latest-json.mjs — build the Tauri v2 updater manifest (latest.json).

   The Tauri v2 updater (plugins.updater.endpoints in tauri.conf.json) fetches
   a `latest.json` and compares its `version` against the running app. If newer,
   it downloads the artifact at `platforms[<target>].url` and verifies it against
   `platforms[<target>].signature` using the bundled `pubkey`. This script
   produces that `latest.json` from the freshly-built NSIS artifacts.

   What it does:
     1. Reads the app version from tauri.conf.json (override with --version).
     2. Finds the NSIS installer (`*-setup.exe`) and its detached signature
        (`*-setup.exe.sig`) under the release bundle directory.
     3. Reads the .sig contents verbatim (Tauri's minisign signature blob).
     4. Builds the GitHub release download URL for the installer.
     5. Writes a deterministic latest.json (no implicit Date.now()).

   Schema written (Tauri v2):
     {
       "version": "<x.y.z>",
       "notes":   "<release notes>",
       "pub_date":"<RFC3339 / ISO-8601 timestamp>",
       "platforms": {
         "windows-x86_64": {
           "signature": "<contents of the .sig file>",
           "url": "https://github.com/<owner>/<repo>/releases/download/v<version>/<setup.exe>"
         }
       }
     }

   USAGE (run from anywhere; paths are resolved relative to this script):
     node scripts/make-latest-json.mjs \
       --date 2026-06-19T12:00:00Z \
       --notes-file NOTES.md \
       [--version 0.2.0] [--tag v0.2.0] \
       [--repo AriesHongHuanWu/local-studio] \
       [--target windows-x86_64] \
       [--out frontend/src-tauri/target/release/bundle/latest.json] \
       [--bundle-dir <path to .../bundle>]

   ARGS (all optional except where noted):
     --version <x.y.z>   App version. Default: read from tauri.conf.json.
     --tag <vX.Y.Z>      Git release tag used in the download URL.
                         Default: "v<version>".
     --notes <text>      Inline release notes string.
     --notes-file <p>    Read release notes from a file (overrides --notes).
                         Default: NOTES.md at repo root if present, else "".
     --date <iso>        pub_date. REQUIRED for reproducible output — this
                         script never calls Date.now(); pass an explicit
                         timestamp (e.g. the GitHub release's published_at).
     --repo <owner/repo> GitHub "owner/repo". Default: AriesHongHuanWu/local-studio.
     --target <id>       Updater platform key. Default: windows-x86_64.
     --bundle-dir <p>    Override the bundle dir to scan for artifacts.
     --setup <p>         Explicit path to the *-setup.exe (skips discovery).
     --out <p>           Output path for latest.json. Default: <bundle>/latest.json.
     --pretty            Pretty-print the JSON (default: compact-ish, 2-space).
     --help              Print this help and exit.

   EXIT CODES: 0 ok · 1 bad args / missing artifacts · 2 I/O error.
   ────────────────────────────────────────────────────────────────────────── */

import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// ── Repo layout: this file lives at <repo>/scripts/make-latest-json.mjs ──────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SRC_TAURI = path.join(REPO_ROOT, 'frontend', 'src-tauri');
const TAURI_CONF = path.join(SRC_TAURI, 'tauri.conf.json');
const DEFAULT_BUNDLE_DIR = path.join(SRC_TAURI, 'target', 'release', 'bundle');
const DEFAULT_REPO = 'AriesHongHuanWu/local-studio';
const DEFAULT_TARGET = 'windows-x86_64';

// ── Tiny arg parser (--key value  and  --flag) ──────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) continue;
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true; // boolean flag
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function die(code, msg) {
  console.error(`make-latest-json: ${msg}`);
  process.exit(code);
}

function printHelpAndExit() {
  // Print the top doc comment's USAGE block by echoing a concise version.
  console.log(
    [
      'Usage: node scripts/make-latest-json.mjs --date <iso> [options]',
      '',
      '  --version <x.y.z>   default: read from tauri.conf.json',
      '  --tag <vX.Y.Z>      default: v<version>',
      '  --notes <text>      inline release notes',
      '  --notes-file <p>    read notes from a file (overrides --notes)',
      '  --date <iso>        pub_date (explicit; no Date.now)',
      '  --repo <owner/repo> default: ' + DEFAULT_REPO,
      '  --target <id>       default: ' + DEFAULT_TARGET,
      '  --bundle-dir <p>    default: <src-tauri>/target/release/bundle',
      '  --setup <p>         explicit *-setup.exe path (skips discovery)',
      '  --out <p>           default: <bundle>/latest.json',
      '  --pretty            pretty-print output',
    ].join('\n'),
  );
  process.exit(0);
}

// ── Recursively find the first file matching a predicate (depth-first) ──────
function findFile(dir, predicate) {
  if (!existsSync(dir)) return null;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  // Sort for determinism: files before dirs, alphabetical within.
  entries.sort((a, b) => Number(a.isDirectory()) - Number(b.isDirectory()) || a.name.localeCompare(b.name));
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const hit = findFile(full, predicate);
      if (hit) return hit;
    } else if (predicate(e.name, full)) {
      return full;
    }
  }
  return null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) printHelpAndExit();

  // ── version: --version override, else from tauri.conf.json ──
  let version = typeof args.version === 'string' ? args.version : null;
  if (!version) {
    if (!existsSync(TAURI_CONF)) {
      die(1, `tauri.conf.json not found at ${TAURI_CONF} (pass --version to override)`);
    }
    let conf;
    try {
      conf = JSON.parse(readFileSync(TAURI_CONF, 'utf8'));
    } catch (err) {
      die(2, `failed to parse ${TAURI_CONF}: ${err.message}`);
    }
    version = conf.version;
    if (!version) {
      die(1, `no "version" field in ${TAURI_CONF} (pass --version)`);
    }
  }
  // Strip a leading "v" if someone passed --version v0.2.0.
  version = String(version).replace(/^v/i, '');

  // ── tag for the download URL (default v<version>) ──
  const tag = typeof args.tag === 'string' ? args.tag : `v${version}`;

  // ── repo + target ──
  const repo = typeof args.repo === 'string' ? args.repo : DEFAULT_REPO;
  if (!/^[^/]+\/[^/]+$/.test(repo)) {
    die(1, `--repo must look like "owner/repo", got "${repo}"`);
  }
  const target = typeof args.target === 'string' ? args.target : DEFAULT_TARGET;

  // ── pub_date: explicit only (no Date.now — keeps output reproducible) ──
  if (typeof args.date !== 'string') {
    die(1, '--date <iso8601> is required (e.g. 2026-06-19T12:00:00Z). This script never calls Date.now().');
  }
  const pubDate = args.date;
  if (Number.isNaN(Date.parse(pubDate))) {
    die(1, `--date "${pubDate}" is not a parseable timestamp (use ISO-8601 / RFC3339)`);
  }

  // ── notes: --notes-file > --notes > NOTES.md at repo root > "" ──
  let notes = '';
  if (typeof args['notes-file'] === 'string') {
    const nf = path.resolve(args['notes-file']);
    if (!existsSync(nf)) die(1, `--notes-file not found: ${nf}`);
    notes = readFileSync(nf, 'utf8').trim();
  } else if (typeof args.notes === 'string') {
    notes = args.notes;
  } else {
    const defaultNotes = path.join(REPO_ROOT, 'NOTES.md');
    if (existsSync(defaultNotes)) notes = readFileSync(defaultNotes, 'utf8').trim();
  }

  // ── bundle dir ──
  const bundleDir = typeof args['bundle-dir'] === 'string'
    ? path.resolve(args['bundle-dir'])
    : DEFAULT_BUNDLE_DIR;

  // ── locate the NSIS installer (*-setup.exe) ──
  let setupExe = typeof args.setup === 'string' ? path.resolve(args.setup) : null;
  if (setupExe) {
    if (!existsSync(setupExe)) die(1, `--setup path not found: ${setupExe}`);
  } else {
    // Prefer the conventional nsis subdir; fall back to scanning the whole tree.
    const nsisDir = path.join(bundleDir, 'nsis');
    setupExe =
      findFile(nsisDir, (name) => /-setup\.exe$/i.test(name)) ||
      findFile(bundleDir, (name) => /-setup\.exe$/i.test(name));
    if (!setupExe) {
      die(
        1,
        `could not find a "*-setup.exe" under ${bundleDir}. ` +
          `Did you run "npm run tauri build" with bundle.targets including "nsis"? ` +
          `Override with --setup <path> or --bundle-dir <path>.`,
      );
    }
  }

  // ── locate the detached signature next to the installer ──
  const sigPath = `${setupExe}.sig`;
  if (!existsSync(sigPath)) {
    die(
      1,
      `signature not found: ${sigPath}\n` +
        `  The updater requires a signed build. Ensure bundle.createUpdaterArtifacts=true and that\n` +
        `  TAURI_SIGNING_PRIVATE_KEY (+ _PASSWORD) were set when running "npm run tauri build".`,
    );
  }
  const signature = readFileSync(sigPath, 'utf8').trim();
  if (!signature) die(1, `signature file is empty: ${sigPath}`);

  const setupName = path.basename(setupExe);

  // ── GitHub release download URL ──
  // Pattern: https://github.com/<owner>/<repo>/releases/download/<tag>/<setup.exe>
  // (filename is URL-encoded to be safe with spaces in productName.)
  const url =
    `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(setupName)}`;

  // ── assemble manifest ──
  const manifest = {
    version,
    notes,
    pub_date: pubDate,
    platforms: {
      [target]: {
        signature,
        url,
      },
    },
  };

  // ── output path ──
  const outPath = typeof args.out === 'string'
    ? path.resolve(args.out)
    : path.join(bundleDir, 'latest.json');

  const json = JSON.stringify(manifest, null, 2) + '\n';
  try {
    writeFileSync(outPath, json, 'utf8');
  } catch (err) {
    die(2, `failed to write ${outPath}: ${err.message}`);
  }

  // ── friendly summary to stderr (keeps stdout clean for piping) ──
  const sizeKB = (() => {
    try {
      return Math.round(statSync(setupExe).size / 1024);
    } catch {
      return '?';
    }
  })();
  console.error('make-latest-json: wrote ' + outPath);
  console.error('  version  : ' + version + '  (tag ' + tag + ')');
  console.error('  target   : ' + target);
  console.error('  installer: ' + setupName + '  (' + sizeKB + ' KB)');
  console.error('  signature: ' + sigPath);
  console.error('  pub_date : ' + pubDate);
  console.error('  url      : ' + url);
  // Echo the manifest on stdout so it can be piped/inspected.
  process.stdout.write(json);
}

main();
