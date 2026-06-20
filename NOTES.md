# Local Studio v0.1.22

⬇️ **Fix: download your master.** Plus a **three-way A/B/C** so you can put this app head-to-head with LANDR / Ozone / any external master.

### Fixed
- **Download works again.** The "download master" button silently did nothing in the desktop app — it tried a cross-origin link the webview blocks. It now **fetches the WAV and saves it** through a proper save dialog (or a browser download), with a "Saved ✓" confirmation.

### New — three-way comparison (original vs ours vs theirs)
- In the result, **add an external master** (drag in a version mastered by LANDR, Ozone, or anyone) and compare **A · this app · B · original · C · external** — all at the **same loudness**, so you judge tone and dynamics, not volume.
- One click (or the **A / B / C** keys) switches instantly, in sync, at the same position. The external file is loudness-matched for you automatically.
- This is the honest way to prove a master: hear all three side by side, level-matched.

### Notes
- All comparison playback is native audio (no Web Audio) — verified to actually play.

### Unchanged
- All prior mastering (multiband, de-esser, saturation, dynamic EQ, 2nd-pass EQ) + the loudness-matched A/B work as before.

Support: ☕ [Ko-fi](https://ko-fi.com/arieswu) · [PayPal](https://paypal.me/Arieshonghuan) · [GitHub Sponsors](https://github.com/sponsors/AriesHongHuanWu).

MIT © 2026 Aries HongHuan Wu.
