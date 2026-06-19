/* ──────────────────────────────────────────────────────────────────
   SubtitleEditor — the Editor-tab surface for VIDEO mode.

   A "video-editor look" for fixing subtitle text + timing:

     ┌──────────────────────────────────────────┐
     │  <video> preview + live caption overlay   │   ← top
     │  ────────────────────────────────────────│
     │  ▸ ──────────●──────────  00:12 / 03:40   │   ← mini transport
     └──────────────────────────────────────────┘
     ┌──────────────────────────────────────────┐
     │ Subtitle cues · 24 cues                   │
     │ [00:01.200 ±] text…           [00:03.4 ±] │   ← editable cue list
     │ [00:03.420 ±] text… (ACTIVE, gold)        │
     └──────────────────────────────────────────┘

   The video and the cue highlight both follow the shared useAudio clock
   (the same transport the song flow uses), so edits land in the working
   copy (useResultStore) and flow straight to Export (SRT / WebVTT).

   Source resolution (reuse, don't rebuild):
     • useJob.audioObjectUrl — the object URL the Transcribe flow already
       created for the submitted file (single source of truth post-run).
     • useJob.audioFile.type — "video/*" → show <video>; "audio/*" / none →
       a graceful audio-only fallback card (still fully editable below).
   ────────────────────────────────────────────────────────────────── */

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Captions, Pause, Play, Sparkles, Film, AudioLines } from 'lucide-react';
import './subtitle-editor.css';
import { Badge, IconButton } from '../../components/primitives';
import { SubtitleOverlay } from '../transcribe/SubtitleOverlay';
import { useAudio } from '../../state/useAudio';
import { useJob } from '../../state/useJob';
import { useResultStore } from '../../state/useResultStore';
import { DEMO_RESULT } from './demoResult';
import { formatTimecode, formatClock, nudge } from '../../lib/timecode';
import { useT } from '../../i18n';
import type { Segment } from '../../api/types';

/** One full ±0.1 s nudge step (10× the word-level 10 ms grain). */
const CUE_STEP = 0.1;

const DRIFT_TOLERANCE = 0.3; // s before the preview hard-resyncs to the clock

export function SubtitleEditor() {
  const t = useT();

  const result = useResultStore((s) => s.result);
  const dirty = useResultStore((s) => s.dirty);
  const load = useResultStore((s) => s.load);
  const editSegmentText = useResultStore((s) => s.editSegmentText);
  const setSegmentStart = useResultStore((s) => s.setSegmentStart);
  const setSegmentEnd = useResultStore((s) => s.setSegmentEnd);

  const audio = useAudio();
  const audioObjectUrl = useJob((s) => s.audioObjectUrl);
  const audioFile = useJob((s) => s.audioFile);

  // Offline / no-run fallback: seed a demo document once so the surface is
  // fully designable with the backend down (mirrors the lyric EditorTab).
  const seededDemo = useRef(false);
  useEffect(() => {
    if (!result && !seededDemo.current) {
      seededDemo.current = true;
      load(DEMO_RESULT);
    }
  }, [result, load]);

  // Point the shared transport at the submitted source.
  useEffect(() => {
    if (audioObjectUrl) audio.setSrc(audioObjectUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioObjectUrl]);

  const isVideoSource = !!audioObjectUrl && (audioFile?.type ?? '').startsWith('video');
  const showingDemo = !audioFile && !useJob.getState().result;

  if (!result) {
    return (
      <div className="al-subedit">
        <div className="al-subedit__empty">
          <Captions size={30} strokeWidth={1.25} />
          <div className="al-subedit__empty-title">{t('video.editor.empty.title')}</div>
          <div>{t('video.editor.empty.body')}</div>
        </div>
      </div>
    );
  }

  const cues = result.segments;

  return (
    <div className="al-subedit">
      {/* ── Top bar ── */}
      <div className="al-subedit__bar">
        <div className="al-subedit__bar-group">
          <Badge tone="gold">
            <Captions size={11} style={{ marginRight: 4, verticalAlign: '-1px' }} />
            {t('video.editor.title')}
          </Badge>
          <Badge>{result.language}</Badge>
          {dirty && (
            <Badge tone="amber" dot>
              {t('video.editor.badge.edited')}
            </Badge>
          )}
          {showingDemo && !dirty && (
            <Badge tone="neutral">
              <Sparkles size={11} style={{ marginRight: 4, verticalAlign: '-1px' }} />
              {t('video.editor.badge.demo')}
            </Badge>
          )}
        </div>
        <span className="al-subedit__hint">{t('video.editor.hint')}</span>
      </div>

      {/* ── Preview + mini transport ── */}
      <Preview
        url={isVideoSource ? audioObjectUrl : null}
        hasSource={!!audioObjectUrl || showingDemo}
      />

      {/* ── Editable cue list ── */}
      <CueEditorList
        cues={cues}
        currentTime={audio.currentTime}
        onSeek={audio.seek}
        onText={editSegmentText}
        onStart={setSegmentStart}
        onEnd={setSegmentEnd}
      />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Preview — framed <video> (or audio-only fallback) + mini transport
   ══════════════════════════════════════════════════════════════════ */
interface PreviewProps {
  url: string | null;
  hasSource: boolean;
}

function Preview({ url, hasSource }: PreviewProps) {
  const t = useT();
  const ref = useRef<HTMLVideoElement>(null);
  const result = useResultStore((s) => s.result);
  const currentTime = useAudio((s) => s.currentTime);
  const playing = useAudio((s) => s.playing);
  const duration = useAudio((s) => s.duration);
  const seek = useAudio((s) => s.seek);
  const toggle = useAudio((s) => s.toggle);

  const dur = duration || result?.meta.durationSec || 0;

  // Follow the shared clock; resync the preview only on real drift.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (Math.abs(v.currentTime - currentTime) > DRIFT_TOLERANCE) {
      v.currentTime = currentTime;
    }
  }, [currentTime]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (playing && v.paused) void v.play?.().catch(() => {});
    else if (!playing && !v.paused) v.pause?.();
  }, [playing]);

  return (
    <div className="al-subedit__stage">
      <div className="al-subedit__frame" aria-label={t('video.preview.ariaLabel')}>
        {url ? (
          <video
            ref={ref}
            className="al-subedit__video"
            src={url}
            muted
            playsInline
            onClick={() => toggle()}
          />
        ) : (
          <div className="al-subedit__noVideo">
            {hasSource ? (
              <>
                <AudioLines size={26} strokeWidth={1.4} />
                <div className="al-subedit__noVideo-title">
                  {t('video.editor.preview.audioOnly.title')}
                </div>
                <div className="al-subedit__noVideo-body">
                  {t('video.editor.preview.audioOnly.body')}
                </div>
              </>
            ) : (
              <>
                <Film size={26} strokeWidth={1.4} />
                <div className="al-subedit__noVideo-title">
                  {t('video.editor.preview.none.title')}
                </div>
                <div className="al-subedit__noVideo-body">
                  {t('video.editor.preview.none.body')}
                </div>
              </>
            )}
          </div>
        )}
        {result && <SubtitleOverlay result={result} currentTime={currentTime} />}
      </div>

      {/* mini transport: play/pause + scrub + clock */}
      <div className="al-subedit__transport">
        <IconButton
          label={playing ? t('video.editor.transport.pause') : t('video.editor.transport.play')}
          icon={playing ? <Pause size={16} /> : <Play size={16} />}
          onClick={() => toggle()}
        />
        <input
          className="al-subedit__seek"
          type="range"
          min={0}
          max={Math.max(dur, 0.001)}
          step={0.01}
          value={Math.min(currentTime, dur || currentTime)}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label={t('video.editor.transport.seek')}
        />
        <span className="al-subedit__clock">
          {formatClock(currentTime)}
          <span className="al-subedit__clock-sep">/</span>
          {formatClock(dur)}
        </span>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   CueEditorList — editable cue rows; active cue gold + auto-scrolled
   ══════════════════════════════════════════════════════════════════ */
interface CueEditorListProps {
  cues: Segment[];
  currentTime: number;
  onSeek: (sec: number) => void;
  onText: (segId: number, text: string) => void;
  onStart: (segId: number, sec: number) => void;
  onEnd: (segId: number, sec: number) => void;
}

function CueEditorList({ cues, currentTime, onSeek, onText, onStart, onEnd }: CueEditorListProps) {
  const t = useT();

  const activeId = useMemo(() => {
    const hit = cues.find((s) => currentTime >= s.start && currentTime < s.end);
    return hit?.id ?? null;
  }, [cues, currentTime]);

  // Auto-scroll the active cue into view as the playhead advances.
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);
  const lastScrolled = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (activeId == null || activeId === lastScrolled.current) return;
    lastScrolled.current = activeId;
    const node = activeRef.current;
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [activeId]);

  return (
    <div className="al-subedit__cues">
      <div className="al-subedit__cues-head">
        <span className="al-subedit__cues-title">
          <Captions size={13} strokeWidth={1.6} /> {t('video.editor.cues.title')}
        </span>
        <span className="al-subedit__cues-count">
          {t('video.editor.cues.count', { count: cues.length })}
        </span>
      </div>

      <div className="al-subedit__cues-scroll" ref={listRef}>
        <ul className="al-subedit__cues-rows" aria-label={t('video.editor.cues.ariaLabel')}>
          {cues.map((seg) => {
            const active = seg.id === activeId;
            return (
              <li key={seg.id} ref={active ? activeRef : undefined}>
                <CueRow
                  seg={seg}
                  active={active}
                  onSeek={onSeek}
                  onText={onText}
                  onStart={onStart}
                  onEnd={onEnd}
                />
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/* ── A single editable cue row ─────────────────────────────────────── */
interface CueRowProps {
  seg: Segment;
  active: boolean;
  onSeek: (sec: number) => void;
  onText: (segId: number, text: string) => void;
  onStart: (segId: number, sec: number) => void;
  onEnd: (segId: number, sec: number) => void;
}

function CueRow({ seg, active, onSeek, onText, onStart, onEnd }: CueRowProps) {
  const t = useT();

  return (
    <div className={`al-cuerow${active ? ' al-cuerow--active' : ''}`}>
      {/* click-to-seek index marker */}
      <button
        type="button"
        className="al-cuerow__seek"
        onClick={() => onSeek(seg.start)}
        title={t('video.editor.cue.seekTitle')}
        aria-label={t('video.editor.cue.seekTitle')}
      >
        <span className="al-cuerow__dot" />
      </button>

      <div className="al-cuerow__body">
        {/* editable cue text */}
        <textarea
          className="al-cuerow__text"
          value={seg.text}
          rows={1}
          placeholder={t('video.editor.cue.textPlaceholder')}
          aria-label={t('video.editor.cue.textAriaLabel')}
          onChange={(e) => onText(seg.id, e.target.value)}
          onFocus={() => onSeek(seg.start)}
        />

        {/* in / out timing with ±0.1s nudges */}
        <div className="al-cuerow__times">
          <TimeField
            label={t('video.editor.cue.startLabel')}
            value={seg.start}
            minusLabel={t('video.editor.cue.startMinus')}
            plusLabel={t('video.editor.cue.startPlus')}
            onMinus={() => onStart(seg.id, nudge(seg.start, -1, CUE_STEP))}
            onPlus={() => onStart(seg.id, nudge(seg.start, 1, CUE_STEP))}
          />
          <span className="al-cuerow__arrow">→</span>
          <TimeField
            label={t('video.editor.cue.endLabel')}
            value={seg.end}
            minusLabel={t('video.editor.cue.endMinus')}
            plusLabel={t('video.editor.cue.endPlus')}
            onMinus={() => onEnd(seg.id, nudge(seg.end, -1, CUE_STEP))}
            onPlus={() => onEnd(seg.id, nudge(seg.end, 1, CUE_STEP))}
          />
        </div>
      </div>
    </div>
  );
}

/* ── A labelled mm:ss.mmm readout with ± nudge buttons ─────────────── */
interface TimeFieldProps {
  label: string;
  value: number;
  minusLabel: string;
  plusLabel: string;
  onMinus: () => void;
  onPlus: () => void;
}

function TimeField({ label, value, minusLabel, plusLabel, onMinus, onPlus }: TimeFieldProps) {
  return (
    <span className="al-timefield">
      <span className="al-timefield__label">{label}</span>
      <button
        type="button"
        className="al-timefield__nudge"
        onClick={onMinus}
        title={minusLabel}
        aria-label={minusLabel}
      >
        −
      </button>
      <span className="al-timefield__val">{formatTimecode(value)}</span>
      <button
        type="button"
        className="al-timefield__nudge"
        onClick={onPlus}
        title={plusLabel}
        aria-label={plusLabel}
      >
        +
      </button>
    </span>
  );
}
