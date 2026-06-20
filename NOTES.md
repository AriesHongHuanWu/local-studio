# Local Studio v0.1.26

🎛️ **Pro: a manual multiband compressor** — the deep dynamics control a mastering engineer reaches for, built to a quality bar (true band isolation, stable stereo image) after a full adversarial review.

### New — Pro: manual multiband
Open **Pro 進階** → **手動多頻段壓縮** and you get a real multiband compressor:
- **2–5 custom bands** — drag the crossover frequencies (default 3: 20–120 / 120–2k / 2k–20k Hz).
- **Each band, independently**: threshold · ratio · attack · release · knee · makeup.
- **Per-band Mid/Side** — compress the centre and the sides as one (linked, so the stereo image stays rock-steady under compression) and set each band's **stereo width**.
- **Per-band bypass**, and a live gain-reduction meter per band on the result.
- It replaces the automatic compressor when enabled.

Under the hood: phase-coherent Linkwitz-Riley crossovers with true 24 dB/oct skirts (a kick stays in the low band instead of bleeding up and pumping the high band), a soft-knee detector with real, separate attack/release ballistics, and linked Mid/Side gain so width never breathes.

### Quality pass (adversarial review)
This shipped only after a 12-finding adversarial review of the DSP. Fixes applied: true band isolation (was leaking ~1 dB of bass into every band, now −81 dB), linked Mid/Side compression (was pumping the stereo image), and full input sanitization so no parameter value can ever produce a silent or corrupt master.

### Unchanged
- The adaptive EQ, Pro parametric EQ, auto mode, dynamic EQ, A/B + three-way comparison, and download all work as before.

Support: ☕ [Ko-fi](https://ko-fi.com/arieswu) · [PayPal](https://paypal.me/Arieshonghuan) · [GitHub Sponsors](https://github.com/sponsors/AriesHongHuanWu).

MIT © 2026 Aries HongHuan Wu.
