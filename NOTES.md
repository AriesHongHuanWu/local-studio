# Local Studio v0.1.32

💻 **Better on small laptops** — a performance mode that lightens the mastering work for weaker, GPU-less machines, on automatically where it's needed.

### New — performance mode
A new **Performance mode (small laptops)** option (Pro → Advanced) makes mastering lighter:
- Skips the heaviest measurement work (the sliding loudness history and 4× true-peak oversampling) and runs the harmonic saturation without oversampling.
- The master still lands on the same target loudness, stays peak-safe, and applies the same corrective EQ — the quality difference is negligible; it just does less number-crunching.
- **On by default when your machine has no GPU** (a strong "low-power laptop" signal), so small laptops get the lighter path automatically. You can toggle it any time.

This keeps Local Studio responsive on modest hardware, where the full analysis on every master would otherwise be slow.

### Unchanged
- All mastering features (AI stem mastering, genre detection, auto-EQ curve, automation lanes, manual multiband, adaptive EQ, Pro parametric EQ) and the lyrics/subtitles/text-removal modes work as before.

### Coming next
A categorized + pinnable tool sidebar, and clearer positioning for artists and content creators.

Support: ☕ [Ko-fi](https://ko-fi.com/arieswu) · [PayPal](https://paypal.me/Arieshonghuan) · [GitHub Sponsors](https://github.com/sponsors/AriesHongHuanWu).

MIT © 2026 Aries HongHuan Wu.
