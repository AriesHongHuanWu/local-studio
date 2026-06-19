import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, TextCursorInput, Sparkles, Eraser } from 'lucide-react';
import './editor.css';
import { Badge, HairlineRule, Pill, Popover } from '../../components/primitives';
import { LyricDocument } from './LyricDocument';
import { Transport } from './Transport';
import { WordInspector } from './WordInspector';
import { SubtitleEditor } from './SubtitleEditor';
import { DEMO_RESULT } from './demoResult';
import { useAudio } from '../../state/useAudio';
import { useJob } from '../../state/useJob';
import { useMode } from '../../state/useMode';
import { useResultStore } from '../../state/useResultStore';
import { decodePeaks } from '../../lib/waveform';
import type { PeakData } from '../../lib/waveform';
import { detectOnsets } from '../../lib/onset';
import type { Onset } from '../../lib/onset';
import { nudge } from '../../lib/timecode';
import { useT } from '../../i18n';

/** Popover dimensions used to flip/clamp anchoring near the viewport edge. */
const POP_W = 360;
const POP_GAP = 14;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

/* ──────────────────────────────────────────────────────────────────
   EditorTab — mode-aware Editor surface.

   • song  → the lyric document below (unchanged).
   • video → a video-editor-style subtitle editor (preview + cue list).
   • clean → friendly fallback note (Agent A normally HIDES this tab in
             clean mode; this only shows if it's ever routed here).
   ────────────────────────────────────────────────────────────────── */
export function EditorTab() {
  const mode = useMode((s) => s.mode);

  if (mode === 'video') return <SubtitleEditor />;
  if (mode === 'clean') return <CleanEditorNote />;
  return <LyricEditor />;
}

/** Clean-mode fallback (the focused clean flow lives in the Transcribe tab). */
function CleanEditorNote() {
  const t = useT();
  return (
    <div className="al-subedit">
      <div className="al-subedit__clean">
        <Eraser size={30} strokeWidth={1.25} />
        <div className="al-subedit__clean-title">{t('video.editor.clean.title')}</div>
        <div className="al-subedit__clean-body">{t('video.editor.clean.body')}</div>
      </div>
    </div>
  );
}

/** The original lyric document editor — unchanged behaviour for song mode. */
function LyricEditor() {
  const t = useT();
  const result = useResultStore((s) => s.result);
  const dirty = useResultStore((s) => s.dirty);
  const selected = useResultStore((s) => s.selected);
  const select = useResultStore((s) => s.select);
  const load = useResultStore((s) => s.load);
  const editWordText = useResultStore((s) => s.editWordText);
  const setWordStart = useResultStore((s) => s.setWordStart);
  const setWordEnd = useResultStore((s) => s.setWordEnd);
  const confirmWord = useResultStore((s) => s.confirmWord);

  const audio = useAudio();
  const audioObjectUrl = useJob((s) => s.audioObjectUrl);
  const audioFile = useJob((s) => s.audioFile);

  const reduced = usePrefersReducedMotion();
  const [flat, setFlat] = useState(false);
  const [peaks, setPeaks] = useState<PeakData | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  // Offline / no-run fallback: hydrate the store with a demo document so the
  // hero surface is fully designable with the backend down. Never clobbers a
  // real result — only seeds once when the store is genuinely empty.
  const seededDemo = useRef(false);
  useEffect(() => {
    if (!result && !seededDemo.current) {
      seededDemo.current = true;
      load(DEMO_RESULT);
    }
  }, [result, load]);

  // point the audio element at the loaded source
  useEffect(() => {
    if (audioObjectUrl) audio.setSrc(audioObjectUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioObjectUrl]);

  // decode + decimate waveform peaks once per file
  useEffect(() => {
    let cancelled = false;
    if (!audioFile) {
      setPeaks(null);
      return;
    }
    void decodePeaks(audioFile, 2400)
      .then((p) => {
        if (!cancelled) setPeaks(p);
      })
      .catch(() => {
        if (!cancelled) setPeaks(null);
      });
    return () => {
      cancelled = true;
    };
  }, [audioFile]);

  // onsets for magnetize-on-drag retiming (recomputed only when peaks change)
  const onsets: Onset[] = useMemo(() => (peaks ? detectOnsets(peaks) : []), [peaks]);

  const selectedWord = useMemo(() => {
    if (!result || !selected) return null;
    const seg = result.segments.find((s) => s.id === selected.segId);
    return seg?.words[selected.wordIndex] ?? null;
  }, [result, selected]);

  const onSelectWord = useCallback(
    (ref: { segId: number; wordIndex: number }, rect: DOMRect) => {
      setAnchor(rect);
      select(ref);
    },
    [select],
  );

  // ── Global keyboard: play/pause, ±5 s, nudge selected word ±10 ms ──────
  const audioRef = useRef(audio);
  audioRef.current = audio;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      const a = audioRef.current;

      // Space / K → play-pause (not while typing in a field)
      if ((e.key === ' ' || e.key.toLowerCase() === 'k') && !typing) {
        e.preventDefault();
        a.toggle();
        return;
      }

      // Modifier + arrows → nudge the selected word's boundary ±10 ms.
      const sel = useResultStore.getState().selected;
      const res = useResultStore.getState().result;
      if ((e.altKey || e.metaKey) && sel && res && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const seg = res.segments.find((s) => s.id === sel.segId);
        const w = seg?.words[sel.wordIndex];
        if (w) {
          e.preventDefault();
          const steps = e.key === 'ArrowUp' ? 1 : -1;
          // Shift targets the END boundary; default targets START.
          if (e.shiftKey) setWordEnd(sel, nudge(w.end, steps));
          else setWordStart(sel, nudge(w.start, steps));
        }
        return;
      }

      // Plain ←/→ → transport ±5 s (only when not typing + no word focus edit)
      if (!typing && !e.altKey && !e.metaKey) {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          a.skip(5);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          a.skip(-5);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setWordStart, setWordEnd]);

  if (!result) {
    // Transient frame before the demo seeds (keeps chrome, never blanks).
    return (
      <div className="al-editor">
        <div className="al-empty">
          <TextCursorInput size={30} strokeWidth={1.25} />
          <div className="al-empty__title">{t('editor.emptyTitle')}</div>
          <div>{t('editor.emptyBody')}</div>
        </div>
      </div>
    );
  }

  // Demo when there's no real submitted audio behind this result.
  const showingDemo = !audioFile && !useJob.getState().result;

  // Anchor the inspector above-or-below the word, clamped to the viewport.
  const popStyle = (() => {
    if (!anchor) return { right: 'var(--al-space-5)', bottom: 120 } as const;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchor.left + anchor.width / 2 - POP_W / 2;
    left = Math.max(POP_GAP, Math.min(left, vw - POP_W - POP_GAP));
    const below = anchor.bottom + POP_GAP;
    const wantAbove = below > vh - 280;
    return wantAbove
      ? ({ left, bottom: vh - anchor.top + POP_GAP } as const)
      : ({ left, top: below } as const);
  })();

  return (
    <div className="al-editor">
      <div className="al-editor__bar">
        <div className="al-editor__bar-group">
          <Badge tone="gold">{result.modeUsed}</Badge>
          <Badge>{result.language}</Badge>
          <Badge>{result.meta.modelSize}</Badge>
          {result.meta.separated && <Badge tone="green">{t('editor.badge.separated')}</Badge>}
          {dirty && (
            <Badge tone="amber" dot>
              {t('editor.badge.edited')}
            </Badge>
          )}
          {showingDemo && !dirty && (
            <Badge tone="neutral">
              <Sparkles size={11} style={{ marginRight: 4, verticalAlign: '-1px' }} />
              {t('editor.badge.demo')}
            </Badge>
          )}
        </div>
        <div className="al-editor__bar-group">
          <span className="al-editor__hint">{t('editor.hint.keys')}</span>
          <Pill
            active={flat}
            icon={flat ? <EyeOff size={14} /> : <Eye size={14} />}
            onClick={() => setFlat((v) => !v)}
            title={t('editor.flatReadTitle')}
          >
            {t('editor.flatRead')}
          </Pill>
        </div>
      </div>

      <LyricDocument
        result={result}
        currentTime={audio.currentTime}
        flat={flat}
        selected={selected}
        reduced={reduced}
        onSeek={(t) => audio.seek(t)}
        onSelectWord={onSelectWord}
      />

      <HairlineRule />

      <Transport
        playing={audio.playing}
        currentTime={audio.currentTime}
        duration={audio.duration || result.meta.durationSec}
        peaks={peaks}
        onToggle={audio.toggle}
        onSkip={audio.skip}
        onSeek={audio.seek}
      />

      <Popover
        open={!!selectedWord && !!selected}
        onClose={() => {
          select(null);
          setAnchor(null);
        }}
        style={popStyle}
        label={
          selectedWord
            ? t('editor.inspector.popoverLabel', { word: selectedWord.word })
            : t('editor.inspector.popoverLabelEmpty')
        }
      >
        {selectedWord && selected && (
          <WordInspector
            word={selectedWord}
            wordRef={selected}
            onText={editWordText}
            onStart={setWordStart}
            onEnd={setWordEnd}
            onConfirm={confirmWord}
            peaks={peaks}
            onsets={onsets}
            currentTime={audio.currentTime}
          />
        )}
      </Popover>
    </div>
  );
}
