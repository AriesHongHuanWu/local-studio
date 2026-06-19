# Ai Caption v0.1.2

### New — 🧹 Clean Text mode
A third top-level mode for **removing text you accidentally added to your own video** (a burned-in subtitle in the wrong spot, a mistyped title, a fixed corner caption):

- **Box it, AI erases it.** Drag a box over the fixed-position text; **LaMa** inpainting fills that region with background **every frame**, and the output keeps your **original audio**.
- **100% local & GPU-accelerated** — NVIDIA NVENC / Intel QSV / CPU encode, no system ffmpeg or cloud needed. Falls back to a fast classical method if the AI model isn't available.
- Before/after preview, then download the cleaned `.mp4`.

> v1 targets **fixed-position** text. Moving/animated text is a later step. The LaMa model (~196 MB) downloads automatically on first use.

### Also
- 🎵 Song lyrics and 🎬 Video → Subtitles modes are unchanged.

100% local — nothing is uploaded. MIT © 2026 Aries HongHuan Wu.
