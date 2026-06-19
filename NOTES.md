# Ai Caption v0.1.8

Stability fixes — no more crashes when GPU memory is tight, and the backend now heals itself.

### Fixed
- **🧠 顯存不足 / Clean Text errors on a busy GPU** — if another app (e.g. DaVinci Resolve, a game) is using your graphics memory, Clean Text used to fail with out-of-memory. Now Ai Caption **checks free VRAM and automatically runs LaMa on the CPU when the GPU is tight** (slower, but it finishes instead of erroring), and it **survives an out-of-memory mid-render** by switching to CPU on the fly. It also frees GPU memory after each job.
- **🔌 "Cannot reach local backend"** — added a **watchdog that automatically restarts the engine** if it ever crashes or gets killed, so the app recovers on its own instead of going permanently offline. (It stops cleanly when you quit, so no leftover processes.)

### Tip if your GPU is small (≤ 8 GB)
- Closing other GPU-heavy apps (video editors, games) while running Ai Caption frees the most memory and keeps everything on the fast GPU path.

### Unchanged
- 100% local — nothing is uploaded. All v0.1.7 features (動態字幕燒錄, 精準模式, 選硬碟…) as before.

If you'd like to support development: ☕ [Ko-fi](https://ko-fi.com/arieswu) · [PayPal](https://paypal.me/Arieshonghuan) · [GitHub Sponsors](https://github.com/sponsors/AriesHongHuanWu).

MIT © 2026 Aries HongHuan Wu.
