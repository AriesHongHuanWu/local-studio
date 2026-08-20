# Local Studio

A local-first desktop studio for musicians and video creators: audio mastering, word-level lyric timing, video subtitles, on-screen text removal, an audio-reactive visualizer, and a multitrack video editor. Everything runs as a process on your own machine.

Independent artists end up stitching together a cloud mastering service, a subtitle site, a lyric-timing tool and a video editor, each with its own account, upload step and minute quota. Local Studio packages the same jobs into one desktop app whose media processing happens locally: audio and video files are read from disk, processed by a Python backend bound to `127.0.0.1`, and written back to disk. It is a solo project, built as a Tauri v2 desktop shell around a FastAPI service, and it is the app I use for my own releases.

Landing page: **https://arieshonghuanwu.github.io/local-studio/**
Installers: [Releases](https://github.com/AriesHongHuanWu/local-studio/releases) (Windows NSIS, macOS dmg, Linux deb/AppImage)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/AriesHongHuanWu/local-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/AriesHongHuanWu/local-studio/actions/workflows/ci.yml)

The repository contains no screenshots. `examples/` contains real exporter output (LRC, SRT, ASS, JSON) for a hand-authored demo result, so you can see the exact file formats the app writes without installing anything.

## How it works

Three processes, one app.

```
Tauri v2 shell (Rust)          frontend/src-tauri/src/lib.rs
  │  spawns + supervises
  ▼
Python backend (FastAPI)       backend/app.py, bound to 127.0.0.1:8756
  ▲  HTTP /api
  │
React 19 + Vite webview        frontend/src/
```

### The Rust shell owns the backend's lifecycle

`frontend/src-tauri/src/lib.rs` is not a thin wrapper. A packaged install puts the Python source in a read-only resource directory, but a virtualenv and model caches need somewhere writable, so on first launch the shell copies `backend/` into the per-user app-data directory, runs a setup wizard there (create venv, pip install PyTorch with the right CUDA index, then `requirements.txt`), and streams `setup-progress` events to the UI. After that it spawns `<work>/.venv/Scripts/python.exe app.py` as a child process with `CREATE_NO_WINDOW` on Windows.

Reaping that child is handled three ways, because a stale `uvicorn` holding port 8756 breaks the next launch: an explicit `kill()` on `RunEvent::ExitRequested`, a `Drop` impl on the managed `BackendProcess` state, and a Windows Job Object so the OS kills the child if the parent dies abnormally. An `AtomicBool` serializes setup and restart so two installers cannot race for the port.

### The recognition pipeline

`backend/pipeline/pipeline.py` orchestrates four steps and returns the `Result` shape documented in `API_CONTRACT.md`.

| Step | Module | What happens |
|---|---|---|
| Device resolve | `config.py` | `auto` becomes `cuda` or `cpu` |
| Vocal separation | `separate.py` | Demucs `htdemucs` strips the backing track (song mode only) |
| Recognition | `transcribe.py` / `align.py` | see below |
| Assembly | `pipeline.py` | segment ids, duration, progress bands (separate 0–40, recognize 40–95, finish 95–100) |

Step 3 branches on what reference text the user supplied:

- **Full lyrics pasted** goes to `align.py`, which runs `torchaudio.functional.forced_align` with the `MMS_FA` bundle. Timing is measured against known words, so nothing is spelled wrong. This path was chosen specifically because `forced_align` ships precompiled in the torchaudio wheel, whereas `ctc-forced-aligner` needs a C++ toolchain that most Windows users do not have.
- **Partial lyrics or a style hint** goes to `transcribe.py` with `initial_prompt` biasing.
- **Nothing pasted** is plain faster-whisper transcription.

CJK is the awkward case: a Chinese line has no spaces, and treating a whole line as one token destroys the timeline. `align.py` builds its own token plan that splits Latin runs on whitespace and CJK runs per character, keeps a `token_line_idx[]` parallel array, and regroups after alignment. Because the `MMS_FA` dictionary is Latin, `romanize.py` maps Mandarin through `pypinyin`, Cantonese through `pycantonese` jyutping, and anything else through `uroman`, degrading to the next layer whenever an optional package is missing.

Compute type is picked per device in `transcribe.py`: `float16` on CUDA, `int8` on CPU, with an automatic retry at `int8_float16` when a CUDA OOM is detected. `hardware.py` probes GPU, VRAM, CUDA version, CPU and RAM and recommends a Whisper size accordingly, which is what the first-run wizard shows.

### Mastering

`backend/pipeline/mastering.py` (about 2,600 lines) is pure numpy/scipy DSP, no model weights. Two tone paths: a genre-preset path with tuned parametric EQ and compressor settings, and a reference path that analyzes the average spectrum of a track you upload and does FFT response matching toward it. Loudness targets are integrated LUFS with a true-peak ceiling via `pyloudnorm`: streaming `-14`, balanced `-12`, social `-9`, all at `-1 dBTP`. The frontend visualizes the result in `frontend/src/tabs/transcribe/mastering/` with a spectrum chart, the generated auto-EQ curve, a goniometer, gain-reduction meter, multiband panel and signal chain view.

### Text removal

`backend/pipeline/inpaint.py` takes a normalized `0..1` rectangle so coordinates are resolution independent, then erases that region frame by frame. Engines degrade in a chain: LaMa via `simple-lama-inpainting` first, OpenCV `cv2.inpaint` (Telea) as the no-model fallback. Encoding goes through PyAV's bundled ffmpeg, trying `h264_nvenc`, then `h264_qsv`, then `libx264`, then `mpeg4`. The audio track is demuxed and remuxed by stream copy, so it is never re-encoded.

### Exporters

`backend/pipeline/export.py` implements `to_lrc` (line and enhanced word level), `to_srt`, `to_vtt`, `to_ass` (karaoke `\k` sweep) and `to_json`. Subtitle output is not a naive dump: `wrap_cues` splits cues that exceed a character, duration or characters-per-second budget, picks split points on word boundaries, wraps Latin and CJK by different rules, and enforces a minimum inter-cue gap.

### Modes

`frontend/src/state/useMode.ts` defines nine modes; `frontend/src/components/shell/tabs.ts` decides which of the five tabs each one surfaces.

| Mode | Entry component | What it does |
|---|---|---|
| `catalog` | `tabs/catalog/CatalogFlow.tsx` | Groups artifacts by song into projects |
| `song` | `tabs/transcribe/TranscribeTab.tsx` | Word-level lyrics, LRC / SRT / ASS / JSON |
| `video` | same | Speech to subtitles, SRT / WebVTT |
| `clean` | `tabs/transcribe/CleanTextFlow.tsx` | Box a region, inpaint it out of every frame |
| `master` | `tabs/transcribe/MasteringFlow.tsx` | The mastering chain and its analysis panels |
| `tools` | `tabs/transcribe/ToolboxFlow.tsx` | 12 single-purpose audio tools |
| `download` | `tabs/transcribe/DownloadFlow.tsx` | yt-dlp audio fetch plus key/BPM/section analysis |
| `visualizer` | `tabs/visualizer/VisualizerFlow.tsx` | 17 audio-reactive canvas templates, MP4 out |
| `cut` | `tabs/cut/CutFlow.tsx` | Multitrack video editor (beta gated, see limitations) |

The toolbox tools registered in `backend/pipeline/tools.py` are: de-ess analyzer, loudness meter, key and BPM detection, one-click vocal chain, loudness normalize, hum removal, spectral-gate denoise, silence trim, fade, stereo width, DC removal with normalize, and format conversion.

The video editor exports twice over. `tabs/cut/exportHQ.ts` renders frame by frame through WebCodecs with `prefer-hardware`, mixes audio offline in an `OfflineAudioContext`, and muxes to MP4 with `mp4-muxer`; if any step is unsupported the caller falls back to a real-time `MediaRecorder` capture.

### HTTP surface

`backend/app.py` exposes 34 routes, all under `127.0.0.1:8756`. The main groups:

```
GET  /api/meta  /api/health  /api/hardware  /api/storage
POST /api/jobs            GET /api/jobs/{id}  /api/jobs/{id}/export
POST /api/export
GET/POST/DELETE /api/models[...]      model download, detect, delete
POST /api/inpaint  /api/inpaint/frame + job polling and result
POST /api/caption                     burn captions into video
POST /api/master  /api/master/analyze  /api/master/match + job polling
GET  /api/tools   POST /api/tools/run  /api/tools/fetch
POST /api/download/probe  /api/download/fetch   GET /api/download/status
POST /api/analyze/song    /api/compose/click
```

Every heavy import in `backend/pipeline/` is wrapped so a missing dependency turns into an `is_available()` returning false and a `503` from the route, rather than a crashed server. That is why CI can byte-compile the backend without installing torch.

## Tech stack

| Layer | What is actually used |
|---|---|
| Desktop shell | Tauri v2 (Rust), plugins: updater, dialog, fs, process, opener, drag |
| Frontend | React 19, TypeScript 5.6, Vite 6, zustand 5, lucide-react, mp4-muxer |
| Backend | Python 3.10–3.12, FastAPI, uvicorn, python-multipart |
| ML | faster-whisper, Demucs, torch / torchaudio (`MMS_FA` forced alignment) |
| DSP | numpy, scipy, pyloudnorm, soundfile |
| Video | PyAV, OpenCV, `simple-lama-inpainting` (installed separately with `--no-deps`) |
| Romanization | uroman, pypinyin, pycantonese (all optional) |
| Media fetch | yt-dlp |
| CI/CD | GitHub Actions: typecheck plus build on Node 20, `compileall` on the backend; release matrix builds macOS arm64, Ubuntu 22.04 and Windows natively |

## Getting started

Requirements: Python 3.10–3.12 and Node 20+. Packaging additionally needs Rust (rustup) and, on Windows, the MSVC "Desktop development with C++" workload. A GPU is optional; the install scripts detect NVIDIA and install the CUDA build of PyTorch, otherwise the CPU build.

```bash
# Backend only, with the built-in test UI at backend/web/index.html
cd backend
./install.ps1          # macOS/Linux: ./install.sh
./run.ps1              # serves http://127.0.0.1:8756

# Desktop app in dev mode (starts Vite and the backend sidecar)
cd frontend
npm install
npm run tauri dev

# Build installers
npm run tauri build    # → src-tauri/target/release/bundle/
```

Two backend scripts run the pipeline directly, without HTTP, which is the fastest way to check recognition quality:

```bash
cd backend
.venv/Scripts/python test_e2e.py "song.mp3" --lyrics "lyrics.txt"
.venv/Scripts/python test_align_precision.py "song.mp3"
```

## Status and limitations

This is a solo side project that I ship real releases from, currently at v0.2.2. It works, but read this list before judging it as a product.

- **No benchmarks are published.** The repo contains no accuracy or speed measurements, and this README deliberately quotes none. `backend/test_align_precision.py` prints a per-word alignment health check if you want numbers on your own material.
- **No automated test suite.** CI type-checks and builds the frontend and byte-compiles the backend. `backend/test_*.py` are manual diagnostic scripts, not pytest cases, and nothing runs them in CI.
- **Windows is the primary platform.** It is developed and used on Windows. The release workflow builds macOS and Linux bundles on native runners, but those get far less real use.
- **The video editor is beta gated.** `tabs/cut/EditorBetaGate.tsx` hides it behind the literal code `beta` because it is being rebuilt. Canvas compositing and export are hard to verify in CI, so treat that mode as unfinished.
- **The catalog is a frontend-only layer.** `state/useProjects.ts` persists to `localStorage` and stores paths and metadata, not files. There is no database.
- **Text removal quality depends on an optional install.** Without `simple-lama-inpainting` the code falls back to `cv2.inpaint`, which is visibly weaker on large regions.
- **Transcription only, no translation.** Output is always in the source language.
- **Comments are largely in Traditional Chinese**, since I write them for myself. The UI ships bilingual (English / 中文) via `frontend/src/i18n/`; the source comments do not.
- **`docs/` is the marketing site, not documentation.** It is the hand-written HTML/CSS/JS published to GitHub Pages. The technical reference lives in `API_CONTRACT.md`, `DESIGN.md` and `RELEASING.md`.

## License

MIT. See [LICENSE](LICENSE).
