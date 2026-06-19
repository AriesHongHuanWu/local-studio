/* ──────────────────────────────────────────────────────────────────
   CaptionBurn — 動態字幕燒錄 (hard-sub) panel for the Video → Subtitles
   mode. Shown after a transcription completes: pick a style template,
   burn the word-highlighted captions into the video, watch progress,
   then preview + download the captioned mp4.

   Reuses the clean-text job CSS (.al-clean__progress / __video*) and the
   /api/caption client (createCaptionJob → poll → captionResultUrl).
   ────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Download, Loader2, Flame } from 'lucide-react';
import { Button } from '../../components/primitives';
import {
  createCaptionJob,
  getCaptionJob,
  captionResultUrl,
  type CaptionTemplate,
} from '../../api/caption';
import { ApiError } from '../../api/client';
import type { Result } from '../../api/types';
import { useT } from '../../i18n';
import './caption.css';

const POLL_MS = 800;

type Phase = 'idle' | 'running' | 'done' | 'error';

interface Props {
  file: File;
  result: Result;
  /** Templates the backend advertises (defaults to the built-in three). */
  templates?: string[];
}

const TEMPLATE_ORDER: CaptionTemplate[] = ['clean', 'karaoke', 'bold'];

export function CaptionBurn({ file, result, templates }: Props) {
  const t = useT();
  const avail = (templates && templates.length
    ? templates
    : TEMPLATE_ORDER) as CaptionTemplate[];

  const [template, setTemplate] = useState<CaptionTemplate>(avail[0] ?? 'clean');
  const [phase, setPhase] = useState<Phase>('idle');
  const [pct, setPct] = useState(0);
  const [message, setMessage] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);

  // Clean up the poll loop on unmount.
  useEffect(() => {
    return () => {
      stoppedRef.current = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  const poll = useCallback(
    async (id: string) => {
      if (stoppedRef.current) return;
      try {
        const st = await getCaptionJob(id);
        if (stoppedRef.current) return;
        setPct(st.pct ?? 0);
        setMessage(st.message ?? '');
        if (st.status === 'done') {
          setPct(100);
          setPhase('done');
          setResultUrl(`${captionResultUrl(id)}?t=${Date.now()}`);
          return;
        }
        if (st.status === 'error') {
          setErrorMsg(st.error || t('caption.error.job'));
          setPhase('error');
          return;
        }
        pollTimer.current = setTimeout(() => void poll(id), POLL_MS);
      } catch (err: unknown) {
        if (stoppedRef.current) return;
        const msg =
          err instanceof ApiError && err.offline
            ? t('caption.error.offline')
            : err instanceof Error
              ? err.message
              : t('caption.error.job');
        setErrorMsg(msg);
        setPhase('error');
      }
    },
    [t],
  );

  const run = useCallback(() => {
    if (!file || !result.segments.length) return;
    stoppedRef.current = false;
    setPhase('running');
    setPct(0);
    setMessage(t('caption.preparing'));
    setErrorMsg(null);
    setResultUrl(null);
    void (async () => {
      try {
        const { jobId } = await createCaptionJob(file, result.segments, template);
        if (stoppedRef.current) return;
        pollTimer.current = setTimeout(() => void poll(jobId), POLL_MS);
      } catch (err: unknown) {
        if (stoppedRef.current) return;
        const msg =
          err instanceof ApiError && err.offline
            ? t('caption.error.offline')
            : err instanceof Error
              ? err.message
              : t('caption.error.job');
        setErrorMsg(msg);
        setPhase('error');
      }
    })();
  }, [file, result.segments, template, poll, t]);

  const running = phase === 'running';
  const isDone = phase === 'done' && !!resultUrl;
  const isError = phase === 'error';

  return (
    <div className="al-capburn">
      <div className="al-capburn__head">
        <Flame size={15} className="al-capburn__icon" />
        <div>
          <div className="al-capburn__title">{t('caption.title')}</div>
          <p className="al-capburn__lede">{t('caption.lede')}</p>
        </div>
      </div>

      {/* template picker */}
      <div className="al-capburn__templates" role="radiogroup" aria-label={t('caption.styleAria')}>
        {avail.map((tpl) => (
          <button
            key={tpl}
            type="button"
            role="radio"
            aria-checked={template === tpl}
            className={`al-capburn__tpl${template === tpl ? ' al-capburn__tpl--active' : ''}`}
            onClick={() => setTemplate(tpl)}
            disabled={running}
          >
            <span className="al-capburn__tplname">{t(`caption.tpl.${tpl}`)}</span>
            <span className="al-capburn__tpldesc">{t(`caption.tplDesc.${tpl}`)}</span>
          </button>
        ))}
      </div>

      <div className="al-capburn__actions">
        <Button
          variant="primary"
          size="md"
          icon={running ? <Loader2 size={16} className="al-spin" /> : <Sparkles size={16} />}
          disabled={running || !result.segments.length}
          onClick={run}
        >
          {running
            ? t('caption.running')
            : isDone
              ? t('caption.rerun')
              : t('caption.start')}
        </Button>
      </div>

      {(running || isError) && (
        <div
          className={`al-clean__progress${isError ? ' al-clean__progress--error' : ''}`}
        >
          {!isError && (
            <div className="al-progressbar" aria-hidden="true">
              <div className="al-progressbar__fill" style={{ width: `${Math.round(pct)}%` }} />
            </div>
          )}
          <div className="al-clean__progressfoot">
            <span className={isError ? 'al-clean__msg--error' : 'al-clean__msg'}>
              {isError ? errorMsg : message}
            </span>
            {!isError && <span className="al-clean__pct">{Math.round(pct)}%</span>}
          </div>
        </div>
      )}

      {isDone && resultUrl && (
        <div className="al-capburn__result">
          <div className="al-clean__videowrap">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video className="al-clean__video" src={resultUrl} controls autoPlay loop />
          </div>
          <Button
            variant="primary"
            size="md"
            icon={<Download size={15} />}
            onClick={() => {
              const a = document.createElement('a');
              a.href = resultUrl;
              a.download = 'captioned.mp4';
              a.click();
            }}
          >
            {t('caption.download')}
          </Button>
        </div>
      )}
    </div>
  );
}
