# AutoLyrics — API Contract

> **Single source of truth.** The frontend and backend MUST both match this exactly.
> FastAPI, served locally at **`http://127.0.0.1:8756`**. Local-first — nothing leaves the machine.

---

## Endpoints

### `GET /api/meta`

Capabilities and option lists for the UI to render selects, chips, and feature gates.

```jsonc
{
  "styles":     [ { "key": "string", "label": "string" } ],   // genre chips
  "languages":  [ { "code": "string", "label": "string", "iso3": "string" } ],
  "modelSizes": ["large-v3", "large-v3-turbo", "medium", "small"],
  "modes":      [ { "key": "string", "label": "string", "kind": "song" | "speech" } ],
  "formats":    ["lrc", "srt", "vtt", "ass", "json"],
  "engines":    ["whisper"],
  "gpu":        true,        // boolean — GPU available
  "demucs":     true,        // boolean — vocal separation available
  "aligner":    true,        // boolean — forced aligner available
  "inpaint":    true,        // boolean — video text-removal (LaMa/OpenCV inpainting) available
  "version":    "string"
}
```

> `modes[].kind` groups the two top-level flows: `"song"` = lyrics recognition / forced-align (`auto`, `biasing`, `align`); `"speech"` = **Video → Subtitles** (`speech`). `large-v3-turbo` is the fast distilled model — the auto-recommended pick on a no-GPU machine (e.g. Intel Core Ultra).
>
> `meta.inpaint` gates the third top-level mode **🧹 文字移除 / Clean Text** (see the **Text removal** endpoints below). It is `true` when PyAV + numpy are present (the OpenCV fallback always works); the higher-quality LaMa engine is an extra `--no-deps simple-lama-inpainting` install — when it is missing the engine transparently falls back to OpenCV, so `meta.inpaint` stays `true`.

---

### `POST /api/jobs`

Create a recognition / alignment / transcription job. **`multipart/form-data`** with two fields:

| Field | Type | Description |
|---|---|---|
| `audio` | file | Audio (mp3 / wav / flac / m4a / aac / ogg / opus) **or video** (mp4 / mkv / mov / webm / m4v). Video is decoded by PyAV/ffmpeg; the audio track is extracted automatically. The field name stays `audio` for both. |
| `params` | string | A JSON string — schema below. |

**`params` JSON:**

```jsonc
{
  "mode": "auto" | "biasing" | "align" | "speech",
  "referenceLyrics": "string",   // multiline; line breaks are meaningful (song modes)
  "referenceContent": "string",  // freeform hint text (biasing)
  "styleKeys": ["pop", "ballad"],// from /api/meta styles
  "language": "string | null",   // whisper code, or null = auto-detect
  "modelSize": "large-v3 | large-v3-turbo | medium | small",
  "separate": true,              // run Demucs vocal separation first (song modes); send false for speech
  "device": "auto" | "cuda" | "cpu",
  "engine": "whisper",
  "task": "string | null"        // speech mode: faster-whisper task; null == "transcribe".
                                  // forward hook for a future local translate module — v1 is transcription only.
}
```

**Response:**

```jsonc
{ "jobId": "string" }
```

> UI note: `mode: "align"` is the **Forced-Align** path (full lyrics → near-perfect). `mode: "biasing"` feeds `referenceContent` + `styleKeys` into the recognizer. `mode: "auto"` is pure transcription.
>
> **`mode: "speech"` (Video → Subtitles):** plain speech transcription in the original language — **no** lyric biasing, and **no** vocal separation by default (send `"separate": false`). Reference/style fields are ignored. Returns the same `Result` shape with `modeUsed: "speech"`. Pair with `subtitle: true` on export to get clean, wrapped SRT/WebVTT captions. On a no-GPU machine the recommended `modelSize` is `large-v3-turbo` (fast); `large-v3` is unusably slow on CPU.

---

### `GET /api/jobs/{id}`

Poll job status. `result` is present only when `status === "done"`; `error` only on `"error"`.

```jsonc
{
  "status":  "queued" | "running" | "done" | "error",
  "stage":   "string",      // human-readable stage label
  "pct":     0,             // number 0..100
  "message": "string",
  "result":  { /* Result */ },  // present when status === "done"
  "error":   "string"           // present when status === "error"
}
```

---

### `GET /api/jobs/{id}/export?fmt=…&level=…&subtitle=…`

Download the **original** (unedited) result as a file.

| Query | Values |
|---|---|
| `fmt` | `lrc` \| `srt` \| `vtt` \| `ass` \| `json` |
| `level` | `line` \| `word` |
| `subtitle` | `true` \| `false` (default `false`) |

Returns a file download.

> `vtt` is **WebVTT** (`HH:MM:SS.mmm`, dot — not the SRT comma). `subtitle=true` applies video-caption shaping to `srt` / `vtt`: over-long / over-long-duration / over-CPS segments are split at natural boundaries (punctuation or word gaps) and wrapped to ≤2 balanced lines (Latin ~42 chars/line, CJK ~18). `subtitle=false` (default) keeps lyric output byte-for-byte and is the only mode that matters for `lrc` / `ass` / `json`.

---

### `POST /api/export`

Export an **edited** result. JSON body; returns a formatted text file download.

```jsonc
{
  "result":   { /* Result */ },
  "fmt":      "lrc" | "srt" | "vtt" | "ass" | "json",
  "level":    "line" | "word",
  "subtitle": false   // apply video-caption shaping to srt/vtt (see GET export note)
}
```

> UI note: use this after any in-editor edit; use `GET /api/jobs/{id}/export` only for an untouched result. For the **Video → Subtitles** flow, set `fmt: "srt"` or `"vtt"` with `subtitle: true`.

---

## Environment health & self-heal

### `GET /api/health`

Report what is **present vs missing** — Python deps (importable + version), CUDA, and each model — so the UI can warn the user by name and auto re-fetch **only** the missing pieces (reusing anything already cached). Offline-fast: dep probes are pure imports, model detection reads local caches — no network. **Never 500s:** if the health module or heavy deps are absent (the very case it detects), it degrades to a minimal `{ healthy: false, backend: "degraded", missing: [...] }` payload.

```jsonc
{
  "healthy": true,            // false if ANY required item is missing
  "deps": {                   // keyed by import name
    "torch":          { "id": "torch", "ok": true,  "version": "2.8.0+cu128", "error": null, "required": true,  "label": "PyTorch", "pip": "torch" },
    "faster_whisper": { "id": "faster_whisper", "ok": true,  "version": "1.0.3", "error": null, "required": true,  "label": "…", "pip": "faster-whisper" },
    "demucs":         { "id": "demucs", "ok": false, "version": null, "error": "ModuleNotFoundError: …", "required": false, "label": "…", "pip": "demucs" }
    // … torch, faster_whisper, av, soundfile, fastapi (required);
    //    torchvision, torchaudio, ctranslate2, demucs, simple_lama_inpainting,
    //    cv2, numpy, uvicorn, pypinyin, pycantonese (optional)
  },
  "cuda": { "available": true, "version": "12.8", "gpuName": "NVIDIA GeForce RTX 5060", "vramTotalMB": 8192 },
  "models": [                 // from pipeline.models.list_models() (subset of fields)
    { "id": "whisper-large-v3", "kind": "whisper", "label": "…", "installed": true, "sizeOnDiskMB": 3090.0, "sizeMB": 3090, "required": false }
    // … includes the LaMa entry "lama-bigvlama" (kind "inpaint")
  ],
  "missing": [                // flat list the UI warns about + repairs
    { "category": "dep",   "id": "demucs", "label": "…", "required": false, "reason": "import failed …", "pip": "demucs" },
    { "category": "model", "id": "aligner-mms", "label": "…", "required": true, "sizeMB": 1160, "reason": "model not downloaded" }
  ],
  "features": {               // does each mode have what it needs?
    "songLyrics": true,       // torch + faster_whisper + av
    "videoSubtitles": true,   // torch + faster_whisper + av
    "cleanText": true         // av + (simple_lama + LaMa model) OR cv2 fallback
  },
  "version": "0.1.0"
}
```

> A **dep** is "missing" only if it failed to `import`; a **model** is "missing" only when `installed === false`. `required` reflects whether the item blocks a core feature (required deps: `torch`, `faster_whisper`, `av`, `soundfile`, `fastapi`; required models: `demucs-htdemucs`, `aligner-mms`). To self-heal, re-run setup (deps — pip skips already-installed packages) and `POST /api/models/{id}/download` for each missing model (reuses anything already cached, never re-downloads what is present).

---

## Models — `/api/models`

`GET /api/models` → `{ models[], diskUsedMB, cacheDir, gpuVramTotalMB }`; each model `{ id, kind, label, installed, sizeOnDiskMB, sizeMB, required, recommended, vramHint, whisperSize, … }`. `POST /api/models/{id}/download` → `{ jobId }` (poll `GET /api/models/jobs/{jobId}` → `{ status, pct, message, error? }`). `DELETE /api/models/{id}` → `{ ok, freedMB }` (409 for required models / the last Whisper).

Model ids: `whisper-tiny|base|small|medium|large-v3|large-v3-turbo` (kind `whisper`), `demucs-htdemucs` (required) / `demucs-htdemucs-ft` (kind `demucs`), `aligner-mms` (required, kind `aligner`), and **`lama-bigvlama`** (kind `inpaint`, not required, ~196 MB) — the LaMa `big-lama.pt` weight for 🧹 Clean Text. LaMa detection reads `torch-hub/checkpoints/big-lama.pt` (size-banded ~196 MB); its download fetches the simple-lama-inpainting v0.1.0 release into that dir. When the LaMa model (or `simple-lama-inpainting`) is absent, text removal transparently falls back to OpenCV, so `meta.inpaint` stays `true`.

---

## Storage / 儲存空間

Backs the Settings **Storage / 儲存空間** panel, which lets the user free space in tiers without nuking everything: (1) delete a single model (`DELETE /api/models/{id}`, above), (2) clear **all** models but keep the app (`POST /api/models/clear-all`), (3) full reset keeping models (`reset_backend` Tauri command, `delete_models: false`), (4) full reset that also clears models (frontend calls `POST /api/models/clear-all` **then** `reset_backend` with `delete_models: true`). Each tier shows how much space it frees and requires an explicit confirm.

### `GET /api/storage`

A usage breakdown for the panel. Defensive — never 500s; any sub-measurement that fails falls back to a safe value.

```jsonc
{
  "venvMB":  1234.5,   // size of the running venv (recursive walk of sys.prefix); 0 if it cannot be computed
  "modelsMB": 5678.9,  // = pipeline.models.disk_used_mb() — total of all downloaded model caches
  "models": [          // all registry models (include all; only installed ones occupy space)
    { "id": "whisper-large-v3", "label": "…", "kind": "whisper", "sizeOnDiskMB": 3090.0, "required": false, "installed": true }
  ],
  "cacheDir": "string",  // user-level model cache root (for display)
  "totalMB": 6913.4      // venvMB + modelsMB
}
```

> `venvMB` is the **per-install** backend environment (torch cu128 etc.) — deleted by `reset_backend`. `modelsMB` lives in the **user-level** caches (`~/.cache/huggingface`, torch hub) — deleted only by `clear-all` / a single-model delete, and **persists across reinstalls** otherwise.

### `POST /api/models/clear-all`

Delete **every installed** model file (including required ones — `demucs-htdemucs`, `aligner-mms` — and the last Whisper). The user explicitly chose clear-all; the health self-heal re-fetches required models when next needed. Internally iterates `pipeline.models.list_models()` and calls `delete(id, force=True)` (the `force` flag bypasses the required / last-Whisper guard). Defensive: one model failing does **not** abort the rest.

```jsonc
{
  "clearedIds": ["whisper-large-v3", "demucs-htdemucs", "aligner-mms"],
  "freedMB": 5678.9
}
```

> `500` only if `pipeline.models` cannot be loaded at all. Otherwise always `200` — per-model failures are logged and skipped, and the response reports exactly which ids were actually cleared.

---

## Desktop shell — Tauri commands

Invoked from the frontend via `@tauri-apps/api/core` `invoke(...)` (not HTTP). These manage the backend process / install environment that the HTTP API above cannot touch (it would be deleting the very python.exe it runs in).

| Command | Signature | Purpose |
|---|---|---|
| `backend_status` | `() -> { venv_exists, backend_dir_exists, backend_dir, python_found, python_cmd, python_version }` | First-run wizard / routing: is the venv built, is Python available. |
| `setup_backend` | `() -> void` | Runs the install (venv → pip → torch → requirements) on a background thread; streams `setup-progress` / `setup-done` events; starts the backend on success. |
| `restart_backend` | `() -> bool` | (Re)start the backend after a completed install. |
| `reset_backend` | `(delete_models: bool) -> Result<(), String>` | **Full reset.** See below. |

### `reset_backend(delete_models: boolean)`

Backs Storage tiers (3) **Full reset · keep models** and (4) **Full reset · also delete models**. Steps:

1. `kill()`s the backend child process — releasing the `python.exe` file lock on the venv — and waits briefly.
2. Resolves the WORK backend dir and deletes its `.venv` directory (`remove_dir_all`), plus the transient `out` / `jobs` / `tmp` dirs if present. It does **not** touch the backend source (`app.py` / `pipeline/**`) — `ensure_work_source` re-stages it on next launch — nor the `models` dir.
3. Returns `Ok(())`. The frontend then re-runs `checkStatus()`; the venv is gone, so the setup wizard reappears for a clean re-install.

> **Models are handled by the backend, not here.** For tier (4), the frontend calls `POST /api/models/clear-all` **before** invoking `reset_backend(true)`, so models are deleted through the backend (which knows the exact HF / torch user-cache paths). `reset_backend` itself **never** touches the user-level caches — the `delete_models` flag is only logged/forwarded. So tier (3) (`delete_models: false`) leaves the user model caches intact, and a reinstall / repair reuses them.
>
> Defensive: missing paths are skipped, never panics. Returns `Err(string)` only if `.venv` exists but cannot be removed (e.g. a lingering lock) — the UI can then suggest restarting the app and retrying.

---

## Text removal — 🧹 文字移除 / Clean Text

The third top-level mode. The user loads a video, draws one or more boxes over text that was accidentally burned in (a fixed on-screen position), and AI inpainting (**LaMa**, falling back to **OpenCV**) erases that region on **every frame**. The export is an mp4 with the region cleaned and the **original audio preserved** (stream-copied, lossless). Gated by `meta.inpaint`.

Boxes are passed as **normalized `0..1` coordinates** relative to the frame width/height — resolution-independent, so the box drawn on the preview frame maps exactly onto the full-resolution video.

### `POST /api/inpaint/frame`

Grab one frame as a JPEG, for the box-drawing canvas. **`multipart/form-data`:**

| Field | Type | Description |
|---|---|---|
| `video` | file | The source video (mp4 / mkv / mov / webm / m4v …). |
| `at` | string/number | Optional — timestamp in **seconds** (default `0`). |

**Response:** `200 image/jpeg` — a single decoded frame (downscaled to ≤1280px wide). `503` if `meta.inpaint` is false.

---

### `POST /api/inpaint`

Start a background text-removal job. **`multipart/form-data`:**

| Field | Type | Description |
|---|---|---|
| `video` | file | The source video. |
| `regions` | string | A JSON string — array of boxes, **normalized `0..1`**: `[{ "x": 0.1, "y": 0.8, "w": 0.5, "h": 0.1 }]`. Must be non-empty. |
| `engine` | string | `"lama"` (default, AI) or `"opencv"` (classic fallback). |
| `startSec` | string/number | Optional — only inpaint frames at/after this time (seconds). |
| `endSec` | string/number | Optional — only inpaint frames at/before this time (seconds). Both `startSec` **and** `endSec` must be sent to scope a time range; otherwise the whole clip is processed. |

**Response:**

```jsonc
{ "jobId": "string" }
```

A background thread runs the inpaint to a temp `<jobId>.mp4`. `503` if `meta.inpaint` is false, `400` on bad/empty `regions`.

---

### `GET /api/inpaint/jobs/{id}`

Poll a text-removal job.

```jsonc
{
  "status":  "queued" | "running" | "done" | "error",
  "pct":     0,             // number 0..100
  "message": "string",      // human-readable stage label
  "error":   "string | null",   // present (non-null) only on "error"
  "meta":    { /* result */ } | null   // present (non-null) only when "done"
}
```

When `status === "done"`, `meta` carries the engine result:

```jsonc
{
  "outPath":     "string",   // server-side temp path (internal)
  "frames":      0,          // frames processed
  "encoder":     "string",   // e.g. "h264_nvenc" | "libx264" | "mpeg4"
  "engineUsed":  "lama" | "opencv",   // which inpaint engine actually ran
  "width":       0,
  "height":      0,
  "durationSec": 0.0
}
```

---

### `GET /api/inpaint/jobs/{id}/result`

Download the cleaned video. Returns `video/mp4` as an attachment (`Content-Disposition: attachment; filename="cleaned.mp4"`). **`404` until the job is `done`** (and if the output file is missing or the job id is unknown).

---

## `Result` shape

```jsonc
{
  "language": "string",
  "modeUsed": "auto" | "biasing" | "align" | "speech",
  "segments": [
    {
      "id":    0,
      "start": 0.0,   // seconds
      "end":   0.0,   // seconds
      "text":  "string",
      "words": [
        {
          "start": 0.0,   // seconds
          "end":   0.0,   // seconds
          "word":  "string",
          "prob":  0.0    // 0..1 confidence — drives the amber low-confidence mark
        }
      ]
    }
  ],
  "meta": {
    "modelSize":   "string",
    "separated":   false,    // whether Demucs ran
    "durationSec": 0.0,
    "engine":      "string"
  }
}
```

---

## Frontend contract notes

- **Confidence:** `words[].prob` drives the hollow-amber low-confidence treatment in the Editor (pulses once as the playhead passes).
- **Capability gating:** disable the Demucs toggle when `meta.demucs === false`; disable Forced-Align mode when `meta.aligner === false`; show GPU options per `meta.gpu`.
- **Library metadata:** display `result.meta.modelSize` + `result.meta.engine` + `modeUsed` per run — a local-first trust signal.
- **Export routing:** edited result → `POST /api/export`; untouched result → `GET /api/jobs/{id}/export`.
- **Timecodes:** all `start`/`end` are seconds (float). UI renders mono `mm:ss.mmm`; ±10 ms nudge = ±0.01 s.
