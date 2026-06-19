# Ai Caption v0.1.1

The app is now **Ai Caption** — local AI captioning **and** word-level lyrics, in one tool.

### New
- **🎬 Video → Subtitles mode** — drop a video (or audio) file and get clean **SRT / WebVTT** captions, with a live caption overlay on the video and a click-to-seek cue list. No vocal separation, no reference needed.
- **Runs on any laptop — no discrete GPU required.** On CPU / integrated graphics (e.g. Intel Core Ultra) it auto-picks a fast model and runs int8; your GPU is used automatically when one is present.
- **Bundled Python** — no separate Python install needed. First launch sets everything up on its own.
- **WebVTT (.vtt) export** + broadcast-style subtitle formatting (line length, ≤ 2 lines, max duration, reading-speed splitting; CJK / Latin aware).

### Improved
- Sharper forced alignment — per-character Mandarin (pinyin) / Cantonese (jyutping) and an English double-letter fix.
- 🎵 **Song lyrics mode** (Demucs → Whisper → forced-align → LRC / ASS karaoke) is unchanged and still here.

100% local — nothing is uploaded. MIT © 2026 Aries HongHuan Wu.
