/* ──────────────────────────────────────────────────────────────────
   Inpaint (Clean Text / 文字移除) endpoints.

   The "clean" product mode boxes a burned-in text region on a video;
   the backend runs AI inpainting (LaMa) frame-by-frame to erase it and
   re-encodes an mp4 with the ORIGINAL audio preserved.

   Contract (backend base http://127.0.0.1:8756):
     POST /api/inpaint/frame  multipart {video, at?}        -> image/jpeg (one frame)
     POST /api/inpaint        multipart {video, regions, …} -> { jobId }
     GET  /api/inpaint/jobs/{id}                            -> InpaintJobStatus
     GET  /api/inpaint/jobs/{id}/result                     -> video/mp4 (download)

   Regions are NORMALIZED 0..1 rectangles relative to the frame w/h.
   ────────────────────────────────────────────────────────────────── */

import { apiUrl, ApiError, API_BASE } from './client';

/** One text box to erase, normalized to 0..1 of the frame size. */
export interface InpaintRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Inpaint engine. "lama" = AI (default); "opencv" = classical fallback. */
export type InpaintEngine = 'lama' | 'opencv';

export type InpaintJobStatusValue = 'queued' | 'running' | 'done' | 'error';

export interface InpaintJobStatus {
  status: InpaintJobStatusValue;
  pct: number; // 0..100
  message: string;
  error: string | null;
  meta: Record<string, unknown>;
}

/** Response of POST /api/inpaint. */
export interface CreateInpaintJobResponse {
  jobId: string;
}

/**
 * POST /api/inpaint/frame — grab one frame (JPEG) for the box canvas.
 * Returns the image as a Blob so the caller can make an object URL.
 */
export async function postInpaintFrame(file: File, at = 0): Promise<Blob> {
  const form = new FormData();
  form.append('video', file, file.name);
  if (at > 0) form.append('at', String(at));

  let res: Response;
  try {
    res = await fetch(apiUrl('/api/inpaint/frame'), { method: 'POST', body: form });
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
    throw new ApiError(detail || `Frame grab failed (${res.status})`, res.status);
  }
  return res.blob();
}

/**
 * POST /api/inpaint — spawn the background erase job.
 * `regions` are normalized 0..1; serialized as a JSON string form field.
 */
export async function createInpaintJob(
  file: File,
  regions: InpaintRegion[],
  engine: InpaintEngine = 'lama',
  startSec?: number,
  endSec?: number,
  signal?: AbortSignal,
): Promise<CreateInpaintJobResponse> {
  const form = new FormData();
  form.append('video', file, file.name);
  form.append('regions', JSON.stringify(regions));
  form.append('engine', engine);
  if (startSec !== undefined) form.append('startSec', String(startSec));
  if (endSec !== undefined) form.append('endSec', String(endSec));

  let res: Response;
  try {
    res = await fetch(apiUrl('/api/inpaint'), { method: 'POST', body: form, signal });
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
    throw new ApiError(detail || `Inpaint failed (${res.status})`, res.status);
  }
  return (await res.json()) as CreateInpaintJobResponse;
}

/** GET /api/inpaint/jobs/{id} — poll job status. */
export async function getInpaintJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<InpaintJobStatus> {
  let res: Response;
  try {
    res = await fetch(apiUrl(`/api/inpaint/jobs/${encodeURIComponent(jobId)}`), {
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
  return (await res.json()) as InpaintJobStatus;
}

/**
 * Absolute URL for the finished mp4 (GET /api/inpaint/jobs/{id}/result).
 * Use directly as a <video src> or anchor href — 404s until the job is done.
 */
export function inpaintResultUrl(jobId: string): string {
  return apiUrl(`/api/inpaint/jobs/${encodeURIComponent(jobId)}/result`);
}
