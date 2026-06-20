/* ──────────────────────────────────────────────────────────────────
   useAudioAnalyser — shared WebAudio core for the live mastering viz.

   The rules that everyone gets wrong, centralized here:
   - ONE AudioContext for the whole app (module singleton).
   - A MediaElementSource may be created EXACTLY ONCE per <audio> element
     (createMediaElementSource throws on a second call) → cache via WeakMap.
   - The source MUST stay connected to ctx.destination or the element goes
     silent. Analysers are non-destructive taps: source → analyser, and
     source → splitter → L/R analysers, in parallel with → destination.
   - ctx.resume() only inside a user gesture → resume on the element's
     'play' event (the play button is the gesture).

   Returns a ref-stable getHandle() so the rAF loop never re-subscribes.
   ────────────────────────────────────────────────────────────────── */

import { useEffect, useRef } from 'react';

let _ctx: AudioContext | null = null;
function audioCtx(): AudioContext {
  if (!_ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    _ctx = new Ctor();
  }
  return _ctx;
}

const _sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
function sourceFor(el: HTMLMediaElement): MediaElementAudioSourceNode {
  let src = _sources.get(el);
  if (!src) {
    src = audioCtx().createMediaElementSource(el);
    src.connect(audioCtx().destination); // keep normal playback alive
    _sources.set(el, src);
  }
  return src;
}

export interface AnalyserHandle {
  analyser: AnalyserNode;
  left: AnalyserNode;
  right: AnalyserNode;
  ctx: AudioContext;
}

export function useAudioAnalyser(
  el: HTMLAudioElement | null,
  opts?: { fftSize?: number; smoothing?: number },
): { getHandle: () => AnalyserHandle | null } {
  const handleRef = useRef<AnalyserHandle | null>(null);
  const fftSize = opts?.fftSize ?? 4096;
  const smoothing = opts?.smoothing ?? 0.78;

  useEffect(() => {
    if (!el) {
      handleRef.current = null;
      return;
    }
    let ctx: AudioContext;
    let src: MediaElementAudioSourceNode;
    try {
      ctx = audioCtx();
      src = sourceFor(el);
    } catch {
      // WebAudio unavailable or element not eligible — degrade silently.
      handleRef.current = null;
      return;
    }

    const analyser = ctx.createAnalyser();
    analyser.fftSize = fftSize;
    analyser.smoothingTimeConstant = smoothing;

    const splitter = ctx.createChannelSplitter(2);
    const left = ctx.createAnalyser();
    const right = ctx.createAnalyser();
    left.fftSize = right.fftSize = 2048;

    try {
      src.connect(analyser);
      src.connect(splitter);
      splitter.connect(left, 0);
      splitter.connect(right, 1);
    } catch {
      handleRef.current = null;
      return;
    }

    handleRef.current = { analyser, left, right, ctx };

    const onPlay = () => {
      if (ctx.state === 'suspended') void ctx.resume();
    };
    el.addEventListener('play', onPlay);

    return () => {
      el.removeEventListener('play', onPlay);
      // Disconnect ONLY our taps. Never touch src→destination or close ctx.
      try { analyser.disconnect(); } catch { /* noop */ }
      try { splitter.disconnect(); } catch { /* noop */ }
      try { left.disconnect(); right.disconnect(); } catch { /* noop */ }
      handleRef.current = null;
    };
  }, [el, fftSize, smoothing]);

  return { getHandle: () => handleRef.current };
}
