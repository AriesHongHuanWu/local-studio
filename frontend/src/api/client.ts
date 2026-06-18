/* ──────────────────────────────────────────────────────────────────
   Thin fetch wrapper for the local FastAPI base. Typed, with graceful
   error surfacing so the UI can render its full chrome even when the
   backend is NOT running.
   ────────────────────────────────────────────────────────────────── */

export const API_BASE = 'http://127.0.0.1:8756';

export class ApiError extends Error {
  readonly status: number;
  readonly offline: boolean;
  constructor(message: string, status: number, offline = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.offline = offline;
  }
}

/** Build an absolute URL against the API base. */
export function apiUrl(path: string, query?: Record<string, string | number | undefined>): string {
  const url = new URL(path.startsWith('/') ? path.slice(1) : path, API_BASE + '/');
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

interface RequestOptions {
  method?: string;
  body?: BodyInit;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  query?: Record<string, string | number | undefined>;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = apiUrl(path, opts.query);
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      body: opts.body,
      headers: opts.headers,
      signal: opts.signal,
    });
  } catch (err) {
    // Network failure (backend offline, CORS, etc.) — flag as offline.
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
    throw new ApiError(detail || `Request failed (${res.status})`, res.status);
  }
  return (await res.json()) as T;
}

export const client = {
  /** Typed GET returning parsed JSON. */
  get<T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal): Promise<T> {
    return request<T>(path, { method: 'GET', query, signal });
  },

  /** Typed POST with a JSON body. */
  postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    return request<T>(path, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      signal,
    });
  },

  /** Typed POST with a multipart/form-data body (the browser sets boundary). */
  postForm<T>(path: string, form: FormData, signal?: AbortSignal): Promise<T> {
    return request<T>(path, { method: 'POST', body: form, signal });
  },

  /** POST/GET expecting a binary file download (returns a Blob). */
  async download(
    path: string,
    opts: { method?: 'GET' | 'POST'; query?: RequestOptions['query']; jsonBody?: unknown } = {},
  ): Promise<Blob> {
    const url = apiUrl(path, opts.query);
    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method ?? 'GET',
        body: opts.jsonBody !== undefined ? JSON.stringify(opts.jsonBody) : undefined,
        headers: opts.jsonBody !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'network error';
      throw new ApiError(`Cannot reach local backend at ${API_BASE} (${message})`, 0, true);
    }
    if (!res.ok) throw new ApiError(`Export failed (${res.status})`, res.status);
    return res.blob();
  },
};
