# Local Studio v0.1.35

🛠️ **Fixes: mastering download + no more black screens** — plus the new Audio Toolbox (11 tools, from v0.1.34) with its downloads now working.

### Fixed — "download failed" on masters (and toolbox audio)
Saving a mastered WAV (and any processed audio from the Audio Toolbox) was failing with "download failed". The app had permission to write **text** files but not **binary** files, so writing the WAV bytes was blocked. Granting binary-file write permission fixes every audio download.

### Fixed — black screen / crash recovery
If something in the UI ever errored (e.g. on certain actions), the whole window could go black with no way back. There's now an **error boundary**: instead of a black screen you get a recoverable message with **Try again** / **Reload**, and your files are never affected. (If you still hit an error after a specific action like uploading a reference track, it'll now show what went wrong instead of vanishing — please send that text so it can be pinned down.)

### New (from v0.1.34) — Audio Toolbox
A new **Toolbox** tool under Audio with 11 utilities: **de-ess analyzer** (tells you which frequency to filter), loudness meter, key & BPM, loudness normalizer, hum removal, noise reduction, silence trim, fade, stereo width, DC removal, and format conversion (WAV/FLAC/MP3/OGG). Downloads from it now work (see the fix above).

### Coming next
A high-quality YouTube/URL audio downloader (for beats you have the rights to), so you can pull a track in and process/master it right away.

Support: ☕ [Ko-fi](https://ko-fi.com/arieswu) · [PayPal](https://paypal.me/Arieshonghuan) · [GitHub Sponsors](https://github.com/sponsors/AriesHongHuanWu).

MIT © 2026 Aries HongHuan Wu.
