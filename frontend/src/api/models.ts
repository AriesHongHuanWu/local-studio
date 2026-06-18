/* ──────────────────────────────────────────────────────────────────
   api/models.ts — typed wrappers for the Model Manager endpoints.

   GET    /api/models               → ModelsResponse
   POST   /api/models/{id}/download → { jobId }
   GET    /api/models/jobs/{jobId}  → ModelJob
   DELETE /api/models/{id}          → { ok, freedMB }
   ────────────────────────────────────────────────────────────────── */

import { client, API_BASE, ApiError } from './client';
import type { ModelsResponse, ModelJob } from './types';

export function listModels(): Promise<ModelsResponse> {
  return client.get<ModelsResponse>('/api/models');
}

export function downloadModel(id: string): Promise<{ jobId: string }> {
  return client.postJson<{ jobId: string }>(
    `/api/models/${encodeURIComponent(id)}/download`,
    {},
  );
}

export function getModelJob(jobId: string): Promise<ModelJob> {
  return client.get<ModelJob>(`/api/models/jobs/${encodeURIComponent(jobId)}`);
}

/**
 * DELETE /api/models/{id} — the client helper only has GET/POST,
 * so we issue the DELETE directly with a typed fetch.
 */
export async function deleteModel(id: string): Promise<{ ok: boolean; freedMB: number }> {
  const url = `${API_BASE}/api/models/${encodeURIComponent(id)}`;
  let res: Response;
  try {
    res = await fetch(url, { method: 'DELETE' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'network error';
    throw new ApiError(`Cannot reach local backend (${message})`, 0, true);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = (await res.json()) as { detail?: string };
      detail = data.detail ?? detail;
    } catch { /* non-JSON error body */ }
    throw new ApiError(detail || `Delete failed (${res.status})`, res.status);
  }
  return res.json() as Promise<{ ok: boolean; freedMB: number }>;
}
