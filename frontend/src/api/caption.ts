/* ──────────────────────────────────────────────────────────────────
   Caption burn-in (動態字幕燒錄 / hard-sub) endpoints.

   Renders the recognised result's WORD-level timings as karaoke-style
   captions burned into the video, re-encoding an mp4 with the ORIGINAL
   audio preserved.

   Contract (backend base http://127.0.0.1:8756):
     POST /api/caption        multipart {video, segments, template} -> { jobId }
     GET  /api/caption/jobs/{id}                                    -> CaptionJobStatus
     GET  /api/caption/jobs/{id}/result                             -> video/mp4
   ────────────────────────────────────────────────────────────────── */

import { apiUrl, ApiError, API_BASE } from './client';
import type { Segment } from './types';

/** Caption style template. */
export type CaptionTemplate = 'clean' | 'karaoke' | 'bold';

export type CaptionJobStatusValue = 'queued' | 'running' | 'done' | 'error';

export interface CaptionJobStatus {
  status: CaptionJobStatusValue;
  pct: number; // 0..100
  message: string;
  error: string | null;
  meta: Record<string, unknown> | null;
}

export interface CreateCaptionJobResponse {
  jobId: string;
}

/**
 * POST /api/caption — spawn the background burn-in job.
 * `segments` carry the word-level timings; serialized as a JSON form field.
 */
export async function createCaptionJob(
  file: File,
  segments: Segment[],
  template: CaptionTemplate,
  signal?: AbortSignal,
): Promise<CreateCaptionJobResponse> {
  const form = new FormData();
  form.append('video', file, file.name);
  form.append('segments', JSON.stringify(segments));
  form.append('template', template);

  let res: Response;
  try {
    res = await fetch(apiUrl('/api/caption'), { method: 'POST', body: form, signal });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'network error';
    throw new ApiError(`Cannot reach local backend at ${API_BASE} (${message})`, 0, true);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = (await res.json()) as { detail?: string; message?: string };
      detail = data.detail ?? data.message ?? detail;
    } catch {
      /* non-JSON error body — keep statusText */
    }
    throw new ApiError(detail || `Caption burn failed (${res.status})`, res.status);
  }
  return (await res.json()) as CreateCaptionJobResponse;
}

/** GET /api/caption/jobs/{id} — poll job status. */
export async function getCaptionJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<CaptionJobStatus> {
  let res: Response;
  try {
    res = await fetch(apiUrl(`/api/caption/jobs/${encodeURIComponent(jobId)}`), {
      method: 'GET',
      signal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'network error';
    throw new ApiError(`Cannot reach local backend at ${API_BASE} (${message})`, 0, true);
  }
  if (!res.ok) {
    throw new ApiError(`Job status failed (${res.status})`, res.status);
  }
  return (await res.json()) as CaptionJobStatus;
}

/** Absolute URL for the finished mp4 (GET /api/caption/jobs/{id}/result). */
export function captionResultUrl(jobId: string): string {
  return apiUrl(`/api/caption/jobs/${encodeURIComponent(jobId)}/result`);
}
