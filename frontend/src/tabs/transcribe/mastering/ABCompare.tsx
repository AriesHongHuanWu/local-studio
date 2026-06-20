/* ──────────────────────────────────────────────────────────────────
   ABCompare — honest, loudness-matched A/B (and optional 3-way A/B/C).

   A = this app's master, B = original, C = an EXTERNAL master (uploaded,
   loudness-matched on the backend) for an original-vs-ours-vs-theirs
   shoot-out. All sources play in sync; exactly one is audible via .muted.

   NO Web Audio: createMediaElementSource reroutes the element's output
   into a (suspended) AudioContext and silences playback — the bug we are
   not repeating. Audibility is pure .muted, so output always reaches the
   system mixer like any <audio>.
   ────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Disc3, Play, Pause } from 'lucide-react';
import { useT } from '../../../i18n';

interface Props {
  masteredUrl: string;       // A
  matchedUrl: string;        // B when loudness-matched ON
  rawUrl: string;            // B when loudness-matched OFF
  hasMatched: boolean;
  externalUrl?: string | null; // C (already loudness-matched), optional
}

type Side = 'A' | 'B' | 'C';
const SYNC_TOL = 0.04; // 40 ms — below A/B perceptual fusion; avoids re-seek stutter

function fmt(t: number): string {
  if (!Number.isFinite(t)) return '0:00';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ABCompare({ masteredUrl, matchedUrl, rawUrl, hasMatched, externalUrl }: Props) {
  const t = useT();
  const aRef = useRef<HTMLAudioElement>(null); // mastered (clock)
  const bRef = useRef<HTMLAudioElement>(null); // original
  const cRef = useRef<HTMLAudioElement>(null); // external

  const [side, setSide] = useState<Side>('A');
  const [matched, setMatched] = useState(hasMatched);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);

  const bSrc = matched && hasMatched ? matchedUrl : rawUrl;
  const hasC = !!externalUrl;

  const followers = useCallback(() => [bRef.current, cRef.current].filter(Boolean) as HTMLAudioElement[], []);

  // Audibility: exactly one element unmuted. Re-assert after any src swap.
  useEffect(() => {
    if (aRef.current) aRef.current.muted = side !== 'A';
    if (bRef.current) bRef.current.muted = side !== 'B';
    if (cRef.current) cRef.current.muted = side !== 'C';
  }, [side, bSrc, externalUrl]);

  // If C disappears (cleared) while selected, fall back to A.
  useEffect(() => {
    if (!hasC && side === 'C') setSide('A');
  }, [hasC, side]);

  // A drives the clock; nudge followers only on drift > tol.
  const onATime = useCallback(() => {
    const a = aRef.current;
    if (!a) return;
    setTime(a.currentTime);
    for (const f of followers()) {
      if (Math.abs(f.currentTime - a.currentTime) > SYNC_TOL) f.currentTime = a.currentTime;
    }
  }, [followers]);

  const play = useCallback(async () => {
    const a = aRef.current;
    if (!a) return;
    for (const f of followers()) {
      if (Math.abs(f.currentTime - a.currentTime) > SYNC_TOL) f.currentTime = a.currentTime;
    }
    await Promise.allSettled([a.play(), ...followers().map((f) => f.play())]);
    setPlaying(true);
  }, [followers]);

  const pause = useCallback(() => {
    aRef.current?.pause();
    followers().forEach((f) => f.pause());
    setPlaying(false);
  }, [followers]);

  const seek = useCallback((tt: number) => {
    if (aRef.current) aRef.current.currentTime = tt;
    followers().forEach((f) => { f.currentTime = tt; });
    setTime(tt);
  }, [followers]);

  // When a follower's source (re)loads, realign + restore mute + resume.
  const onFollowerLoaded = useCallback((el: HTMLAudioElement | null, isSide: Side) => {
    const a = aRef.current;
    if (!a || !el) return;
    el.currentTime = a.currentTime;
    el.muted = side !== isSide;
    if (playing) void el.play();
  }, [side, playing]);

  return (
    <div
      className="al-ab"
      tabIndex={0}
      role="group"
      aria-label={t('master.ab.label')}
      onKeyDown={(e) => {
        if (e.key === ' ') { e.preventDefault(); void (playing ? pause() : play()); }
        else if (e.key === 'a' || e.key === 'A') setSide('A');
        else if (e.key === 'b' || e.key === 'B') setSide('B');
        else if ((e.key === 'c' || e.key === 'C') && hasC) setSide('C');
      }}
    >
      {/* eslint-disable jsx-a11y/media-has-caption */}
      <audio
        ref={aRef}
        src={masteredUrl}
        onTimeUpdate={onATime}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
        onEnded={() => setPlaying(false)}
        preload="auto"
      />
      <audio ref={bRef} src={bSrc} onLoadedMetadata={() => onFollowerLoaded(bRef.current, 'B')} preload="auto" />
      {hasC && (
        <audio ref={cRef} src={externalUrl!} onLoadedMetadata={() => onFollowerLoaded(cRef.current, 'C')} preload="auto" />
      )}
      {/* eslint-enable jsx-a11y/media-has-caption */}

      <div className="al-ab__transport">
        <button type="button" className="al-ab__play" onClick={() => void (playing ? pause() : play())}
                aria-label={playing ? t('master.ab.pause') : t('master.ab.play')}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <span className="al-ab__time">{fmt(time)}</span>
        <input
          type="range" className="al-ab__seek" min={0} max={dur || 0} step={0.01} value={Math.min(time, dur || 0)}
          onChange={(e) => seek(Number(e.target.value))} aria-label={t('master.ab.seek')}
        />
        <span className="al-ab__time">{fmt(dur)}</span>
      </div>

      <div className="al-ab__row">
        <div className="al-ab__switch" role="group" aria-label={t('master.ab.label')}>
          <button type="button" className={`al-ab__btn${side === 'A' ? ' al-ab__btn--on' : ''}`}
                  aria-pressed={side === 'A'} onClick={() => setSide('A')}>
            <Disc3 size={13} /> {t('master.ab.mastered')}
          </button>
          <button type="button" className={`al-ab__btn${side === 'B' ? ' al-ab__btn--on' : ''}`}
                  aria-pressed={side === 'B'} onClick={() => setSide('B')}>
            {t('master.ab.original')}
          </button>
          {hasC && (
            <button type="button" className={`al-ab__btn${side === 'C' ? ' al-ab__btn--on' : ''}`}
                    aria-pressed={side === 'C'} onClick={() => setSide('C')}>
              {t('master.ab.external')}
            </button>
          )}
        </div>
        {hasMatched && (
          <label className="al-ab__lmatch">
            <input type="checkbox" checked={matched} onChange={(e) => setMatched(e.target.checked)} />
            <span>{t('master.ab.loudnessMatch')}</span>
            <span className="al-ab__lmatchstate">{matched ? t('master.ab.lmatchOn') : t('master.ab.lmatchOff')}</span>
          </label>
        )}
      </div>
      <p className="al-ab__why">{hasC ? t('master.ab.why3') : t('master.ab.why')}</p>
    </div>
  );
}
