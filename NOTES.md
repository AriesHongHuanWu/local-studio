# Local Studio v0.1.27

🎚️ **Pro: EQ automation lanes** — draw how a band's gain moves across the whole song, DAW-style. Built to a precise WYSIWYG standard after a 14-finding adversarial review.

### New — Pro: EQ automation
Open **Pro 進階** → **EQ 自動化曲線(手動畫)** and draw EQ moves over time:
- **Timeline editor** — x = song time, y = gain (±12 dB). Lift the highs in the chorus, dip the lows in the bridge, anything you can draw.
- **Drag points, click to add, double-click to remove.** Each lane is a true bell with its own frequency and Q. Up to 5 colour-coded lanes.
- Runs as its own stage in the signal chain; what you draw is what you hear.

It's the manual companion to the automatic Adaptive EQ — one rides the song for you, the other lets you draw every move yourself.

### Precision (adversarial review)
This shipped after a 14-finding review of the DSP + editor. The important fixes:
- **What you draw is what plays.** Each lane is now a real RBJ peaking bell (exact centre gain, correct Q), and the gain ramps are interpolated in dB — so a straight line you draw from 0 to +6 dB is heard as a straight 0→+6 dB ramp, not a curved one.
- **Times are song-relative**, so a move you place at the chorus lands at the chorus regardless of the file format or how the browser reports its length.
- Plus: safe at any sample rate, clean handling of overlapping points, and tighter point editing (no stray points from near-misses).

### Unchanged
- The manual multiband, adaptive EQ, Pro parametric EQ, auto mode, A/B + three-way comparison, and download all work as before.

Support: ☕ [Ko-fi](https://ko-fi.com/arieswu) · [PayPal](https://paypal.me/Arieshonghuan) · [GitHub Sponsors](https://github.com/sponsors/AriesHongHuanWu).

MIT © 2026 Aries HongHuan Wu.
