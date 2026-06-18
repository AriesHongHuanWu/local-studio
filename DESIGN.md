# AutoLyrics — Design Spec

> **Recto Pressroom** — the definitive UI direction for AutoLyrics.
> Local-first, offline, desktop-first (Tauri-wrapped). Talks only to the local FastAPI at `http://127.0.0.1:8756`.

---

## 1. Product vision

AutoLyrics turns any song into word-level timed lyrics (LRC / SRT / ASS-karaoke / JSON), entirely on the user's own machine. Its edge is **accuracy through reference**: paste full lyrics → forced alignment (near-perfect), paste partial lyrics + a style hint → biasing, paste nothing → clean transcription. Everything runs on an RTX 5060 (8 GB). No cloud.

**The thesis (the spine): the lyric document IS the interface.** AutoLyrics' literal output is beautiful, precisely-timed typeset lyrics — so the lyrics themselves become the surface you read, play, and touch. The active line rises in warm editorial type while neighbours fall into soft focus; a single antique-gold playhead sweeps each word in exact `\k`-karaoke sync. No transcription tool looks like this, and that singularity is the 新創 hook.

**Where the thesis would have failed, we fixed it decisively:**

- **Nav never hides.** The lyrics-as-interface idea tempts you to melt tabs into the margins. We refuse. AutoLyrics has an explicit, always-visible, **bilingual labelled 5-tab rail** with standard `lucide-react` icons. The document is the canvas *inside* a tab — it is never the navigation.
- **Editing is never trapped in a reading mode.** The oversized serif document is the hero **read / QA view**, but every word also carries a dense, summonable **word inspector** (chip row + tape-counter timecodes + boundary handles) so surgical ±10 ms timing work has a real home.
- **It runs cool.** No frosted glass, no full-spectrum gradients, no from-scratch DAW physics. Depth is warm-graphite luminance steps + hairline rules. The waveform is a bounded, decimated strip, not the whole app.

**North-stars, mapped:**

| North-star | How the design delivers it |
|---|---|
| 新創 (innovative) | Lyrics-as-interface; gold reading-playhead on real book-type; confidence-amber that points at exactly what to fix. |
| 精簡 (minimal) | One hero (the document), one accent (antique gold), one functional warn (amber), one positive (green). Progressive disclosure everywhere. |
| 好看 (beautiful) | Warm "ink on dark stock" paper, a deliberate humanist serif tuned for CJK, generous gutters, letterpress calm. |
| 功能齊全 (full-featured) | All 9 core features have an unambiguous home; nothing is buried. |
| 分頁明確 (clear tabs) | 5 labelled bilingual tabs, standard icons, one job per tab. Setup is a single linear column — no tab-hopping to start a job. |

---

## 2. Visual language

**"Ink on dark stock."** Near-black, but **warm graphite** (`#121013`, a faint warm cast) rather than clinical pure black — it reads like type printed on dark paper under low light, not a devtool. Two raised tiers lift panels by luminance, never by drop-shadow or fill. Separation is a single **hairline rule** at ~7% warm-white.

The lyrics are the hero, set in a **humanist serif tuned per script** (Source Serif 4 for Latin, paired with **Noto Serif CJK / Source Han Serif** for 中文國語 / 粵語 / 日本語 / 한국어 — never a Latin serif falling back to a broken system CJK face). The active line is large and warm; neighbours dim by opacity to create rack-focus depth-of-field — **and dimmed lines stay fully clickable/seekable**, with a "flat read" toggle for editors who need to scan many lines.

All chrome — tabs, status, timecodes, inspector — is a quiet grotesk (**Inter**) and **tape-counter monospace** (**JetBrains Mono**) at small sizes, low-contrast, so nothing competes with the document.

**One hero accent: antique gold `#E8C36B`.** Used *only* for the live playhead, the word-sweep, the active-tab underline, and the single primary action. It never decorates. A strict 3-colour semantic system keeps the canvas calm:

- **Gold** = live / playhead / sweep / primary action ("the one thing happening now").
- **Amber `#E0A24E`** = low-confidence word that wants a check. Desaturated, **event-driven** (pulses once when the playhead passes), never a persistent brand fill.
- **Green `#5BD49B`** = done / GPU-online / verified.

Surfaces are flat (no gradients, no glass). Radii are small and unfussy (8 px panels, 6 px controls, 4 px word chips so they read as crisp little tape strips). Motion is split-speed: **slow inky easing (220 ms) only for focus shifts**; **snappy, no-bounce (140 ms) for every editing micro-interaction** (drag, nudge, seek) so surgical timing never feels sluggish. The continuous word-sweep is a `linear` animation bound to audio `currentTime`.

Fonts are **bundled locally** (no web-font fetch) so the offline / local-first promise actually holds.

---

## 3. Design tokens — `:root{}` (ready to paste)

```css
:root {
  /* ── Surfaces: warm graphite "dark stock", lifted by luminance only ── */
  --al-bg:            #121013;   /* page — warm near-black paper            */
  --al-surface:       #1A171C;   /* raised panel tier 1                     */
  --al-surface-2:     #221E25;   /* raised panel tier 2 / inset wells       */
  --al-hairline:      rgba(244, 241, 234, 0.07); /* the only "border"       */
  --al-hairline-strong: rgba(244, 241, 234, 0.12);

  /* ── Ink (text) ── */
  --al-ink:           #F4F1EA;   /* warm off-white — primary document ink   */
  --al-ink-dim:       #B7B2AE;   /* neighbour lines, secondary text         */
  --al-ink-muted:     #7C7882;   /* captions, labels, inactive tabs         */
  --al-ink-faint:     #4F4B54;   /* far-focus dimmed lines, placeholders    */

  /* ── Semantic accents — exactly three, each carries meaning ── */
  --al-gold:          #E8C36B;   /* HERO: playhead, word-sweep, primary CTA */
  --al-gold-soft:     #F0D89A;   /* gold hover / sweep leading edge         */
  --al-gold-glow:     rgba(232, 195, 107, 0.22); /* live bloom, focus ring  */
  --al-amber:         #E0A24E;   /* WARN: low-confidence word (event-driven)*/
  --al-amber-glow:    rgba(224, 162, 78, 0.20);
  --al-green:         #5BD49B;   /* POSITIVE: done / GPU-online / verified   */
  --al-green-glow:    rgba(91, 212, 155, 0.18);
  --al-error:         #E06A5A;   /* job error / destructive only            */

  /* ── Typography ── */
  --al-font-display:  "Source Serif 4", "Noto Serif TC", "Noto Serif JP",
                      "Noto Serif KR", "Source Han Serif", Georgia, serif;
  --al-font-body:     "Inter", "Noto Sans TC", "Noto Sans JP",
                      "Noto Sans KR", system-ui, sans-serif;
  --al-font-mono:     "JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace;

  /* type scale */
  --al-lyric-active:  40px;  /* hero line in the reading view             */
  --al-lyric-near:    26px;  /* immediate neighbours                      */
  --al-lyric-far:     22px;  /* outer dimmed lines                        */
  --al-text-lg:       17px;
  --al-text-md:       14px;
  --al-text-sm:       12.5px;
  --al-text-xs:       11px;  /* tape-counter digits, eyebrow labels       */
  --al-tracking-caps: 0.14em; /* eyebrow / section caps                   */
  --al-leading-lyric: 1.5;   /* tuned up for CJK headroom                 */

  /* ── Radii ── */
  --al-radius-app:    14px;  /* outer app frame                          */
  --al-radius-panel:  8px;
  --al-radius-ctrl:   6px;
  --al-radius-chip:   4px;   /* word chips = crisp tape strips           */

  /* ── Spacing / layout ── */
  --al-gutter:        56px;  /* generous document margin (the "page")     */
  --al-pad-panel:     18px;
  --al-rail-w:        232px; /* left tab rail                            */
  --al-space-1: 4px;  --al-space-2: 8px;  --al-space-3: 12px;
  --al-space-4: 16px; --al-space-5: 24px; --al-space-6: 32px;

  /* ── Elevation (luminance + faint inset, never heavy drop-shadow) ── */
  --al-shadow-panel:  0 1px 0 rgba(255,255,255,0.03) inset,
                      0 10px 30px rgba(0,0,0,0.40);
  --al-shadow-pop:    0 12px 40px rgba(0,0,0,0.55);

  /* ── Motion: split-speed ── */
  --al-ease-ink:      cubic-bezier(0.4, 0, 0.2, 1);   /* focus shifts      */
  --al-ease-snap:     cubic-bezier(0.2, 0, 0, 1);     /* edit micro-ops    */
  --al-dur-focus:     220ms;  /* line focus, tab cross-fade               */
  --al-dur-snap:      140ms;  /* drag / nudge / seek / chip select        */
  --al-dur-sweep:     linear; /* word-sweep bound to audio currentTime    */
}

@media (prefers-reduced-motion: reduce) {
  :root { --al-dur-focus: 0ms; --al-dur-snap: 0ms; }
}
```

---

## 4. Tab Information Architecture (LOCKED)

Left vertical rail. **Five tabs, bilingual labels, standard `lucide-react` icons, one job each.** Job setup (file + mode + reference + style + language + progress) is folded into a **single linear column on the Transcribe tab** — you never tab-hop to start a run. The active tab carries the one gold underline.

| # | key | Label (zh / en) | `lucide-react` icon | Purpose | Core features it owns |
|---|---|---|---|---|---|
| 1 | `transcribe` | 辨識 · Transcribe | `audio-lines` | The single-column launchpad: load a song, choose how it's read, paste reference, run, and watch the staged pipeline — all on one screen. | (1) drag/drop file • (2) mode Auto/Biasing/Forced-Align • (3) reference lyrics editor • (4) content box + style chips • (5) language select • (9) live 3-stage progress |
| 2 | `editor` | 編輯 · Editor | `text-cursor-input` | The hero. The timed lyrics as a living document — reading-playhead read view **+** dense word inspector for surgical edits. | (7) line list + word-level timeline, waveform, synced playback, click-to-seek, inline text/timing edit, boundary nudge |
| 3 | `export` | 匯出 · Export | `file-output` | Turn the document into files with a faithful live preview before saving. | (8) LRC line/word, SRT, ASS `\k`, JSON • live preview • copy / save-to-disk |
| 4 | `library` | 紀錄 · Library | `library` | History of past local runs — reopen, re-export, duplicate. Shows which model + engine produced each run. | (9) run history • per-run model/engine/mode/lang metadata • search/filter |
| 5 | `settings` | 設定 · Settings | `sliders-horizontal` | The local-first control room: engine, hardware, model manager, defaults. | (6) model size, engine, device, Demucs default, model download manager, GPU/VRAM readout |

**Tab-level detail**

- **辨識 Transcribe** — Eyebrow-numbered sections (`SOURCE · MODE · REFERENCE · LANGUAGE`) act as quiet scaffolding for the linear column. The dropzone is **typeset, not a dashed rectangle**: "拖一首歌進來 — 它會變成一頁。Drop a song; it becomes a page." Once loaded it resolves into a small waveform thumbnail + parsed metadata (codec, sample rate, duration, size in mono). The **three modes are first-class cards**, each with a plain-language **readiness meter** that fills as you supply reference + style — making "why Forced-Align beats Auto" legible to a newcomer. The reference-lyrics serif editor **only reveals when Biasing or Forced-Align is chosen** (progressive disclosure). The live 3-stage progress (分離人聲 → 辨識/對齊 → 完成) streams inline at the column foot; on done, a gold "在編輯器開啟 · Open in Editor" hand-off.
- **編輯 Editor** — Default = **reading-playhead view**: centered editorial serif, active line at 40 px warm ink, neighbours rack-focus-dimmed (still clickable), gold word-sweep bound to `\k` duration. A **"flat read" toggle** drops the dimming for fast multi-line scanning. Select or hover a word to **summon the word inspector**: a quiet popover with the word text (editable inline), `start / dur` tape-counter mono fields, ±10 ms nudge, and boundary handles over a hairline waveform slice — dismissed instantly on blur. **Low-confidence words render as hollow amber outlines that pulse once as the playhead passes.** Edge-docked transport (hairline waveform strip + play/pause + ±5 s + current/total mono timecode) lives in the bottom margin — no separate player panel. Adjacent-word boundaries follow on drag so you can never open a gap.
- **匯出 Export** — Format text-links (LRC line · LRC word · SRT · ASS karaoke · JSON) beside a **live monospace preview of the actual file text**, re-rendering as options toggle. The ASS preview **animates its `\k` sweep against playback** so it's verifiably correct, not static. Per-format options (LRC word vs line, ASS sweep style, timestamp precision, encoding). Copy + Save-to-disk (Tauri `dialog`/`fs`). Editing → exports via `POST /api/export`; an untouched result can use `GET /api/jobs/{id}/export`.
- **紀錄 Library** — Quiet rows: title, mode badge, language, duration, date — all mono. Each row shows **which model + engine produced it** (a real trust signal for this GPU-first audience). Click to reopen in Editor; secondary re-export / duplicate-settings / delete. Search/filter by name, mode, or language. Footer: "一切都在這台機器上 — 不會外傳。Everything stays on this machine."
- **設定 Settings** — Model size (large-v3 / medium / small, with VRAM/speed hints for 8 GB), engine select, device (Auto / GPU / CPU) with **live GPU name + VRAM used/total** and a CUDA build note (cu128 / Blackwell). Demucs default toggle. **Model download manager** (installed models, sizes, download/verify/remove, progress, disk used). Default language / default mode / default export format. Local-only assurance + data-folder path.

---

## 5. Component inventory

**App shell**
- `AppFrame` — rounded warm-graphite outer frame, drag region for Tauri titlebar.
- `TabRail` — left vertical bilingual nav, gold active underline, `lucide-react` icons.
- `StatusStrip` — top-right: GPU·VRAM chip (green when online), active mode, app version from `/api/meta`.
- `Toast` / `EmptyState` — directional copy in the interface's voice.

**Transcribe**
- `Dropzone` — typeset drop target → waveform thumbnail + `FileMetaCard`.
- `ModeCards` — three cards (Auto / Biasing / Forced-Align) with `ReadinessMeter`.
- `ReferenceEditor` — full-width serif multiline (line breaks preserved); revealed for Biasing/Forced-Align.
- `ContentHintBox` + `StyleChips` — freeform hint + genre pills (pop…kids), maps `styleKeys`.
- `LanguageSelect` — Auto / 中文國語 / 粵語 / English / 日本語 / 한국어 / multi (from `/api/meta`).
- `SeparateToggle` — Demucs on/off (gated by `meta.demucs`).
- `RunButton` — primary gold action (`⌘↵`), posts `/api/jobs`.
- `StageProgress` — 3-stage stepper polling `/api/jobs/{id}` (stage, pct, message, elapsed mono).

**Editor**
- `LyricDocument` — the reading-playhead surface (rack-focus lines, click-to-seek).
- `WordSweep` — gold underline animation bound to `currentTime` / `\k`.
- `WordInspector` — summonable popover: inline text edit, tape-counter `start/dur`, ±10 ms nudge, boundary handles.
- `ConfidenceMark` — hollow-amber low-confidence treatment + single pulse on playhead pass.
- `WaveformStrip` — bounded, decimated, zoom-aware peaks; visible-window render only.
- `Transport` — edge-docked play/pause, ±5 s, current/total mono timecode.
- `FlatReadToggle` — disables neighbour dimming.
- `TapeCounter` — recessed glowing mono digit field (shared timecode primitive).

**Export**
- `FormatLinks` — LRC line/word · SRT · ASS · JSON selector.
- `LivePreview` — actual file text in mono; ASS sweep animates against playback.
- `FormatOptions` — per-format toggles (word/line, sweep style, precision, encoding).
- `ExportActions` — Copy / Save (Tauri); calls `POST /api/export` or `GET …/export`.

**Library**
- `RunRow` — title, mode badge, language, duration, date, model+engine, status badge.
- `RunSearch` — filter by name/mode/language.
- `LocalAssurance` — local-first footer line.

**Settings**
- `ModelSizePicker`, `EnginePicker`, `DevicePicker` (with `GpuReadout` VRAM bar).
- `ModelManager` — installed list, sizes, download/verify/remove, progress.
- `DefaultsPanel` — default language / mode / export format.

**Primitives** — `Button`, `IconButton`, `Pill`, `Field`, `Popover`, `ProgressBar`, `Badge`, `Eyebrow` (mono caps + tracking), `HairlineRule`.

---

## 6. Signature interactions

1. **The reading-playhead (hero).** The lyric document plays itself. As audio runs, the sung line rises to 40 px warm serif while neighbours rack-focus dim; the current word carries a single antique-gold underline sweeping left→right in exact `\k` sync — karaoke on real book-type. The interface you read and the artifact you produce are the same object. Dimmed lines stay clickable; a flat-read toggle is always one tap away.
2. **Grab-the-word retiming with onset-magnetize.** To fix timing you don't open a panel — you grab the word and drag. It follows the cursor 1:1; release near a vocal onset and the boundary **gently magnetizes** to that onset with a brief waveform onset-flash and a tape-counter timecode floating at the cursor in 10 ms steps. The adjacent word's start follows so you never create a gap. Hold a modifier to nudge ±10 ms with arrow keys for frame-exact karaoke timing. Snap for speed; exact mono readout for trust.
3. **Confidence that points at itself.** Low-confidence words render as hollow amber outlines that **pulse once as the playhead passes** — the interface naming exactly what to double-check. Confirming a word snaps it solid ink. Review becomes a guided task, not a hunt, at the cost of zero extra chrome.
4. **Verifiable export preview.** The ASS `\k` karaoke preview **animates its sweep against playback**, so the file you save is the file you just watched — preview is proof, not decoration.

---

## 7. Motion & micro-interaction notes

- **Split-speed by intent.** Focus shifts (line rise, neighbour dim, tab cross-fade) use slow inky easing `--al-ease-ink` at 220 ms for cinematic calm. **Every editing micro-op** (drag, nudge, seek, chip select, inspector summon) uses `--al-ease-snap` at 140 ms with **no overshoot** — surgical 10 ms work must feel instant, never springy.
- **The sweep is bound to audio, not a timer.** `WordSweep` is a `linear` transform driven by `currentTime`, so it stays sample-accurate and never drifts.
- **Accent discipline is a motion rule too.** Only the live element glows (`--al-gold-glow`). Amber is strictly event-driven (single pulse on playhead pass) — it never sits as a persistent fill, preserving the single-accent calm.
- **Magnetize feel.** On release-near-onset: a ~90 ms damped settle of the boundary + one cyan-free, gold onset-flash on the waveform. Damped, never bouncy.
- **Hand-offs reward completion.** Run-done → the "Open in Editor" gold button does a brief glow-in; the GPU chip ticks green on connect.
- **Quality floor.** Visible gold keyboard focus rings (`--al-gold-glow`); `prefers-reduced-motion` zeroes focus/snap durations and freezes the sweep to discrete word jumps; full keyboard path for seek, nudge, play/pause, tab switch; responsive down to a narrow window (rail collapses to icons).

---

## 8. Frontend file manifest — React + Vite (`frontend/src/...`)

| Path | Responsibility |
|---|---|
| `frontend/src/main.tsx` | Vite/React entry; mounts `App`, imports global CSS + bundled fonts. |
| `frontend/src/App.tsx` | Top-level shell: `AppFrame` + `TabRail` + active-tab router + `StatusStrip`. |
| `frontend/src/styles/tokens.css` | The `:root{}` design-token block (section 3) — single source of truth. |
| `frontend/src/styles/global.css` | Resets, base type, focus rings, scrollbar, reduced-motion rules. |
| `frontend/src/styles/fonts.css` | `@font-face` for locally-bundled Source Serif 4 / Noto Serif CJK / Inter / JetBrains Mono. |
| `frontend/src/api/client.ts` | Thin fetch wrapper for the FastAPI base `http://127.0.0.1:8756`. |
| `frontend/src/api/types.ts` | TypeScript types mirroring `Result`, `JobParams`, `Meta`, job status. |
| `frontend/src/api/jobs.ts` | `createJob` (multipart), `getJob` poll, `exportEdited`/`exportOriginal`. |
| `frontend/src/api/meta.ts` | `GET /api/meta`; exposes styles, languages, modelSizes, gpu/demucs/aligner flags. |
| `frontend/src/state/useJob.ts` | Job lifecycle hook: submit → poll `/api/jobs/{id}` → expose stage/pct/result. |
| `frontend/src/state/useResultStore.ts` | Holds the editable `Result`, applies word text/timing edits, dirty tracking. |
| `frontend/src/state/useAudio.ts` | HTML5 `<audio>` controller: currentTime, play/pause, seek, loop-region. |
| `frontend/src/state/useMeta.ts` | Loads + caches `/api/meta` for selects, chips, capability gating. |
| `frontend/src/lib/waveform.ts` | Decode + decimate audio peaks; zoom-aware visible-window slicing. |
| `frontend/src/lib/onset.ts` | Lightweight onset detection for magnetize-on-drag boundary snapping. |
| `frontend/src/lib/timecode.ts` | Format/parse mono timecodes (mm:ss.mmm), ±10 ms nudge math. |
| `frontend/src/lib/exporters.ts` | Client-side preview rendering of LRC/SRT/ASS/JSON (mirrors backend formats). |
| `frontend/src/components/shell/AppFrame.tsx` | Rounded warm-graphite frame + Tauri titlebar drag region. |
| `frontend/src/components/shell/TabRail.tsx` | Left bilingual nav rail with `lucide-react` icons + gold active underline. |
| `frontend/src/components/shell/StatusStrip.tsx` | GPU·VRAM chip, active mode, version readout. |
| `frontend/src/components/primitives/` | `Button`, `Pill`, `Field`, `Popover`, `Badge`, `Eyebrow`, `ProgressBar`, `HairlineRule`, `TapeCounter`. |
| `frontend/src/tabs/transcribe/TranscribeTab.tsx` | The single-column launchpad orchestrating the setup → run flow. |
| `frontend/src/tabs/transcribe/Dropzone.tsx` | Typeset drop target → waveform thumbnail + parsed metadata. |
| `frontend/src/tabs/transcribe/ModeCards.tsx` | Auto/Biasing/Forced-Align cards with `ReadinessMeter`. |
| `frontend/src/tabs/transcribe/ReferenceEditor.tsx` | Serif multiline reference-lyrics editor (line breaks preserved). |
| `frontend/src/tabs/transcribe/StyleChips.tsx` | Genre pill chips + content hint box → `styleKeys`. |
| `frontend/src/tabs/transcribe/LanguageSelect.tsx` | Language picker driven by `/api/meta` languages. |
| `frontend/src/tabs/transcribe/StageProgress.tsx` | 3-stage pipeline stepper bound to `useJob`. |
| `frontend/src/tabs/editor/EditorTab.tsx` | Hosts reading view + inspector + transport; wires audio + result store. |
| `frontend/src/tabs/editor/LyricDocument.tsx` | Rack-focus editorial lyric document, click-to-seek, flat-read toggle. |
| `frontend/src/tabs/editor/WordSweep.tsx` | Gold word-sweep underline bound to `currentTime`/`\k`. |
| `frontend/src/tabs/editor/WordInspector.tsx` | Summonable popover: inline text edit, tape-counter fields, boundary drag, ±10 ms. |
| `frontend/src/tabs/editor/ConfidenceMark.tsx` | Hollow-amber low-confidence styling + pulse on playhead pass. |
| `frontend/src/tabs/editor/WaveformStrip.tsx` | Bounded decimated waveform with playhead + onset-magnetize drag. |
| `frontend/src/tabs/editor/Transport.tsx` | Edge-docked play/pause, ±5 s, current/total mono timecode. |
| `frontend/src/tabs/export/ExportTab.tsx` | Format selection + options + actions container. |
| `frontend/src/tabs/export/FormatLinks.tsx` | LRC line/word · SRT · ASS · JSON selector. |
| `frontend/src/tabs/export/LivePreview.tsx` | Live monospace file preview; animates ASS `\k` sweep against playback. |
| `frontend/src/tabs/export/ExportActions.tsx` | Copy + Save-to-disk; `POST /api/export` (edited) or `GET …/export` (original). |
| `frontend/src/tabs/library/LibraryTab.tsx` | Past-run list + search; reopen/re-export/duplicate/delete. |
| `frontend/src/tabs/library/RunRow.tsx` | One run row: title, mode, lang, duration, date, model+engine, status. |
| `frontend/src/tabs/settings/SettingsTab.tsx` | Engine/hardware/model-manager/defaults control room. |
| `frontend/src/tabs/settings/ModelManager.tsx` | Installed models, sizes, download/verify/remove, progress, disk used. |
| `frontend/src/tabs/settings/GpuReadout.tsx` | GPU name + VRAM used/total bar + CUDA build note. |

---

*Spine: Recto (lyrics-as-interface). Grafted: warm-graphite base, semantic confidence-amber, onset-magnetize snap (Tapedeck); explicit labelled bilingual tab rail, single-column setup, model/engine Library metadata, readiness meters on mode cards (Concept 1 / Concept 2). Rejected: hidden-margin nav, gradient/glass, spring overshoot, full waveform-as-everything DAW.*
