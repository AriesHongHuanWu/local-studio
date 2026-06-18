# AutoLyrics Frontend — CONTRACTS

> For the tab-builder agents. This is the **API surface** of the scaffold:
> the TS types, every primitive's props, every store hook + selector, the
> api client signatures, the lib utilities, and the CSS tokens/classes.
> Build against this without changing the seams. If you need a new shared
> type or store field, add it here too.

Project root: `C:/Users/aries/OneDrive/文件/autolyrics/frontend/`
Build: `npm run build` (= `tsc -b && vite build`) — **must stay green.**
Dev: `npm run dev` (port 5174). Strict TS, no `any` across modules.

---

## 0. Golden rules

- **Never blank-screen offline.** `/api/meta` + job calls fail gracefully; `useMeta` keeps `FALLBACK_META`. Every tab renders its full chrome with the backend down.
- **One accent.** Gold = live/primary only. Amber = low-confidence (event-driven pulse). Green = done/online. Use the tokens, never hardcode hex.
- **Times are seconds (float).** `start`/`end` everywhere. ±10 ms = ±0.01 s. Render mono via `lib/timecode`.
- **Edited vs original export routing.** `useResultStore.dirty` true → `POST /api/export`; false + a `jobId` → `GET /api/jobs/{id}/export`. `ExportActions` already does this.
- Use **lucide-react** icons and the existing primitives. Don't introduce a CSS framework.

---

## 1. Types — `src/api/types.ts`

```ts
type ModelSize = 'large-v3' | 'medium' | 'small';
type Engine    = 'whisper';
type JobMode   = 'auto' | 'biasing' | 'align';
type Device    = 'auto' | 'cuda' | 'cpu';
type JobStatusValue = 'queued' | 'running' | 'done' | 'error';
type ExportFormat   = 'lrc' | 'srt' | 'ass' | 'json';
type ExportLevel    = 'line' | 'word';

interface StyleOption    { key: string; label: string; }
interface LanguageOption { code: string; label: string; iso3: string; }

interface Meta {
  styles: StyleOption[]; languages: LanguageOption[];
  modelSizes: ModelSize[]; engines: Engine[];
  gpu: boolean; demucs: boolean; aligner: boolean; version: string;
}

interface JobParams {
  mode: JobMode; referenceLyrics: string; referenceContent: string;
  styleKeys: string[]; language: string | null; modelSize: ModelSize;
  separate: boolean; device: Device; engine: Engine;
}
interface CreateJobResponse { jobId: string; }

interface JobStatus {
  status: JobStatusValue; stage: string; pct: number; message: string;
  result?: Result; error?: string;
}

interface Word    { start: number; end: number; word: string; prob: number; } // prob 0..1
interface Segment { id: number; start: number; end: number; text: string; words: Word[]; }
interface ResultMeta { modelSize: string; separated: boolean; durationSec: number; engine: string; }
interface Result  { language: string; modeUsed: JobMode; segments: Segment[]; meta: ResultMeta; }

interface ExportEditedBody { result: Result; fmt: ExportFormat; level: ExportLevel; }
```

These mirror `API_CONTRACT.md` exactly. **Do not** redefine them locally — import from `../api/types`.

---

## 2. API client — `src/api/*`

`src/api/client.ts`
- `API_BASE = 'http://127.0.0.1:8756'`
- `class ApiError extends Error { status: number; offline: boolean }` — `offline === true` on network failure (backend down).
- `apiUrl(path, query?)` → absolute URL string.
- `client.get<T>(path, query?, signal?) => Promise<T>`
- `client.postJson<T>(path, body, signal?) => Promise<T>`
- `client.postForm<T>(path, FormData, signal?) => Promise<T>`
- `client.download(path, { method?, query?, jsonBody? }) => Promise<Blob>`

`src/api/meta.ts`
- `FALLBACK_META: Meta` — sensible offline defaults (gpu/demucs/aligner = true so the full surface shows).
- `fetchMeta(signal?) => Promise<Meta>` (throws `ApiError` on failure; the store decides fallback).

`src/api/jobs.ts`
- `createJob(audio: File, params: JobParams, signal?) => Promise<CreateJobResponse>` (multipart).
- `getJob(jobId: string, signal?) => Promise<JobStatus>`
- `exportEdited(result: Result, fmt, level) => Promise<Blob>`  → `POST /api/export`
- `exportOriginal(jobId, fmt, level) => Promise<Blob>` → `GET /api/jobs/{id}/export`

---

## 3. Stores (zustand) — `src/state/*`

All are `create<...>()` hooks. Read with a selector to avoid needless re-renders:
`const x = useStore(s => s.x)`.

### `useMeta` — `src/state/useMeta.ts`
| field | type | notes |
|---|---|---|
| `meta` | `Meta` | starts as `FALLBACK_META`; never null |
| `online` | `boolean` | true only when meta loaded from a reachable backend |
| `loading` | `boolean` | |
| `error` | `string \| null` | |
| `load()` | `() => Promise<void>` | call once at startup (App already does); keeps fallback + sets `online=false` on failure |

### `useJob` — `src/state/useJob.ts`
| field | type | notes |
|---|---|---|
| `jobId` | `string \| null` | |
| `status` | `JobStatusValue \| 'idle'` | |
| `stage` `pct` `message` | `string` `number` `string` | live poll output |
| `result` | `Result \| null` | set when `status==='done'` |
| `error` | `string \| null` | |
| `audioFile` | `File \| null` | the submitted song (decode waveform locally from this) |
| `audioObjectUrl` | `string \| null` | object URL for `<audio>` (managed/revoked by the store) |
| `submitting` | `boolean` | |
| `startedAt` | `number \| null` | epoch ms, for elapsed |
| `submit(audio, params)` | `(File, JobParams) => Promise<void>` | creates job + auto-polls every 700 ms until done/error |
| `reset()` | `() => void` | stops polling, clears lifecycle (keeps result/audio) |

### `useResultStore` — `src/state/useResultStore.ts`
`interface WordRef { segId: number; wordIndex: number }`
| field | type | notes |
|---|---|---|
| `result` | `Result \| null` | the **editable** working copy |
| `original` | `Result \| null` | pristine server copy |
| `dirty` | `boolean` | any edit flips this true → drives export routing |
| `selected` | `WordRef \| null` | drives the WordInspector |
| `load(result)` | `(Result) => void` | clones + resets dirty/selected |
| `clear()` | `() => void` | |
| `select(ref)` | `(WordRef \| null) => void` | |
| `editWordText(ref, text)` | | rebuilds segment text |
| `setWordStart(ref, s)` | | **prev word's end follows** (no gap), clamps to `< end` |
| `setWordEnd(ref, e)` | | **next word's start follows** (no gap), clamps to `> start` |
| `confirmWord(ref)` | | sets `prob = 1` (snaps amber → solid) |
| `editSegmentText(segId, text)` | | whole-line edit |

### `useAudio` — `src/state/useAudio.ts`
Single shared `HTMLAudioElement`. `currentTime` republished via rAF while playing — bind the WordSweep to it.
| field | type | notes |
|---|---|---|
| `src` `playing` | `string\|null` `boolean` | |
| `currentTime` `duration` | `number` `number` | seconds |
| `loop` | `{start,end} \| null` | auto-loops a region |
| `setSrc(src)` | `(string\|null) => void` | point at an object URL |
| `play()` `pause()` `toggle()` | `() => void` | |
| `seek(t)` | `(number) => void` | absolute seconds |
| `skip(delta)` | `(number) => void` | ±5 s transport etc. |
| `setLoop(region)` | `({start,end}\|null) => void` | |

### `useLibrary` — `src/state/useLibrary.ts`
Local run history (no list endpoint exists; persisted to `localStorage`). App appends on job done.
`interface RunRecord { id; title; mode: JobMode; language; modelSize; engine; durationSec; createdAt; result: Result }`
- `runs: RunRecord[]`, `add(run)`, `remove(id)`, `clear()`.

### `useSettings` — `src/state/useSettings.ts`
Persisted local defaults. `defaults: Defaults`, `set(patch: Partial<Defaults>)`, `reset()`.
`Defaults = { engine; device; modelSize; language: string|null; mode; exportFormat; separate }`.

---

## 4. Lib utilities — `src/lib/*`

`timecode.ts`
- `NUDGE_STEP = 0.01`
- `formatTimecode(sec) => 'mm:ss.mmm'` · `formatClock(sec) => 'mm:ss'` · `formatDuration(sec) => '0.000s'`
- `parseTimecode(text) => number | null` (accepts `mm:ss.mmm`, `ss.mmm`, `ss`)
- `nudge(sec, steps, step?) => number` (±10 ms, clamped ≥0) · `snapToGrid(sec, step?)`

`waveform.ts`
- `interface PeakData { peaks: Float32Array; length: number; duration: number; sampleRate: number }` (peaks interleaved min,max,min,max…)
- `decodePeaks(source: ArrayBuffer|Blob|File, buckets=2000) => Promise<PeakData>`
- `decimateBuffer(AudioBuffer, buckets) => PeakData`
- `visibleWindow(data, startSec, endSec) => Float32Array`
- `peaksToPath(peaks, width, height) => string` (SVG path)

`onset.ts`
- `interface Onset { time: number; strength: number }`
- `detectOnsets(data: PeakData, sensitivity=0.12) => Onset[]`
- `magnetize(onsets, time, window=0.08) => number` (snap to nearest onset for grab-retiming)

`exporters.ts` (client preview — mirrors backend formats)
- `renderExport(result, fmt, { level, precisionMs? }) => string`
- `toLrc(result, level)` · `toSrt(result)` · `toAss(result)` · `toJson(result)`
- `exportFilename(fmt, level) => string`

---

## 5. Primitives — `src/components/primitives` (barrel `index.ts`)

Import: `import { Button, Pill, ... } from '../../components/primitives';`
The barrel imports `primitives.css` once — don't re-import it.

| Component | Key props |
|---|---|
| `Button` | `variant?: 'default'\|'primary'\|'ghost'\|'danger'` · `size?: 'sm'\|'md'\|'lg'` · `icon?: ReactNode` · plus native `<button>` props |
| `IconButton` | `label: string` (required, a11y) · `icon: ReactNode` · `active?: boolean` · `size?: 'sm'\|'md'` |
| `Pill` | `active?` · `static?` · `icon?` · `onClick?` · `disabled?` · `title?` (toggle chip) |
| `Badge` | `tone?: 'neutral'\|'gold'\|'green'\|'amber'\|'error'` · `dot?: boolean` (glowing status dot) |
| `Eyebrow` | `num?: string\|number` (gold, zero-padded) · `rule?: boolean` (trailing hairline) — section labels |
| `Field` | text input; `label?` `hint?` + native `<input>` props |
| `TextAreaField` | `label?` `hint?` `serif?` + native `<textarea>` props (serif = reference editor) |
| `SelectField` | `label?` `hint?` + native `<select>` props; pass `<option>` children |
| `ProgressBar` | `value?: 0..100` · `indeterminate?` · `tone?: 'gold'\|'green'` |
| `HairlineRule` | `strong?` · `vertical?` |
| `TapeCounter` | `value: number(sec)` · `label?` · `onCommit?(sec)` (editable when provided) · `display?: string` |
| `Popover` | `open: boolean` · `onClose: () => void` · `style?` (absolute position) — backdrop + Esc close |

---

## 6. Shell — `src/components/shell`

- `tabs.ts`: `type TabKey = 'transcribe'|'editor'|'export'|'library'|'settings'` and `TABS: TabDef[]` (`{ key, zh, en, icon: LucideIcon }`). **Single source for nav + router.**
- `AppFrame` — wraps everything; owns the `data-tauri-drag-region` titlebar.
- `TabRail` — `{ active: TabKey; onChange(key); collapsed? }`.
- `StatusStrip` — `{ activeTab: TabKey }`; reads `useMeta` for the GPU/offline badge + version.

`App.tsx` holds `tab` state and routes. Each tab component is mounted only when active.

---

## 7. Tab component seams (what you're deepening)

All tab files compile + render today; deepen the marked interactions.

**Transcribe** (`tabs/transcribe/`) — `TranscribeTab` owns the setup form state and calls `useJob.submit`. Sub-components are presentational with explicit props:
- `Dropzone {file, durationSec, onFile, onClear}`
- `ModeCards {value, onChange, alignerEnabled, readiness: Record<JobMode,number>}`
- `ReferenceEditor {value, onChange, mode:'biasing'|'align'}` (revealed only for biasing/align)
- `StyleChips {styles, selected, onToggle, contentHint, onContentHint}`
- `LanguageSelect {languages, value, onChange}`
- `StageProgress {status, stage, pct, message, error, elapsedSec, onOpenEditor}`

**Editor** (`tabs/editor/`) — `EditorTab` reads `useResultStore` + `useAudio`, decodes `useJob.audioFile` into peaks.
- `LyricDocument {result, currentTime, flat, selected, onSeek, onSelectWord}` — rack-focus + click-to-seek done; deepen sweep precision/scroll.
- `WordSweep {word, currentTime}` — gold underline width = playhead progress (already linear/`currentTime`-bound).
- `WordInspector {word, wordRef, onText, onStart, onEnd, onConfirm}` — inline edit + tape counters + ±10 ms done; **TODO: boundary-handle drag + onset magnetize** (use `lib/onset.magnetize`).
- `WaveformStrip {peaks, currentTime, duration, onSeek, height?}` — playhead + click-seek done; **TODO: drag-to-retime + onset flash.**
- `Transport {playing, currentTime, duration, peaks, onToggle, onSkip, onSeek}`
- `ConfidenceMark` — exports `LOW_CONFIDENCE=0.55`, `isLowConfidence(word)`, `wordClass(word,{selected,passing})`.

**Export** (`tabs/export/`) — `ExportTab` reads `useResultStore` + `useAudio` + `useJob.jobId`.
- `FormatLinks {value: {fmt,level}, onChange}` · `LivePreview {result, fmt, level, currentTime}` (ASS active line highlights; **TODO: animate the `\k` sweep**) · `ExportActions {result, fmt, level, dirty, jobId}` (routing + offline fallback done).

**Library** (`tabs/library/`) — `LibraryTab {onNavigate(tab)}` reads `useLibrary`; `RunRow {run, onOpen, onReExport, onDuplicate, onDelete}`.

**Settings** (`tabs/settings/`) — `SettingsTab` reads `useMeta` + `useSettings`; `GpuReadout {online, gpu, gpuName?, vramUsedGb?, vramTotalGb?, cudaBuild?}`; `ModelManager {modelSizes}` (install state is skeleton — wire to backend model status).

---

## 8. CSS tokens & classes

**All tokens** live in `src/styles/tokens.css` (`:root`). Use `var(--al-…)`; never hardcode. Families:
- Surfaces: `--al-bg --al-surface --al-surface-2 --al-hairline --al-hairline-strong`
- Ink: `--al-ink --al-ink-dim --al-ink-muted --al-ink-faint`
- Accents: `--al-gold --al-gold-soft --al-gold-glow --al-amber --al-amber-glow --al-green --al-green-glow --al-error`
- Fonts: `--al-font-display` (serif hero) `--al-font-body` (Inter) `--al-font-mono` (JetBrains)
- Type scale: `--al-lyric-active|near|far` `--al-text-lg|md|sm|xs` `--al-tracking-caps` `--al-leading-lyric`
- Radii: `--al-radius-app|panel|ctrl|chip`
- Spacing/layout: `--al-gutter --al-pad-panel --al-rail-w --al-space-1..6`
- Elevation: `--al-shadow-panel --al-shadow-pop`
- Motion: `--al-ease-ink --al-ease-snap --al-dur-focus(220ms) --al-dur-snap(140ms)` (use snap for edit micro-ops, ink for focus shifts)

**Shared utility classes** (already defined): `.al-spin` (spinner), `.al-tabpage` / `.al-tabpage__head` / `.al-tabpage__title` / `.al-tabpage__lede` (page scaffold), `.al-empty` / `.al-empty__title` (empty states). Each tab folder has its own scoped stylesheet imported by its top component (e.g. `transcribe.css`); add classes there, prefix `al-`.

**Reduced motion** is handled globally (`prefers-reduced-motion` zeroes snap/focus durations). Keep any new animation token-driven so it inherits this.
