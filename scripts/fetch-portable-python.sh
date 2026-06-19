#!/usr/bin/env bash
# Fetch a python-build-standalone interpreter and stage it for Tauri bundling
# (macOS / Linux). This is what makes AutoLyrics "portable Python": the
# interpreter is bundled into the installer so end users do NOT need to install
# Python. Run BEFORE `tauri build`; CI runs it automatically. If skipped, the app
# gracefully falls back to system Python.
#
# Env overrides: PYVERSION (default 3.12), TAG (pin a release date), DEST,
#                TRIPLE_OVERRIDE.
set -euo pipefail

PYVERSION="${PYVERSION:-3.12}"
TAG="${TAG:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEST="${DEST:-$REPO_ROOT/frontend/src-tauri/resources/python}"

OS="$(uname -s)"; ARCH="$(uname -m)"
case "$OS-$ARCH" in
  Darwin-arm64)   TRIPLE="aarch64-apple-darwin" ;;
  Darwin-x86_64)  TRIPLE="x86_64-apple-darwin" ;;
  Linux-x86_64)   TRIPLE="x86_64-unknown-linux-gnu" ;;
  Linux-aarch64)  TRIPLE="aarch64-unknown-linux-gnu" ;;
  *) echo "Unsupported platform: $OS-$ARCH" >&2; exit 1 ;;
esac
TRIPLE="${TRIPLE_OVERRIDE:-$TRIPLE}"

API="https://api.github.com/repos/astral-sh/python-build-standalone/releases"
AUTH=()
[ -n "${GITHUB_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
if [ -n "$TAG" ]; then URL="$API/tags/$TAG"; else URL="$API/latest"; fi

echo "→ Querying python-build-standalone release (${TAG:-latest})…"
JSON="$(curl -fsSL "${AUTH[@]}" -H "User-Agent: autolyrics-fetch" "$URL")"

export MATCH_PYVER="$PYVERSION" MATCH_TRIPLE="$TRIPLE"
ASSET_URL="$(printf '%s' "$JSON" | python3 - <<'PY'
import sys, re, os, json
rel = json.load(sys.stdin)
pyver = re.escape(os.environ["MATCH_PYVER"])
triple = re.escape(os.environ["MATCH_TRIPLE"])
pat = re.compile(rf"cpython-{pyver}\.\d+\+\d+-{triple}-install_only\.tar\.gz$")
for a in rel.get("assets", []):
    if pat.match(a["name"]):
        print(a["browser_download_url"]); break
PY
)"

if [ -z "$ASSET_URL" ]; then
  TAGNAME="$(printf '%s' "$JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("tag_name","?"))')"
  echo "No python-build-standalone asset matched cpython-${PYVERSION}.*-${TRIPLE}-install_only.tar.gz in release $TAGNAME" >&2
  exit 1
fi

echo "→ $ASSET_URL"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL -H "User-Agent: autolyrics-fetch" "$ASSET_URL" -o "$TMP/py.tar.gz"
tar -xzf "$TMP/py.tar.gz" -C "$TMP"
if [ ! -x "$TMP/python/bin/python3" ]; then
  echo "Extraction missing python/bin/python3" >&2; exit 1
fi

mkdir -p "$DEST"
# Clear any previous interpreter but preserve .gitkeep.
find "$DEST" -mindepth 1 -not -name .gitkeep -exec rm -rf {} + 2>/dev/null || true
cp -a "$TMP/python/." "$DEST/"
echo "✓ Portable Python staged at $DEST ($("$DEST/bin/python3" --version 2>&1))"
