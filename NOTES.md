# Ai Caption v0.1.3

Robustness & housekeeping — Ai Caption now looks after its own engine and storage.

### New
- **🩺 Self-healing engine** — on launch the app checks that everything it needs is present (Python deps, CUDA, and each model). If something is **missing or was deleted**, it tells you exactly what, and **auto re-fetches only the missing pieces** — reusing whatever is already cached, never re-downloading what you already have.
- **🗂️ Storage management** (Settings → 儲存空間) — see where your disk is going (engine, each model, caches) and free space in tiers: delete a single model · clear all models (keep the app) · full reset keeping your models · full reset wiping everything. Every option confirms first and shows how much it frees.
- **🔔 Smarter update prompts** — when a new version is found, a tidy dialog now pops up with the **full release notes** and a one-click **Update now** (defer with Later).

### Unchanged
- 🎵 Song lyrics · 🎬 Video → Subtitles · 🧹 Clean Text modes all as before.

100% local — nothing is uploaded. MIT © 2026 Aries HongHuan Wu.
