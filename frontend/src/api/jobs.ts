/* ──────────────────────────────────────────────────────────────────
   Job + export endpoints.
   ────────────────────────────────────────────────────────────────── */

import { client } from './client';
import type {
  CreateJobResponse,
  ExportEditedBody,
  ExportFormat,
  ExportLevel,
  JobParams,
  JobStatus,
  Result,
} from './types';

/** POST /api/jobs — multipart/form-data { audio: File, params: JSON string }. */
export async function createJob(
  audio: File,
  params: JobParams,
  signal?: AbortSignal,
): Promise<CreateJobResponse> {
  const form = new FormData();
  form.append('audio', audio, audio.name);
  form.append('params', JSON.stringify(params));
  return client.postForm<CreateJobResponse>('/api/jobs', form, signal);
}

/** GET /api/jobs/{id} — poll status. */
export async function getJob(jobId: string, signal?: AbortSignal): Promise<JobStatus> {
  return client.get<JobStatus>(`/api/jobs/${encodeURIComponent(jobId)}`, undefined, signal);
}

/** POST /api/export — export an EDITED result; returns a downloadable Blob. */
export async function exportEdited(
  result: Result,
  fmt: ExportFormat,
  level: ExportLevel,
): Promise<Blob> {
  const body: ExportEditedBody = { result, fmt, level };
  return client.download('/api/export', { method: 'POST', jsonBody: body });
}

/** GET /api/jobs/{id}/export — download the ORIGINAL (untouched) result. */
export async function exportOriginal(
  jobId: string,
  fmt: ExportFormat,
  level: ExportLevel,
): Promise<Blob> {
  return client.download(`/api/jobs/${encodeURIComponent(jobId)}/export`, {
    method: 'GET',
    query: { fmt, level },
  });
}
