import { useCallback, useEffect, useMemo, useState } from 'react';
import { Play, RotateCcw, Scissors, Sparkles } from 'lucide-react';
import './transcribe.css';
import { Button, Eyebrow, Pill, SelectField } from '../../components/primitives';
import { Dropzone } from './Dropzone';
import { ModeCards } from './ModeCards';
import { ReferenceEditor } from './ReferenceEditor';
import { StyleChips } from './StyleChips';
import { LanguageSelect } from './LanguageSelect';
import { StageProgress } from './StageProgress';
import { SetupBanner } from './SetupBanner';
import { useMeta } from '../../state/useMeta';
import { useJob } from '../../state/useJob';
import { useResultStore } from '../../state/useResultStore';
import { useModels } from '../../state/useModels';
import type { Device, JobMode, JobParams, ModelSize } from '../../api/types';

export interface TranscribeTabProps {
  /** Navigate to the editor after a finished run. */
  onOpenEditor: () => void;
}

export function TranscribeTab({ onOpenEditor }: TranscribeTabProps) {
  const meta = useMeta((s) => s.meta);

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

  // ── local setup form ──
  const [file, setFile] = useState<File | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [mode, setMode] = useState<JobMode>('auto');
  const [referenceLyrics, setReferenceLyrics] = useState('');
  const [referenceContent, setReferenceContent] = useState('');
  const [styleKeys, setStyleKeys] = useState<string[]>([]);
  const [language, setLanguage] = useState<string | null>(null);
  const [modelSize, setModelSize] = useState<ModelSize>(meta.modelSizes[0] ?? 'large-v3');
  const [device, setDevice] = useState<Device>('auto');
  const [separate, setSeparate] = useState(meta.demucs);

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

  const onFile = useCallback((f: File) => {
    setFile(f);
    setDurationSec(0);
    // probe duration locally without holding a player
    const url = URL.createObjectURL(f);
    const a = new Audio();
    a.preload = 'metadata';
    a.src = url;
    a.addEventListener('loadedmetadata', () => {
      setDurationSec(Number.isFinite(a.duration) ? a.duration : 0);
      URL.revokeObjectURL(url);
    });
    a.addEventListener('error', () => URL.revokeObjectURL(url));
  }, []);

  const clearFile = () => {
    setFile(null);
    setDurationSec(0);
  };

  const toggleStyle = (key: string) =>
    setStyleKeys((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));

  // readiness meters: make "why Forced-Align beats Auto" legible to a newcomer.
  const readiness = useMemo<Record<JobMode, number>>(() => {
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

  const canRun = !!file && !running;

  const run = useCallback(() => {
    if (!file || running) return;
    const params: JobParams = {
      mode,
      referenceLyrics: showReference ? referenceLyrics : '',
      referenceContent: mode === 'biasing' ? referenceContent : '',
      styleKeys: mode === 'biasing' ? styleKeys : [],
      language,
      modelSize,
      separate: meta.demucs ? separate : false,
      device,
      engine: 'whisper',
    };
    void submit(file, params);
  }, [
    file,
    running,
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

  return (
    <div className="al-tabpage">
      <div className="al-tabpage__head">
        <h1 className="al-tabpage__title">辨識 · Transcribe</h1>
        <p className="al-tabpage__lede">
          載入一首歌，選擇它被讀取的方式，貼上參考，然後執行 — 全在這一欄。
          Load a song, choose how it is read, paste reference, run — all in one column.
        </p>
      </div>

      <div className="al-transcribe">
        {/* FIRST-RUN: shown only when no Whisper model is installed and backend is online */}
        <SetupBanner />

        {/* 01 SOURCE */}
        <section className="al-section">
          <Eyebrow num={1}>Source · 來源</Eyebrow>
          <Dropzone
            file={file}
            durationSec={durationSec}
            onFile={onFile}
            onClear={clearFile}
          />
        </section>

        {/* 02 MODE */}
        <section className="al-section">
          <Eyebrow num={2}>Mode · 模式</Eyebrow>
          <ModeCards
            value={mode}
            onChange={setMode}
            alignerEnabled={meta.aligner}
            readiness={readiness}
          />
        </section>

        {/* 03 REFERENCE — progressive disclosure (biasing / align only) */}
        {showReference && (
          <section className="al-section al-section--reveal">
            <Eyebrow num={3}>Reference · 參考</Eyebrow>
            {mode === 'align' ? (
              <ReferenceEditor value={referenceLyrics} onChange={setReferenceLyrics} mode="align" />
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
          <Eyebrow num={4}>Language · 語言</Eyebrow>
          <LanguageSelect languages={meta.languages} value={language} onChange={setLanguage} />

          <div className="al-knobs">
            <SelectField
              label="模型 Model"
              value={modelSize}
              onChange={(e) => setModelSize(e.target.value as ModelSize)}
              hint={(() => {
                const info = whisperInstallMap[modelSize];
                if (!info) return 'larger = 更準但更慢 more accurate, slower';
                if (info.installed) return '✓ 已安裝 installed';
                return `首次使用會自動下載 (~${(info.sizeMB / 1024).toFixed(1)} GB)`;
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
              label="裝置 Device"
              value={device}
              onChange={(e) => setDevice(e.target.value as Device)}
              hint={meta.gpu ? 'GPU 最快 GPU is fastest' : '此機器未偵測到 GPU No GPU detected'}
            >
              <option value="auto">自動 · Auto</option>
              <option value="cuda" disabled={!meta.gpu}>
                GPU · CUDA
              </option>
              <option value="cpu">CPU</option>
            </SelectField>
          </div>

          <div className="al-chips">
            <Pill
              active={separate && meta.demucs}
              onClick={() => meta.demucs && setSeparate((v) => !v)}
              disabled={!meta.demucs}
              icon={<Scissors size={12} strokeWidth={2} />}
              title={
                meta.demucs
                  ? '先用 Demucs 分離人聲，常讓辨識更乾淨。Separate vocals first with Demucs — often cleaner.'
                  : '此機器未提供 Demucs Demucs unavailable on this machine'
              }
            >
              分離人聲 · Separate vocals (Demucs)
            </Pill>
          </div>
        </section>

        {/* RUN */}
        <section className="al-section">
          <div className="al-runrow">
            <Button
              variant="primary"
              size="lg"
              icon={running ? <Sparkles size={18} /> : <Play size={18} />}
              disabled={!canRun}
              onClick={run}
              title="⌘↵ / Ctrl+↵"
            >
              {running ? '執行中… Running' : '開始辨識 · Run'}
            </Button>

            {finished && !running && (
              <Button
                variant="ghost"
                size="lg"
                icon={<RotateCcw size={15} />}
                onClick={handleReset}
                title="清除這次的進度 Clear this run"
              >
                重設 · Reset
              </Button>
            )}

            <span className="al-runrow__spacer" />
            {!file ? (
              <span className="al-runrow__note">先放一首歌 Drop a song first</span>
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
