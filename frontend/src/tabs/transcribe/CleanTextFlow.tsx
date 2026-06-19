/* ──────────────────────────────────────────────────────────────────
   CleanTextFlow — the "Clean Text / 文字移除" (mode 3) surface.

   Flow:
     1) Drop a video.
     2) POST /api/inpaint/frame → show one frame in BoxCanvas to box the
        burned-in text.
     3) Pick the AI engine (LaMa default) + hit "Remove text".
     4) POST /api/inpaint → poll the job (700ms) with a gold ProgressBar →
        on done, show the result <video> with a before/after toggle and a
        Download button. Errors surface inline with a Retry.

   Reuses the song/video Dropzone (video mode), ProgressBar, Button, and
   the al-* design system. Nothing here touches the song/video stores.
   ────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Eraser, RotateCcw, Sparkles } from 'lucide-react';
import { Button, Eyebrow, ProgressBar, SelectField } from '../../components/primitives';
import { Dropzone } from './Dropzone';
import { BoxCanvas } from './BoxCanvas';
import {
  createInpaintJob,
  getInpaintJob,
  inpaintResultUrl,
  postInpaintFrame,
} from '../../api/inpaint';
import type { InpaintEngine, InpaintRegion } from '../../api/inpaint';
import { ApiError } from '../../api/client';
import { useT } from '../../i18n';
import './clean.css';

type Phase = 'idle' | 'framing' | 'ready' | 'running' | 'done' | 'error';

const POLL_MS = 700;

export function CleanTextFlow() {
  const t = useT();

  // ── source ──
  const [file, setFile] = useState<File | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  /** Object URL of the original video (for the before/after toggle). */
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  // ── frame + boxes ──
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [frameSize, setFrameSize] = useState<{ w: number; h: number }>({ w: 16, h: 9 });
  const [regions, setRegions] = useState<InpaintRegion[]>([]);

  // ── engine + job ──
  const [engine, setEngine] = useState<InpaintEngine>('lama');
  const [phase, setPhase] = useState<Phase>('idle');
  const [pct, setPct] = useState(0);
  const [message, setMessage] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  /** Cache-busted result URL (so the <video> reloads after a re-run). */
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  // before/after preview toggle (true = show cleaned result)
  const [showAfter, setShowAfter] = useState(true);

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);

  // Revoke object URLs on unmount + stop any polling.
  useEffect(() => {
    return () => {
      stoppedRef.current = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      if (frameUrl) URL.revokeObjectURL(frameUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetJob = useCallback(() => {
    stoppedRef.current = true;
    if (pollTimer.current) clearTimeout(pollTimer.current);
    setPhase('ready');
    setPct(0);
    setMessage('');
    setErrorMsg(null);
    setJobId(null);
    setResultUrl(null);
    setShowAfter(true);
  }, []);

  // ── load a file → fetch a frame ──
  const onFile = useCallback(
    (f: File) => {
      // Tear down any prior session.
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      if (frameUrl) URL.revokeObjectURL(frameUrl);
      stoppedRef.current = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);

      setFile(f);
      setRegions([]);
      setJobId(null);
      setResultUrl(null);
      setErrorMsg(null);
      setPct(0);
      setMessage('');
      setDurationSec(0);
      setFrameUrl(null);
      setShowAfter(true);

      const url = URL.createObjectURL(f);
      setVideoUrl(url);

      // Probe duration locally for the file card.
      const probe = document.createElement('video');
      probe.preload = 'metadata';
      probe.src = url;
      probe.addEventListener('loadedmetadata', () => {
        setDurationSec(Number.isFinite(probe.duration) ? probe.duration : 0);
      });

      // Fetch the first frame for boxing.
      setPhase('framing');
      void postInpaintFrame(f, 0)
        .then((blob) => {
          const furl = URL.createObjectURL(blob);
          // Read intrinsic size for the canvas aspect ratio.
          const img = new Image();
          img.onload = () => {
            setFrameSize({ w: img.naturalWidth || 16, h: img.naturalHeight || 9 });
          };
          img.src = furl;
          setFrameUrl(furl);
          setPhase('ready');
        })
        .catch((err: unknown) => {
          const msg =
            err instanceof ApiError && err.offline
              ? t('clean.error.offline')
              : err instanceof Error
                ? err.message
                : t('clean.error.frame');
          setErrorMsg(msg);
          setPhase('error');
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [videoUrl, frameUrl, t],
  );

  const clearFile = useCallback(() => {
    stoppedRef.current = true;
    if (pollTimer.current) clearTimeout(pollTimer.current);
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    if (frameUrl) URL.revokeObjectURL(frameUrl);
    setFile(null);
    setVideoUrl(null);
    setFrameUrl(null);
    setRegions([]);
    setDurationSec(0);
    setJobId(null);
    setResultUrl(null);
    setErrorMsg(null);
    setPct(0);
    setMessage('');
    setPhase('idle');
  }, [videoUrl, frameUrl]);

  // ── poll a running job ──
  const poll = useCallback(
    async (id: string) => {
      if (stoppedRef.current) return;
      try {
        const st = await getInpaintJob(id);
        if (stoppedRef.current) return;
        setPct(st.pct ?? 0);
        setMessage(st.message ?? '');
        if (st.status === 'done') {
          setPct(100);
          setPhase('done');
          // Cache-bust so the browser reloads a re-run's output.
          setResultUrl(`${inpaintResultUrl(id)}?t=${Date.now()}`);
          setShowAfter(true);
          return;
        }
        if (st.status === 'error') {
          setErrorMsg(st.error || t('clean.error.job'));
          setPhase('error');
          return;
        }
        // queued / running → keep polling
        pollTimer.current = setTimeout(() => void poll(id), POLL_MS);
      } catch (err: unknown) {
        if (stoppedRef.current) return;
        const msg =
          err instanceof ApiError && err.offline
            ? t('clean.error.offline')
            : err instanceof Error
              ? err.message
              : t('clean.error.job');
        setErrorMsg(msg);
        setPhase('error');
      }
    },
    [t],
  );

  // ── start the erase job ──
  const run = useCallback(() => {
    if (!file || regions.length === 0) return;
    stoppedRef.current = false;
    setPhase('running');
    setPct(0);
    setMessage('');
    setErrorMsg(null);
    setResultUrl(null);
    void createInpaintJob(file, regions, engine)
      .then(({ jobId: id }) => {
        if (stoppedRef.current) return;
        setJobId(id);
        void poll(id);
      })
      .catch((err: unknown) => {
        if (stoppedRef.current) return;
        const msg =
          err instanceof ApiError && err.offline
            ? t('clean.error.offline')
            : err instanceof Error
              ? err.message
              : t('clean.error.job');
        setErrorMsg(msg);
        setPhase('error');
      });
  }, [file, regions, engine, poll, t]);

  const running = phase === 'running';
  const canRun = !!file && phase === 'ready' && regions.length > 0;
  const isDone = phase === 'done' && !!resultUrl;
  const isError = phase === 'error';

  return (
    <div className="al-tabpage">
      <div className="al-tabpage__head">
        <h1 className="al-tabpage__title">{t('clean.title')}</h1>
        <p className="al-tabpage__lede">{t('clean.lede')}</p>
      </div>

      <div className="al-transcribe">
        {/* 01 SOURCE */}
        <section className="al-section">
          <Eyebrow num={1}>{t('clean.section.source')}</Eyebrow>
          <Dropzone
            file={file}
            durationSec={durationSec}
            onFile={onFile}
            onClear={clearFile}
            mode="clean"
          />
          {phase === 'framing' && (
            <p className="al-clean__note" role="status">
              {t('clean.frame.loading')}
            </p>
          )}
        </section>

        {/* 02 BOX THE TEXT — once a frame is available */}
        {file && frameUrl && (phase === 'ready' || running || isDone || isError) && (
          <section className="al-section al-section--reveal">
            <Eyebrow num={2}>{t('clean.section.box')}</Eyebrow>
            <BoxCanvas
              imageUrl={frameUrl}
              width={frameSize.w}
              height={frameSize.h}
              regions={regions}
              onChange={setRegions}
            />
            <div className="al-clean__boxmeta">
              <span className="al-clean__count">
                {t('clean.box.count', { count: regions.length })}
              </span>
              {regions.length > 0 && !running && (
                <button
                  type="button"
                  className="al-clean__clearboxes"
                  onClick={() => setRegions([])}
                >
                  {t('clean.box.clearAll')}
                </button>
              )}
            </div>
          </section>
        )}

        {/* 03 ENGINE + RUN */}
        {file && frameUrl && (
          <section className="al-section">
            <Eyebrow num={3}>{t('clean.section.engine')}</Eyebrow>

            <div className="al-clean__enginerow">
              <SelectField
                label={t('clean.engine.label')}
                value={engine}
                onChange={(e) => setEngine(e.target.value as InpaintEngine)}
                hint={engine === 'lama' ? t('clean.engine.hintLama') : t('clean.engine.hintOpencv')}
                disabled={running}
              >
                <option value="lama">{t('clean.engine.lama')}</option>
                <option value="opencv">{t('clean.engine.opencv')}</option>
              </SelectField>
            </div>

            <div className="al-runbar">
              <Button
                variant="primary"
                size="lg"
                icon={running ? <Sparkles size={18} /> : <Eraser size={18} />}
                disabled={!canRun}
                onClick={run}
              >
                {running ? t('clean.run.running') : t('clean.run.start')}
              </Button>

              {(isDone || isError) && (
                <Button
                  variant="ghost"
                  size="lg"
                  icon={<RotateCcw size={15} />}
                  onClick={resetJob}
                  title={t('clean.run.resetTitle')}
                >
                  {t('clean.run.reset')}
                </Button>
              )}

              <span className="al-runbar__spacer" />
              {!regions.length && phase === 'ready' && (
                <span className="al-runbar__note">{t('clean.run.boxFirst')}</span>
              )}
            </div>

            {/* progress / error panel */}
            {(running || isDone || isError) && (
              <div
                className={`al-clean__progress${isDone ? ' al-clean__progress--done' : ''}${
                  isError ? ' al-clean__progress--error' : ''
                }`}
              >
                <ProgressBar
                  value={isError ? 100 : pct}
                  indeterminate={running && pct === 0}
                  tone={isDone ? 'green' : 'gold'}
                />
                <div className="al-clean__progressfoot">
                  <span
                    className={isError ? 'al-clean__msg--error' : 'al-clean__msg'}
                    role={isError ? 'alert' : 'status'}
                    aria-live={isError ? 'assertive' : 'polite'}
                  >
                    {isError
                      ? (errorMsg ?? t('clean.error.job'))
                      : isDone
                        ? t('clean.run.done')
                        : message || t('clean.run.preparing')}
                  </span>
                  {!isError && <span className="al-clean__pct">{Math.round(pct)}%</span>}
                </div>
                {isError && (
                  <div className="al-clean__retry">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<RotateCcw size={14} />}
                      onClick={run}
                      disabled={!file || regions.length === 0}
                    >
                      {t('common.action.retry')}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* 04 RESULT — before/after + download */}
        {isDone && resultUrl && (
          <section className="al-section al-section--reveal">
            <Eyebrow num={4}>{t('clean.section.result')}</Eyebrow>

            {videoUrl && (
              <div className="al-clean__toggle" role="group" aria-label={t('clean.result.toggleAria')}>
                <button
                  type="button"
                  className={`al-clean__togbtn${!showAfter ? ' al-clean__togbtn--active' : ''}`}
                  aria-pressed={!showAfter}
                  onClick={() => setShowAfter(false)}
                >
                  {t('clean.result.before')}
                </button>
                <button
                  type="button"
                  className={`al-clean__togbtn${showAfter ? ' al-clean__togbtn--active' : ''}`}
                  aria-pressed={showAfter}
                  onClick={() => setShowAfter(true)}
                >
                  {t('clean.result.after')}
                </button>
              </div>
            )}

            <div className="al-clean__videowrap">
              {/* key forces a fresh element when switching source so it reloads */}
              <video
                key={showAfter ? 'after' : 'before'}
                className="al-clean__video"
                src={showAfter ? resultUrl : (videoUrl ?? resultUrl)}
                controls
                playsInline
                aria-label={showAfter ? t('clean.result.after') : t('clean.result.before')}
              />
            </div>

            <div className="al-runbar">
              <a
                className="al-btn al-btn--primary"
                href={resultUrl}
                download={
                  file ? `${file.name.replace(/\.[^.]+$/, '')}-cleaned.mp4` : 'cleaned.mp4'
                }
              >
                <Download size={16} />
                {t('common.action.download')}
              </a>
              <span className="al-runbar__spacer" />
              {jobId && <span className="al-clean__jobid">#{jobId.slice(0, 8)}</span>}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
