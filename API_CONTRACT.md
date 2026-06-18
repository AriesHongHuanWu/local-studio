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
  "modelSizes": ["large-v3", "medium", "small"],
  "engines":    ["whisper"],
  "gpu":        true,        // boolean — GPU available
  "demucs":     true,        // boolean — vocal separation available
  "aligner":    true,        // boolean — forced aligner available
  "version":    "string"
}
```

---

### `POST /api/jobs`

Create a recognition/alignment job. **`multipart/form-data`** with two fields:

| Field | Type | Description |
|---|---|---|
| `audio` | file | The song file (mp3 / wav / flac / m4a). |
| `params` | string | A JSON string — schema below. |

**`params` JSON:**

```jsonc
{
  "mode": "auto" | "biasing" | "align",
  "referenceLyrics": "string",   // multiline; line breaks are meaningful
  "referenceContent": "string",  // freeform hint text
  "styleKeys": ["pop", "ballad"],// from /api/meta styles
  "language": "string | null",   // whisper code, or null = auto-detect
  "modelSize": "large-v3 | medium | small",
  "separate": true,              // run Demucs vocal separation first
  "device": "auto" | "cuda" | "cpu",
  "engine": "whisper"
}
```

**Response:**

```jsonc
{ "jobId": "string" }
```

> UI note: `mode: "align"` is the **Forced-Align** path (full lyrics → near-perfect). `mode: "biasing"` feeds `referenceContent` + `styleKeys` into the recognizer. `mode: "auto"` is pure transcription.

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

### `GET /api/jobs/{id}/export?fmt=…&level=…`

Download the **original** (unedited) result as a file.

| Query | Values |
|---|---|
| `fmt` | `lrc` \| `srt` \| `ass` \| `json` |
| `level` | `line` \| `word` |

Returns a file download.

---

### `POST /api/export`

Export an **edited** result. JSON body; returns a formatted text file download.

```jsonc
{
  "result": { /* Result */ },
  "fmt":    "lrc" | "srt" | "ass" | "json",
  "level":  "line" | "word"
}
```

> UI note: use this after any in-editor edit; use `GET /api/jobs/{id}/export` only for an untouched result.

---

## `Result` shape

```jsonc
{
  "language": "string",
  "modeUsed": "auto" | "biasing" | "align",
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
