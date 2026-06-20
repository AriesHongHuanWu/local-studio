# Local Studio v0.1.19

🔊 **Fix: no sound after mastering.** Mastered (and original) playback is audible again.

### Fixed
- **Sound is back.** In v0.1.17–v0.1.18 the live "spectrum while playing" feature tapped the audio player through the Web Audio API, which **rerouted the player's output** into an audio graph that the browser leaves suspended until a real click — so auto-played audio came out **silent**. The live tap has been removed, so the players are plain, native audio again and **always produce sound**.
- The stereo imager (goniometer) now draws from the master's analysis data instead of tapping playback — same picture, no risk to audio.

### Coming back, safely
- The live "watch the spectrum move while it plays" view will return in a later update using a method that **never touches playback** (a spectrogram synced to the play position), so it can't silence audio again. The full analysis — spectrum, band balance, gain-reduction meters, stereo field, signal chain, before→after — is all still here.

### Unchanged
- All v0.1.17 mastering (multiband, de-esser, saturation, 2nd-pass EQ, scoring) and the v0.1.18 calm-startup improvements work as before.

Support: ☕ [Ko-fi](https://ko-fi.com/arieswu) · [PayPal](https://paypal.me/Arieshonghuan) · [GitHub Sponsors](https://github.com/sponsors/AriesHongHuanWu).

MIT © 2026 Aries HongHuan Wu.
