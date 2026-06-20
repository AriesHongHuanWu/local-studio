# Releasing Ai Caption

A concise runbook for cutting a signed, auto-updating desktop release.

Ai Caption ships in-app auto-update via Tauri v2's official (signed) updater. On
startup the app fetches a `latest.json` from the GitHub release, compares its
`version` to the running build, and — if newer — downloads the signed installer,
verifies it against the bundled public key, installs it, and relaunches. After
relaunch the Rust shell notices the new app version (the `.autolyrics_src_ok`
sentinel in the WORK backend dir no longer matches) and **re-copies the bundled
Python backend source** into the writable WORK dir, preserving `.venv`, `models`,
and outputs — so the backend code updates together with the shell.

---

## TL;DR — the canonical flow (CI multi-platform)

The **only** way to produce macOS + Linux packages is the GitHub Actions release
workflow (`.github/workflows/release.yml`): Tauri cannot cross-compile a
macOS/Linux bundle from Windows. The workflow builds + minisign-signs the app on
native Windows, macOS, and Linux runners and publishes **one** GitHub Release
with every platform's installers plus a single, merged multi-platform
`latest.json`.

> **⚠️ Critical — the tag MUST equal the config version.** The git tag
> `vX.Y.Z` MUST match `tauri.conf.json` `version` `X.Y.Z` (without the `v`).
> tauri-action derives `latest.json`'s `version` and the installer FILENAMES
> from `tauri.conf.json` `version`, **not** from the tag — the tag only names
> the release and the download URL. If you tag `v0.2.0` but forget to bump the
> config off `0.1.0`, CI stays green and a release publishes, but `latest.json`
> says `0.1.0` and the updater offers **no update** (silently). The workflow now
> guards this: the **"Verify tag matches tauri.conf.json version"** step fails
> the build fast if they differ, so do step 1 before step 3.

```bash
# 0. (one-time) set the signing secrets — see "GitHub secrets" below.
# 1. Bump version in tauri.conf.json + package.json (+ Cargo.toml). Write NOTES.md.
#    The tag in step 3 MUST equal this version (the CI guard enforces it).
# 2. Commit.
git commit -am "release: v0.2.0"
# 3. Tag with a leading v and push the tag — this triggers the workflow.
#    tag v0.2.0  ==  tauri.conf.json version 0.2.0  (must match exactly).
git tag v0.2.0
git push origin v0.2.0
# 4. Watch Actions → Release. When all legs are green, open Releases, review the
#    DRAFT "Ai Caption v0.2.0", confirm latest.json has all platform keys, and
#    PUBLISH it (which flips it to "Latest" → the updater starts serving it).
#    (The "Draft ready — review + PUBLISH" job posts this reminder to the
#    Actions run summary.)
```

Each runner uploads to the **same release keyed by the tag** and merges its
platform entry into `latest.json`, so the published manifest covers
`windows-x86_64`, `darwin-aarch64`, `darwin-x86_64`, and `linux-x86_64`.

You can also re-run a release for an existing tag manually: Actions → **Release**
→ **Run workflow** → enter the tag (e.g. `v0.2.0`).

> Platform keys in `latest.json`: Windows updater = NSIS `*-setup.exe`
> (`windows-x86_64`), macOS = `*.app.tar.gz` (`darwin-aarch64` / `darwin-x86_64`),
> Linux = `*.AppImage` (`linux-x86_64`). DMG/MSI/deb are convenient manual
> installers, not updater targets.

> **Runners.** macOS arm64 builds on `macos-latest` (Apple Silicon); macOS
> x86_64 builds on `macos-13`, which is an **Intel (x86_64-native)** runner —
> `macos-latest` is now Apple Silicon, so building x86_64 there would be a
> cross-compile that yields an unvalidated `.app`. Even so, the x86_64 macOS leg
> is the most likely to break first; `fail-fast: false` isolates it, so the
> other platforms still publish. If it keeps failing, you can drop the x86_64
> mac leg (ship arm64-only + Rosetta) without affecting the rest.

---

## GitHub secrets

Set these on the repo (`AriesHongHuanWu/local-studio`) once. The signing
secrets are **required** for the updater `.sig` files; the Apple ones are
optional (see §6).

| Secret | Value | Required |
| ------ | ----- | -------- |
| `TAURI_SIGNING_PRIVATE_KEY` | the **contents** of `frontend/.tauri-keys/autolyrics.key` (the whole `untrusted comment:…\nRWRT…` text) | ✅ yes |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | empty string (the key has no passphrase — but the secret must still exist) | ✅ yes |

```bash
# from the repo root, with gh authenticated:
gh secret set TAURI_SIGNING_PRIVATE_KEY < frontend/.tauri-keys/autolyrics.key
# empty password — the secret must exist even though it's blank:
printf '' | gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

> `gh secret set NAME < file` stores the file's contents. The action accepts the
> key *contents* in `TAURI_SIGNING_PRIVATE_KEY` (locally you may also pass a path
> — see the fallback build). Same key as your local builds → existing installs
> keep auto-updating.

**Optional — macOS notarization** (only if you have a paid Apple Developer ID).
Without these, the macOS `.app`/`.dmg` is **ad-hoc signed**: it installs, but
Gatekeeper shows "unidentified developer" (right-click → Open, or
`xattr -dr com.apple.quarantine`). The **minisign updater `.sig` still works**,
so auto-update is unaffected — only the first-install OS trust prompt differs.
Uncomment the matching block in `release.yml` and set the secrets:

- Cert import: `APPLE_CERTIFICATE` (base64 of the `.p12`),
  `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`
  (`Developer ID Application: Name (TEAMID)`), `KEYCHAIN_PASSWORD`.
- Notarize via Apple ID: `APPLE_ID`, `APPLE_PASSWORD` (app-specific password),
  `APPLE_TEAM_ID`.
- **OR** via App Store Connect API: `APPLE_API_ISSUER`, `APPLE_API_KEY` (key id),
  `APPLE_API_KEY_PATH` (path to the `.p8`).

Windows Authenticode signing of the NSIS/MSI is a separate, optional concern
(SmartScreen warning without it); it does **not** affect the updater `.sig`.

---

## Fallback — local single-platform (Windows) build

The sections below build + release **Windows only** by hand. Use this for dev
testing or if CI is unavailable. It does **not** produce macOS/Linux packages,
and it overwrites a single-platform `latest.json` (so don't mix it with a CI
release for the same version). The updater target key here is `windows-x86_64`.

---

## 0. One-time setup (per machine)

The updater verifies every download against a minisign key pair.

- **Public key** — committed in `frontend/src-tauri/tauri.conf.json` under
  `plugins.updater.pubkey`. It is safe to publish.
- **Private key** — `frontend/.tauri-keys/autolyrics.key` (+ `autolyrics.key.pub`).
  **This is a SECRET.** It is **gitignored** (`.tauri-keys/` and `*.key` in the
  root `.gitignore`) and must NEVER be committed. Keep a secure backup — if it is
  lost, existing installs can no longer auto-update (a new key means a new app
  identity and a manual reinstall for every user).

The key was generated once with:

```bash
# (already done — do NOT regenerate unless you intend to break auto-update)
npx tauri signer generate -w frontend/.tauri-keys/autolyrics.key
```

This repo's key was created with an **empty passphrase**, so
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is set to an empty string at build time.

---

## 1. Bump the version

Update the version in **both** files so the shell, the bundle, and the manifest
all agree (the updater compares `latest.json.version` against the bundled app
version, so a mismatch means no update is ever offered):

- `frontend/src-tauri/tauri.conf.json` → `"version": "X.Y.Z"`
- `frontend/package.json` → `"version": "X.Y.Z"`

> `frontend/src-tauri/Cargo.toml` also carries a `version`; keep it in sync too
> for tidy `cargo`/`tauri info` output (it does not drive the updater).

Use plain SemVer (`0.2.0`), no leading `v`. The git tag gets the `v` (`v0.2.0`).

Write the release notes for this version into a `NOTES.md` at the repo root
(`make-latest-json.mjs` reads it by default). Keep it short — it is shown in the
in-app update banner.

---

## Portable Python (bundled interpreter — "no Python install required")

The installer bundles a [python-build-standalone](https://github.com/astral-sh/python-build-standalone)
interpreter so **end users do not need to install Python**. On first launch the
setup wizard creates the backend `.venv` from this bundled interpreter (the Rust
shell's `embedded_python()` finds it under the app's Resource dir); only if it is
absent does it fall back to a system Python on `PATH`.

- **CI** does this automatically — `release.yml` runs `scripts/fetch-portable-python.{ps1,sh}`
  on each runner before the Tauri build (see the "Fetch portable Python" steps).
- **Local/manual builds** must fetch it first, or the bundle ships **without** the
  interpreter (the app then needs system Python — same as v0.1.0):

  ```powershell
  # Windows — from the repo root, before `npm run tauri build`:
  pwsh scripts/fetch-portable-python.ps1        # or: powershell -File scripts\fetch-portable-python.ps1
  ```
  ```bash
  # macOS / Linux:
  ./scripts/fetch-portable-python.sh
  ```

The interpreter is staged into `frontend/src-tauri/resources/python/` (gitignored;
~150 MB on disk) and picked up by the `resources/python/**/*` glob in
`tauri.conf.json`. A `.gitkeep` keeps the glob valid on a fresh clone so the build
never breaks when the fetch is skipped.

> **macOS note.** Bundled interpreter binaries are unsigned like the rest of an
> ad-hoc build; for a notarized release they are signed/notarized along with the
> `.app`. The minisign updater `.sig` is unaffected either way.

---

## 2. Build the signed bundle

From `frontend/`, with the signing env vars set, run the Tauri build. The private
key path and the (empty) password must be exported so Tauri produces the `.sig`
artifacts (`bundle.createUpdaterArtifacts` is already `true` in `tauri.conf.json`).

> First fetch the portable Python (see the section above) so it gets bundled:
> `pwsh scripts/fetch-portable-python.ps1`.

PowerShell (Windows):

```powershell
cd C:\dev\LocalAiLyrics
pwsh scripts\fetch-portable-python.ps1   # bundle the portable interpreter
cd frontend
$env:TAURI_SIGNING_PRIVATE_KEY = "$PWD\.tauri-keys\autolyrics.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npm run tauri build
```

Bash (Git Bash):

```bash
cd /c/dev/LocalAiLyrics
./scripts/fetch-portable-python.sh        # bundle the portable interpreter
cd frontend
export TAURI_SIGNING_PRIVATE_KEY="$PWD/.tauri-keys/autolyrics.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
npm run tauri build
```

> `TAURI_SIGNING_PRIVATE_KEY` may be either the **path** to the key file or the
> key's **contents** — Tauri accepts both. Using the path is simplest here.

Artifacts land under
`frontend/src-tauri/target/release/bundle/`:

- `nsis/Ai Caption_<version>_x64-setup.exe`        ← the updater installer
- `nsis/Ai Caption_<version>_x64-setup.exe.sig`    ← its detached signature
- `msi/Ai Caption_<version>_x64_en-US.msi`         ← manual-install MSI

If the `.sig` files are missing, the signing env vars were not set — fix and
rebuild before proceeding.

---

## 3. Generate `latest.json`

From the repo root, run the manifest generator. It reads the version from
`tauri.conf.json`, finds the NSIS `*-setup.exe` + its `.sig`, embeds the signature,
and writes the GitHub download URL. **`--date` is required** (the script never
calls `Date.now()`, so output is reproducible) — use the moment you publish.

```bash
node scripts/make-latest-json.mjs \
  --date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --notes-file NOTES.md
```

PowerShell equivalent for `--date`:

```powershell
node scripts/make-latest-json.mjs --date (Get-Date -AsUTC -Format "yyyy-MM-ddTHH:mm:ssZ") --notes-file NOTES.md
```

By default it writes
`frontend/src-tauri/target/release/bundle/latest.json`. Useful overrides:

| Flag             | Purpose                                                    |
| ---------------- | ---------------------------------------------------------- |
| `--version X.Y.Z`| override the version (default: from `tauri.conf.json`)      |
| `--tag vX.Y.Z`   | tag used in the download URL (default: `v<version>`)       |
| `--notes "..."`  | inline release notes (instead of `--notes-file`)           |
| `--repo o/r`     | GitHub `owner/repo` (default: `AriesHongHuanWu/local-studio`) |
| `--out PATH`     | output path for `latest.json`                              |
| `--setup PATH`   | explicit installer path (skips auto-discovery)             |

Inspect the result — confirm `version`, `url`, and a non-empty `signature`:

```bash
cat frontend/src-tauri/target/release/bundle/latest.json
```

The `url` MUST be the exact filename you will upload, under the tag you will
create:
`https://github.com/AriesHongHuanWu/local-studio/releases/download/v<version>/<setup.exe>`

---

## 4. Create the GitHub release and upload assets

Create a release tagged **`v<version>`** and upload exactly these three files:

1. `Ai Caption_<version>_x64-setup.exe`      (the updater installer)
2. `Ai Caption_<version>_x64_en-US.msi`      (manual install)
3. `latest.json`                             (the updater manifest)

### Option A — GitHub CLI (`gh`)

```bash
cd C:/dev/LocalAiLyrics
BUNDLE=frontend/src-tauri/target/release/bundle
gh release create v0.2.0 \
  "$BUNDLE/nsis/Ai Caption_0.2.0_x64-setup.exe" \
  "$BUNDLE/msi/Ai Caption_0.2.0_x64_en-US.msi" \
  "$BUNDLE/latest.json" \
  --title "Ai Caption v0.2.0" \
  --notes-file NOTES.md
```

### Option B — GitHub web UI

1. Repo → **Releases** → **Draft a new release**.
2. **Choose a tag** → type `v0.2.0` → **Create new tag on publish**.
3. Title `Ai Caption v0.2.0`; paste the notes.
4. Drag the three files into the assets area.
5. Ensure **Set as the latest release** is checked, then **Publish**.

> **Critical — the `latest` pointer.** The updater endpoint is
> `https://github.com/AriesHongHuanWu/local-studio/releases/latest/download/latest.json`.
> GitHub resolves `/releases/latest/` to the release marked **"Latest"**. So the
> newest release MUST be flagged as latest (it is by default for the highest
> non-prerelease SemVer tag). Do **not** mark the release as a *pre-release* or
> the updater will keep serving the previous `latest.json`. If you ever hotfix an
> older line, publish it without the "latest" flag.

---

## 5. Verify the update path

1. Install the **previous** version on a test machine (or keep an older install).
2. Launch it. Within a few seconds the in-app update banner should appear
   ("Update available — v<version>"). The Settings → App updates row also has a
   manual **Check for updates** button.
3. Click **Update now**. Watch it download (progress bar), install, and relaunch
   into the new version.
4. After relaunch, confirm the version chip (top status strip) shows the new
   version, and that the backend still works (the WORK backend source is
   refreshed automatically; the existing `.venv` and models are preserved).

If the banner never appears, check (in order):

- `latest.json` is reachable at the `/releases/latest/download/latest.json` URL
  and its `version` is strictly greater than the installed app's version.
- The release is flagged **Latest** (not pre-release).
- The `signature` in `latest.json` matches the uploaded `*-setup.exe.sig`, and the
  installer URL points to the actually-uploaded filename.
- The installed app's `tauri.conf.json` `plugins.updater.pubkey` matches the key
  that signed this build (a key change breaks verification → silent no-update).

---

## Quick checklist

### Canonical (CI multi-platform)

- [ ] Repo secrets `TAURI_SIGNING_PRIVATE_KEY` (contents of `.tauri-keys/autolyrics.key`) + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (empty) are set.
- [ ] Bumped `version` in `tauri.conf.json` **and** `package.json` (and `Cargo.toml`).
- [ ] **Tag `v<version>` equals `tauri.conf.json` version `<version>` exactly** (the CI guard fails the build otherwise; latest.json + installer names come from the config, not the tag).
- [ ] Wrote `NOTES.md` (the in-app banner notes).
- [ ] Committed, then `git tag v<version>` and `git push origin v<version>`.
- [ ] Actions → **Release**: all 4 legs (mac arm64, mac x86_64, Linux, Windows) green.
- [ ] Reviewed the **draft** release; `latest.json` has `windows-x86_64`, `darwin-aarch64`, `darwin-x86_64`, `linux-x86_64` keys, each with a non-empty `signature`.
- [ ] **Published** the draft (so it becomes **Latest**).
- [ ] Verified an old install auto-updates.

### Fallback (local Windows-only)

- [ ] Bumped `version` in `tauri.conf.json` **and** `package.json` (and `Cargo.toml`).
- [ ] Wrote `NOTES.md`.
- [ ] Set `TAURI_SIGNING_PRIVATE_KEY` (path to `.tauri-keys/autolyrics.key`) + empty `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- [ ] `npm run tauri build` produced `*-setup.exe`, `*-setup.exe.sig`, and `*.msi`.
- [ ] Ran `node scripts/make-latest-json.mjs --date ... --notes-file NOTES.md`; inspected output.
- [ ] Created release `v<version>`; uploaded setup.exe + .msi + latest.json.
- [ ] Release is flagged **Latest**.
- [ ] Verified an old install auto-updates.

> Never commit `frontend/.tauri-keys/` or any `*.key`. Back the private key up
> somewhere safe and offline.
