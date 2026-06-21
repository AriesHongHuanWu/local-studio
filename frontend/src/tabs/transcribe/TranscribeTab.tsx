import { useCallback, useEffect, useMemo, useState } from 'react';
import { Play, RotateCcw, Scissors, Sparkles, Laptop, Target } from 'lucide-react';
import { AlignPrecision } from './AlignPrecision';
import './transcribe.css';
import { Button, Eyebrow, Pill, SelectField } from '../../components/primitives';
import { Dropzone } from './Dropzone';
import { ModeCards } from './ModeCards';
import type { LyricMode } from './ModeCards';
import { ReferenceEditor } from './ReferenceEditor';
import { StyleChips } from './StyleChips';
import { LanguageSelect } from './LanguageSelect';
import { StageProgress } from './StageProgress';
import { SetupBanner } from './SetupBanner';
import { VideoPreview } from './VideoPreview';
import { CueList } from './CueList';
import { CaptionBurn } from './CaptionBurn';
import { CleanTextFlow } from './CleanTextFlow';
import { MasteringFlow } from './MasteringFlow';
import { ToolboxFlow } from './ToolboxFlow';
import { DownloadFlow } from './DownloadFlow';
import { CatalogFlow } from '../catalog/CatalogFlow';
import { usePendingMedia } from '../../state/usePendingMedia';
import { useMeta } from '../../state/useMeta';
import { useJob } from '../../state/useJob';
import { useResultStore } from '../../state/useResultStore';
import { useModels } from '../../state/useModels';
import { useAudio } from '../../state/useAudio';
import { useMode } from '../../state/useMode';
import { useSettings } from '../../state/useSettings';
import { useT } from '../../i18n';
import type { Device, JobMode, JobParams, ModelSize } from '../../api/types';

/**
 * Pick a CPU-friendly default Whisper model for the video/subtitle flow.
 * Preference order (fast → still-accurate), filtered to what the backend
 * advertises in meta.modelSizes; prefers an INSTALLED model when possible
 * so the first run doesn't stall on a download. Falls back to whatever the
 * backend offers first.
 */
const CPU_FAST_PREFERENCE: ModelSize[] = [
  'large-v3-turbo',
  'small',
  'base',
  'medium',
  'tiny',
];

function pickCpuFastModel(
  available: ModelSize[],
  installed: Set<string>,
): ModelSize {
  const offered = CPU_FAST_PREFERENCE.filter((m) => available.includes(m));
  // 1) first preferred model that is installed
  const installedHit = offered.find((m) => installed.has(m));
  if (installedHit) return installedHit;
  // 2) first preferred model offered (will download on first use)
  if (offered[0]) return offered[0];
  // 3) anything the backend offers
  return available[0] ?? 'small';
}

export interface TranscribeTabProps {
  /** Navigate to the editor after a finished run. */
  onOpenEditor: () => void;
}

export function TranscribeTab({ onOpenEditor }: TranscribeTabProps) {
  const t = useT();
  const meta = useMeta((s) => s.meta);
  const appMode = useMode((s) => s.mode);
  const isVideo = appMode === 'video';
  const setAudioSrc = useAudio((s) => s.setSrc);

  // useJob is a flat store — select the slices we need.
  const submit = useJob((s) => s.submit);
  const reset = useJob((s) => s.reset);
  const status = useJob((s) => s.status);
  const stage = useJob((s) => s.stage);
  const pct = useJob((s) => s.pct);
  const message = useJob((s) => s.message);
  const jobError = useJob((s) => s.error);
  const result = useJob((s) => s.result);
  const submitting = useJob((s) => s.submitting);
  const startedAt = useJob((s) => s.startedAt);

  const loadResult = useResultStore((s) => s.load);

  // ── model install state (for hints + SetupBanner) ──
  const modelInfos = useModels((s) => s.models);
  // Build a quick lookup: whisperSize string → installed bool + sizeMB
  const whisperInstallMap = useMemo(() => {
    const map: Record<string, { installed: boolean; sizeMB: number }> = {};
    for (const m of modelInfos) {
      if (m.kind === 'whisper' && m.whisperSize) {
        map[m.whisperSize] = { installed: m.installed, sizeMB: m.sizeMB };
      }
    }
    return map;
  }, [modelInfos]);

  // Set of installed whisper sizes (for CPU-fast default selection in video mode).
  const installedWhisper = useMemo(() => {
    const set = new Set<string>();
    for (const [size, info] of Object.entries(whisperInstallMap)) {
      if (info.installed) set.add(size);
    }
    return set;
  }, [whisperInstallMap]);

  // The CPU-friendly default model for the subtitle flow.
  const cpuFastModel = useMemo(
    () => pickCpuFastModel(meta.modelSizes, installedWhisper),
    [meta.modelSizes, installedWhisper],
  );

  // ── local setup form ──
  const [file, setFile] = useState<File | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  // Object URL for the video-mode preview + shared audio transport.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<JobMode>('auto');
  const [referenceLyrics, setReferenceLyrics] = useState('');
  const [referenceContent, setReferenceContent] = useState('');
  const [styleKeys, setStyleKeys] = useState<string[]>([]);
  const [language, setLanguage] = useState<string | null>(null);
  const [modelSize, setModelSize] = useState<ModelSize>(meta.modelSizes[0] ?? 'large-v3');
  const [device, setDevice] = useState<Device>('auto');
  const [separate, setSeparate] = useState(meta.demucs);
  const [refine, setRefine] = useState(true);
  const [demucsModel, setDemucsModel] = useState('htdemucs');
  // Precision mode (advanced decoding). Persisted so the choice sticks.
  const precisionDefault = useSettings((s) => s.defaults.precision);
  const setSettings = useSettings((s) => s.set);
  const [precision, setPrecision] = useState(precisionDefault);
  const togglePrecision = useCallback(() => {
    setPrecision((v) => {
      const next = !v;
      setSettings({ precision: next });
      return next;
    });
  }, [setSettings]);

  // keep model default valid if meta resolves after first paint
  useEffect(() => {
    if (!meta.modelSizes.includes(modelSize) && meta.modelSizes[0]) {
      setModelSize(meta.modelSizes[0]);
    }
  }, [meta.modelSizes, modelSize]);

  // if Demucs becomes unavailable, force the toggle off
  useEffect(() => {
    if (!meta.demucs && separate) setSeparate(false);
  }, [meta.demucs, separate]);

  // if the aligner is gone but align was selected, fall back to biasing
  useEffect(() => {
    if (!meta.aligner && mode === 'align') setMode('biasing');
  }, [meta.aligner, mode]);

  // Entering video/subtitle mode: prefer a CPU-fast model and never separate
  // vocals (speech transcription doesn't want Demucs). Only nudges the model
  // when the current pick isn't already a CPU-fast tier, so a user override
  // inside video mode isn't stomped on every render.
  useEffect(() => {
    if (!isVideo) return;
    setSeparate(false);
    if (!CPU_FAST_PREFERENCE.includes(modelSize)) {
      setModelSize(cpuFastModel);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVideo, cpuFastModel]);

  const onFile = useCallback((f: File) => {
    setFile(f);
    setDurationSec(0);
    // Hold a stable object URL for the preview surface + shared transport.
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(f);
    });
    // probe duration locally without holding a player. A <video> element
    // reads metadata for both audio AND video containers (an <audio> element
    // can miss some video files), so use it for the probe.
    const url = URL.createObjectURL(f);
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.src = url;
    probe.addEventListener('loadedmetadata', () => {
      setDurationSec(Number.isFinite(probe.duration) ? probe.duration : 0);
      URL.revokeObjectURL(url);
    });
    probe.addEventListener('error', () => URL.revokeObjectURL(url));
  }, []);

  const clearFile = () => {
    setFile(null);
    setDurationSec(0);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  };

  // In video mode, point the shared audio transport at the preview URL so the
  // VideoPreview, SubtitleOverlay, CueList and Export scrubber share one clock.
  useEffect(() => {
    if (isVideo && previewUrl) setAudioSrc(previewUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVideo, previewUrl]);

  // Hand-off from the Downloader: when the user clicks "匯入字幕/歌詞分析",
  // it switches mode + stashes the downloaded File here; pick it up as if dropped.
  const pendingMedia = usePendingMedia((s) => s.pending);
  const consumePending = usePendingMedia((s) => s.consume);
  useEffect(() => {
    if ((appMode === 'song' || appMode === 'video') && pendingMedia) {
      const f = consumePending();
      if (f) onFile(f);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appMode, pendingMedia]);

  const toggleStyle = (key: string) =>
    setStyleKeys((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));

  // readiness meters: make "why Forced-Align beats Auto" legible to a newcomer.
  const readiness = useMemo<Record<LyricMode, number>>(() => {
    const refLines = referenceLyrics.split('\n').filter((l) => l.trim()).length;
    const hasStyle = styleKeys.length > 0 || referenceContent.trim().length > 0;
    return {
      auto: file ? 1 : 0.4,
      biasing: Math.min(1, (hasStyle ? 0.6 : 0.28) + (refLines > 0 ? 0.32 : 0)),
      align: refLines === 0 ? 0.15 : Math.min(1, 0.4 + refLines * 0.06),
    };
  }, [referenceLyrics, styleKeys, referenceContent, file]);

  const showReference = mode === 'biasing' || mode === 'align';
  const running = status === 'queued' || status === 'running' || submitting;
  const finished = status === 'done' || status === 'error';
  const showProgress = running || finished;

  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running || !startedAt) {
      if (startedAt) setElapsed((Date.now() - startedAt) / 1000);
      return;
    }
    const id = window.setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 100);
    return () => window.clearInterval(id);
  }, [running, startedAt]);

  // Video mode: when the job finishes, hydrate the result store so the
  // VideoPreview overlay + CueList can render captions in place (the song
  // flow defers this to "Open in Editor").
  useEffect(() => {
    if (isVideo && status === 'done' && result) loadResult(result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVideo, status, result]);

  // Revoke the preview object URL on unmount (it's also revoked on replace).
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canRun = !!file && !running;

  const run = useCallback(() => {
    if (!file || running) return;
    const params: JobParams = isVideo
      ? {
          // Video → Subtitles: plain speech transcription. No separation, no
          // forced-align, no reference. CPU-fast model; original language.
          mode: 'speech',
          referenceLyrics: '',
          referenceContent: '',
          styleKeys: [],
          language,
          modelSize,
          separate: false,
          device,
          engine: 'whisper',
          refine: false,
          demucsModel,
          task: 'transcribe',
          precision,
        }
      : {
          mode,
          referenceLyrics: showReference ? referenceLyrics : '',
          referenceContent: mode === 'biasing' ? referenceContent : '',
          styleKeys: mode === 'biasing' ? styleKeys : [],
          language,
          modelSize,
          separate: meta.demucs ? separate : false,
          device,
          engine: 'whisper',
          refine: mode === 'align' ? refine : true,
          demucsModel,
          precision,
        };
    void submit(file, params);
  }, [
    file,
    running,
    isVideo,
    mode,
    showReference,
    referenceLyrics,
    referenceContent,
    styleKeys,
    language,
    modelSize,
    separate,
    device,
    meta.demucs,
    refine,
    demucsModel,
    precision,
    submit,
  ]);

  // ⌘↵ / Ctrl+↵ run shortcut (global while this tab is mounted)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (file && !running) run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [file, running, run]);

  const handleOpenEditor = () => {
    if (result) loadResult(result);
    onOpenEditor();
  };

  const handleReset = () => {
    reset();
    setElapsed(0);
  };

  // Clean Text (文字移除) is a self-contained surface — its own file picker,
  // box canvas, job + poll, and result video. It shares none of the song /
  // video transcription state, so render it instead of the tab body here.
  // (All hooks above still run, keeping hook order stable across modes.)
  if (appMode === 'clean') {
    return <CleanTextFlow />;
  }

  // Auto-Mastering (母帶) — also a self-contained surface (own file picker,
  // genre/loudness pickers, optional reference, job + poll, A/B + download).
  if (appMode === 'master') {
    return <MasteringFlow />;
  }

  // Audio Toolbox (音訊工具箱) — a grid of small tools, self-contained.
  if (appMode === 'tools') {
    return <ToolboxFlow />;
  }

  // Downloader + Song Analyzer (下載器) — self-contained surface; hands a
  // downloaded file off to song/video via usePendingMedia (consumed below).
  if (appMode === 'download') {
    return <DownloadFlow />;
  }

  // Catalog (作品集) — the projects home that gathers each song's artifacts.
  if (appMode === 'catalog') {
    return <CatalogFlow />;
  }

  return (
    <div className="al-tabpage">
      <div className="al-tabpage__head">
        <h1 className="al-tabpage__title">
          {t(isVideo ? 'video.title' : 'transcribe.title')}
        </h1>
        <p className="al-tabpage__lede">
          {t(isVideo ? 'video.lede' : 'transcribe.lede')}
        </p>
      </div>

      <div className="al-transcribe">
        {/* FIRST-RUN: shown only when no Whisper model is installed and backend is online */}
        <SetupBanner />

        {/* 01 SOURCE */}
        <section className="al-section">
          <Eyebrow num={1}>{t('transcribe.section.source')}</Eyebrow>
          <Dropzone
            file={file}
            durationSec={durationSec}
            onFile={onFile}
            onClear={clearFile}
            mode={appMode}
          />

          {/* Video mode: a quiet "runs on any laptop (no GPU needed)" note in
              the empty state — the CPU path is a first-class promise here. */}
          {isVideo && !file && (
            <div className="al-nogpu" role="note">
              <span className="al-nogpu__icon" aria-hidden="true">
                <Laptop size={16} strokeWidth={1.6} />
              </span>
              <div className="al-nogpu__body">
                <div className="al-nogpu__title">{t('video.noGpu.title')}</div>
                <p className="al-nogpu__text">{t('video.noGpu.body')}</p>
              </div>
            </div>
          )}
        </section>

        {/* 02 MODE — lyric-recognition modes are song-only. */}
        {!isVideo && (
          <section className="al-section">
            <Eyebrow num={2}>{t('transcribe.section.mode')}</Eyebrow>
            <ModeCards
              value={mode}
              onChange={setMode}
              alignerEnabled={meta.aligner}
              readiness={readiness}
            />
          </section>
        )}

        {/* 03 REFERENCE — progressive disclosure (biasing / align only). */}
        {!isVideo && showReference && (
          <section className="al-section al-section--reveal">
            <Eyebrow num={3}>{t('transcribe.section.reference')}</Eyebrow>
            {mode === 'align' ? (
              <>
                <ReferenceEditor value={referenceLyrics} onChange={setReferenceLyrics} mode="align" />
                <AlignPrecision
                  refine={refine}
                  onRefineChange={setRefine}
                  demucsModel={demucsModel}
                  onDemucsModelChange={setDemucsModel}
                  separateEnabled={separate}
                  demucsAvailable={meta.demucs}
                />
              </>
            ) : (
              <>
                <ReferenceEditor
                  value={referenceLyrics}
                  onChange={setReferenceLyrics}
                  mode="biasing"
                />
                <StyleChips
                  styles={meta.styles}
                  selected={styleKeys}
                  onToggle={toggleStyle}
                  contentHint={referenceContent}
                  onContentHint={setReferenceContent}
                />
              </>
            )}
          </section>
        )}

        {/* 04 LANGUAGE + engine knobs */}
        <section className="al-section">
          <Eyebrow num={isVideo ? 2 : 4}>{t('transcribe.section.language')}</Eyebrow>
          <LanguageSelect languages={meta.languages} value={language} onChange={setLanguage} />

          <div className="al-knobs">
            <SelectField
              label={t('transcribe.knobs.modelLabel')}
              value={modelSize}
              onChange={(e) => setModelSize(e.target.value as ModelSize)}
              hint={(() => {
                const info = whisperInstallMap[modelSize];
                if (!info) return t('transcribe.knobs.modelHintDefault');
                if (info.installed) return t('transcribe.knobs.modelHintInstalled');
                return t('transcribe.knobs.modelHintDownload', {
                  size: (info.sizeMB / 1024).toFixed(1),
                });
              })()}
            >
              {meta.modelSizes.map((m) => {
                const info = whisperInstallMap[m];
                const dot = info?.installed ? ' ●' : '';
                return (
                  <option key={m} value={m}>
                    {m}{dot}
                  </option>
                );
              })}
            </SelectField>
            <SelectField
              label={t('transcribe.knobs.deviceLabel')}
              value={device}
              onChange={(e) => setDevice(e.target.value as Device)}
              hint={meta.gpu ? t('transcribe.knobs.deviceHintGpu') : t('transcribe.knobs.deviceHintNoGpu')}
            >
              <option value="auto">{t('transcribe.knobs.deviceAuto')} · Auto</option>
              <option value="cuda" disabled={!meta.gpu}>
                {t('transcribe.knobs.deviceGpu')} · CUDA
              </option>
              <option value="cpu">{t('transcribe.knobs.deviceCpu')}</option>
            </SelectField>
          </div>

          {/* Vocal separation (lyric/karaoke, hidden in video) + precision
              decoding (both modes). */}
          <div className="al-chips">
            {!isVideo && (
              <Pill
                active={separate && meta.demucs}
                onClick={() => meta.demucs && setSeparate((v) => !v)}
                disabled={!meta.demucs}
                icon={<Scissors size={12} strokeWidth={2} />}
                title={
                  meta.demucs
                    ? t('transcribe.separate.titleEnabled')
                    : t('transcribe.separate.titleDisabled')
                }
              >
                {t('transcribe.separate.label')}
              </Pill>
            )}
            <Pill
              active={precision}
              onClick={togglePrecision}
              icon={<Target size={12} strokeWidth={2} />}
              title={t('transcribe.precision.title')}
            >
              {t('transcribe.precision.label')}
            </Pill>
          </div>
        </section>

        {/* VIDEO PREVIEW — shown once a file is loaded in subtitle mode; the
            SubtitleOverlay paints the active caption and the CueList lists
            every cue (click-to-seek) after the job completes. */}
        {isVideo && file && (
          <section className="al-section">
            <Eyebrow num={3}>{t('video.section.preview')}</Eyebrow>
            <VideoPreview file={file} />
            {status === 'done' && result && <CueList result={result} />}
            {status === 'done' && result && result.segments.length > 0 && meta.caption !== false && (
              <CaptionBurn file={file} result={result} templates={meta.captionTemplates} />
            )}
          </section>
        )}

        {/* RUN */}
        <section className="al-section">
          <div className="al-runbar">
            <Button
              variant="primary"
              size="lg"
              icon={running ? <Sparkles size={18} /> : <Play size={18} />}
              disabled={!canRun}
              onClick={run}
              title="⌘↵ / Ctrl+↵"
            >
              {running
                ? t('transcribe.run.running')
                : t(isVideo ? 'video.run.start' : 'transcribe.run.start')}
            </Button>

            {finished && !running && (
              <Button
                variant="ghost"
                size="lg"
                icon={<RotateCcw size={15} />}
                onClick={handleReset}
                title={t('transcribe.run.resetTitle')}
              >
                {t('transcribe.run.reset')}
              </Button>
            )}

            <span className="al-runbar__spacer" />
            {!file ? (
              <span className="al-runbar__note">
                {t(isVideo ? 'video.run.dropFirst' : 'transcribe.run.dropFirst')}
              </span>
            ) : (
              <kbd className="al-kbd">⌘↵</kbd>
            )}
          </div>

          {showProgress && (
            <StageProgress
              status={status}
              stage={stage}
              pct={pct}
              message={message}
              error={jobError}
              elapsedSec={elapsed}
              onOpenEditor={handleOpenEditor}
            />
          )}
        </section>
      </div>
    </div>
  );
}
