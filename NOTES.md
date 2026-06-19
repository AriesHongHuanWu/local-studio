# Ai Caption v0.1.4

Critical fresh-install fix, plus per-mode interfaces and moving text/object removal.

### Fixed (important — please reinstall)
- **🚑 Fresh installs on a clean machine now work.** The bundled portable Python had its folder structure flattened during packaging, so on a computer with no prior install the engine setup failed with `No module named 'encodings'` / "建立虛擬環境失敗". Packaging now preserves the interpreter's directory tree, so the first-run wizard builds its environment correctly. If a previous install failed at "建立虛擬環境", install this version over it.

### New
- **🎬 Per-mode interfaces** — the app now reshapes itself around what you're doing:
  - **🎵 Song lyrics** keeps the full word-level editor.
  - **🎬 Video → Subtitles** gets a dedicated **video-editor-style** workspace — preview alongside an editable cue list (edit text, nudge start/end by ±0.1 s, click a cue to seek, active cue highlighted; falls back gracefully for audio-only sources).
  - **🧹 Clean Text** collapses to just the steps it needs (no more lyric/subtitle tabs cluttering it).
- **✨ Moving text/object removal** — Clean Text now offers **固定** (fixed position) or **會移動 (追蹤)**: draw the box once on the first frame and Ai Caption **tracks the region as it moves** through the video, erasing it frame-by-frame with LaMa inpainting.

### Also fixed
- Version number now reads the **real app version** (it was showing a stale value).
- **Mode switcher is icon-only** — no more cramped, truncated labels.
- Health check **no longer downloads all three models** up front — it only fetches what the mode you're using actually needs.

### Unchanged
- 100% local — nothing is uploaded. Runs on no-GPU laptops (CPU int8 / Intel Core Ultra).

If you'd like to support development: ☕ [Ko-fi](https://ko-fi.com/arieswu) · [PayPal](https://paypal.me/Arieshonghuan) · [GitHub Sponsors](https://github.com/sponsors/AriesHongHuanWu).

MIT © 2026 Aries HongHuan Wu.
