# Ai Caption v0.1.11

Critical fix — "Cannot reach local backend" caused by the auto-restart watchdog.

### Fixed
- **🚑 "Cannot reach local backend" loop** — the backend watchdog added in v0.1.8 was too aggressive: the engine takes 20–30 s to load (PyTorch + the ML stack), but the watchdog declared it "dead" after 8 s and **killed it mid-load, then restarted it** — so it could never finish booting, and the app stayed permanently offline. The watchdog now:
  - waits a **startup grace period** before checking at all,
  - only restarts when the engine process has **actually exited** (not while it's still loading),
  - and applies a **restart cooldown** so it can never get into a restart loop again.

If you were stuck on "Cannot reach backend", **update to v0.1.11** and it will boot normally. (This was a regression in v0.1.8–v0.1.10; sorry about that.)

### Unchanged
- 100% local. All v0.1.10 features as before.

If you'd like to support development: ☕ [Ko-fi](https://ko-fi.com/arieswu) · [PayPal](https://paypal.me/Arieshonghuan) · [GitHub Sponsors](https://github.com/sponsors/AriesHongHuanWu).

MIT © 2026 Aries HongHuan Wu.
