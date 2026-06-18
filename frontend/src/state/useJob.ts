/* ──────────────────────────────────────────────────────────────────
   useJob — job lifecycle: submit → poll /api/jobs/{id} → expose
   stage / pct / result. Tracks the source File so the Editor/Library
   can re-decode the waveform locally.
   ────────────────────────────────────────────────────────────────── */

import { create } from 'zustand';
import { createJob, getJob } from '../api/jobs';
import type { JobParams, JobStatusValue, Result } from '../api/types';

const POLL_INTERVAL_MS = 700;

interface JobState {
  jobId: string | null;
  status: JobStatusValue | 'idle';
  stage: string;
  pct: number;
  message: string;
  result: Result | null;
  error: string | null;
  /** The audio File the user submitted (kept for local waveform decode). */
  audioFile: File | null;
  audioObjectUrl: string | null;
  submitting: boolean;
  startedAt: number | null;

  /** Submit a new job; begins polling automatically. */
  submit: (audio: File, params: JobParams) => Promise<void>;
  /** Stop polling + clear lifecycle state (keeps result/audio). */
  reset: () => void;
}

let pollTimer: ReturnType<typeof setTimeout> | null = null;

function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

export const useJob = create<JobState>((set, get) => ({
  jobId: null,
  status: 'idle',
  stage: '',
  pct: 0,
  message: '',
  result: null,
  error: null,
  audioFile: null,
  audioObjectUrl: null,
  submitting: false,
  startedAt: null,

  submit: async (audio, params) => {
    stopPolling();
    // revoke any previous object url
    const prevUrl = get().audioObjectUrl;
    if (prevUrl) URL.revokeObjectURL(prevUrl);

    const objectUrl = URL.createObjectURL(audio);
    set({
      submitting: true,
      status: 'queued',
      stage: '排隊中 Queued',
      pct: 0,
      message: '',
      result: null,
      error: null,
      audioFile: audio,
      audioObjectUrl: objectUrl,
      startedAt: Date.now(),
    });

    try {
      const { jobId } = await createJob(audio, params);
      set({ jobId, submitting: false, status: 'running' });

      const poll = async () => {
        try {
          const s = await getJob(jobId);
          set({
            status: s.status,
            stage: s.stage,
            pct: s.pct,
            message: s.message,
            result: s.result ?? get().result,
            error: s.error ?? null,
          });
          if (s.status === 'done' || s.status === 'error') {
            stopPolling();
            return;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'poll failed';
          set({ status: 'error', error: message });
          stopPolling();
          return;
        }
        pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
      };
      pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'submit failed';
      set({ submitting: false, status: 'error', error: message });
    }
  },

  reset: () => {
    stopPolling();
    set({
      jobId: null,
      status: 'idle',
      stage: '',
      pct: 0,
      message: '',
      error: null,
      submitting: false,
      startedAt: null,
    });
  },
}));
