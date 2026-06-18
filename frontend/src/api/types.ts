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

export type ModelSize = 'large-v3' | 'medium' | 'small';
export type Engine = 'whisper';

export interface Meta {
  styles: StyleOption[];
  languages: LanguageOption[];
  modelSizes: ModelSize[];
  engines: Engine[];
  gpu: boolean;
  demucs: boolean;
  aligner: boolean;
  version: string;
}

/* ── POST /api/jobs — params ── */

export type JobMode = 'auto' | 'biasing' | 'align';
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

/* ── Export ── */

export type ExportFormat = 'lrc' | 'srt' | 'ass' | 'json';
export type ExportLevel = 'line' | 'word';

export interface ExportEditedBody {
  result: Result;
  fmt: ExportFormat;
  level: ExportLevel;
}
