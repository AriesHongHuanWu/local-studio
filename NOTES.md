# Local Studio v0.1.18

Smoother startup and a calmer, friendlier interface — fewer scary messages, better recovery.

### Fixed — startup & connection
- **No more "OFFLINE / Cannot reach backend" on launch.** The local engine needs ~20–30s to start (it loads the AI runtime), and the app used to flash a red **OFFLINE** badge — and, worse, could stay stuck offline even after the engine came up. Now it shows a calm **"啟動引擎中… / Starting engine…"** and **auto-reconnects** the moment the engine is ready.
- **Stuck-offline bug fixed** — the app now keeps retrying the connection on a normal launch (previously it only retried right after first-run setup), so it reliably comes online on its own.
- **Engine recovery** — if the engine genuinely fails to start (e.g. a half-finished install), you now get a friendly banner with **Retry** and **Reinstall engine** instead of a silent dead state.

### Fixed — fewer false alarms
- **No update-check pop-ups** — the "check for updates" failure modal no longer appears on launch when you're offline. Update errors now only show if *you* press "Check for updates."
- **No health warnings during boot** — the components/health banner no longer flashes while the engine is still starting; it only appears for a genuine, actionable issue once everything is up.

### Unchanged
- All v0.1.15–v0.1.17 features (device-aware setup, intelligent auto-mastering, the pro chain + live visualizations) work exactly as before.

Support: ☕ [Ko-fi](https://ko-fi.com/arieswu) · [PayPal](https://paypal.me/Arieshonghuan) · [GitHub Sponsors](https://github.com/sponsors/AriesHongHuanWu).

MIT © 2026 Aries HongHuan Wu.
