/* ──────────────────────────────────────────────────────────────────
   TypeScript types mirroring API_CONTRACT.md exactly.
   Single source of truth for the data shapes the whole app passes around.
   ────────────────────────────────────────────────────────────────── */

/* ── GET /api/meta ── */

export interface StyleOption {
  key: string;
  label: string;
}

export interface LanguageOption {
  code: string;
  label: string;
  iso3: string;
}

/**
 * Whisper model sizes. The CPU-fast tiers (large-v3-turbo, base, tiny) are
 * included so the "Video → Subtitles" mode can default to a fast model on
 * GPU-less laptops; the backend advertises which it actually has installed
 * via /api/meta modelSizes (and /api/models for install state).
 */
export type ModelSize =
  | 'large-v3'
  | 'large-v3-turbo'
  | 'medium'
  | 'small'
  | 'base'
  | 'tiny';
export type Engine = 'whisper';

export interface Meta {
  styles: StyleOption[];
  languages: LanguageOption[];
  modelSizes: ModelSize[];
  engines: Engine[];
  gpu: boolean;
  demucs: boolean;
  aligner: boolean;
  /** Caption burn-in (hard-sub) available (PyAV + PIL). Optional — older backends omit it. */
  caption?: boolean;
  /** Available caption style templates (e.g. ['clean','karaoke','bold']). */
  captionTemplates?: string[];
  version: string;
}

/* ── POST /api/jobs — params ── */

/**
 * Job modes.
 *   auto / biasing / align — the song-lyrics pipeline (Demucs → Whisper → align).
 *   speech                 — plain video/audio caption transcription
 *                            (no separation, no forced-align). Added for the
 *                            "Video → Subtitles" product mode.
 */
export type JobMode = 'auto' | 'biasing' | 'align' | 'speech';
export type Device = 'auto' | 'cuda' | 'cpu';

export interface JobParams {
  mode: JobMode;
  referenceLyrics: string; // multiline; line breaks meaningful
  referenceContent: string; // freeform hint text
  styleKeys: string[]; // from /api/meta styles
  language: string | null; // whisper code, or null = auto-detect
  modelSize: ModelSize;
  separate: boolean; // run Demucs vocal separation first
  device: Device;
  engine: Engine;
  /** Snap each word boundary to the nearest detected vocal onset (align mode). Default true. */
  refine: boolean;
  /** Demucs model name. "htdemucs" (standard) | "htdemucs_ft" (fine-tuned, slower). */
  demucsModel: string;
  /**
   * Whisper task. "transcribe" (original language) is the only value used in
   * v1; the field is a forward-compat hook so an optional local translate
   * module can later request "translate" without a contract change. Optional
   * — omitted/undefined means the backend default ("transcribe").
   */
  task?: string;
  /**
   * Precision mode: advanced decoding tuned for singing / long audio —
   * hotword biasing from the reference lyrics (re-applied every 30s window,
   * unlike initial_prompt which fades), anti-hallucination loops, wider beam.
   * Slower but more accurate. Optional; omitted/false = standard decoding.
   */
  precision?: boolean;
}

export interface CreateJobResponse {
  jobId: string;
}

/* ── GET /api/jobs/{id} — status ── */

export type JobStatusValue = 'queued' | 'running' | 'done' | 'error';

export interface JobStatus {
  status: JobStatusValue;
  stage: string; // human-readable stage label
  pct: number; // 0..100
  message: string;
  result?: Result; // present when status === "done"
  error?: string; // present when status === "error"
}

/* ── Result shape ── */

export interface Word {
  start: number; // seconds
  end: number; // seconds
  word: string;
  prob: number; // 0..1 confidence — drives the amber low-confidence mark
}

export interface Segment {
  id: number;
  start: number; // seconds
  end: number; // seconds
  text: string;
  words: Word[];
}

export interface ResultMeta {
  modelSize: string;
  separated: boolean; // whether Demucs ran
  durationSec: number;
  engine: string;
}

export interface Result {
  language: string;
  modeUsed: JobMode;
  segments: Segment[];
  meta: ResultMeta;
}

/* ── GET /api/models ── */

export type ModelKind = 'whisper' | 'demucs' | 'aligner';

export interface ModelInfo {
  id: string;
  kind: ModelKind;
  label: string;
  description: string;
  sizeMB: number;
  installed: boolean;
  sizeOnDiskMB: number;
  recommended: boolean;
  vramHint: string;
  /** The model_size string transcribe() uses; null for non-whisper models. */
  whisperSize: string | null;
  /** True for demucs/aligner (required for separation/forced-align) and
   *  one whisper size is conceptually required; UI uses this to guard removal. */
  required: boolean;
}

export interface ModelsResponse {
  models: ModelInfo[];
  diskUsedMB: number;
  cacheDir: string;
  gpuVramTotalMB: number | null;
}

export interface ModelJob {
  status: 'running' | 'done' | 'error';
  pct: number; // 0..100
  message: string;
  error?: string;
}

/* ── GET /api/hardware ── */

export interface HardwareTier {
  model: string;
  whisperSize: string;
  fits: boolean;
}

export interface HardwareRecommended {
  model: string;
  device: 'cuda' | 'cpu';
  whisperSize: string;
  /** Short stable code mapped to a localized explanation in the frontend. */
  reasonCode: string;
}

export interface HardwareInfo {
  gpu: boolean;
  gpuName: string | null;
  vramTotalMB: number | null;
  vramFreeMB: number | null;
  cuda: boolean;
  cudaVersion: string | null;
  cpu: string;
  cpuCount: number;
  ramTotalMB: number | null;
  recommended: HardwareRecommended;
  tiers: HardwareTier[];
}

/* ── Export ── */

export type ExportFormat = 'lrc' | 'srt' | 'ass' | 'json' | 'webvtt';
export type ExportLevel = 'line' | 'word';

export interface ExportEditedBody {
  result: Result;
  fmt: ExportFormat;
  level: ExportLevel;
}
