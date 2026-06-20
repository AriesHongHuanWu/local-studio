/* ──────────────────────────────────────────────────────────────────
   LiveSpectrum — real-time log-frequency analyzer that moves with the
   playing audio (the 邊聽邊看 feature). Canvas, peak-hold caps.
   ────────────────────────────────────────────────────────────────── */

import { useEffect, useRef } from 'react';
import { useAudioAnalyser } from './useAudioAnalyser';

interface Props {
  audioEl: HTMLAudioElement | null;
  tone?: 'gold' | 'green';
  label: string;
}

// Only animate while the source is actually playing — saves CPU/battery and
// lets the page go idle when paused.

const BANDS = 56;
const FMIN = 20;
const FMAX = 20000;
const W = 480;
const H = 96;

export function LiveSpectrum({ audioEl, tone = 'gold', label }: Props) {
  const { getHandle } = useAudioAnalyser(audioEl, { fftSize: 4096, smoothing: 0.8 });
  const cvsRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const peaksRef = useRef<Float32Array>(new Float32Array(BANDS));

  useEffect(() => {
    const cvs = cvsRef.current;
    if (!cvs) return;
    const g = cvs.getContext('2d');
    if (!g) return;
    const css = getComputedStyle(cvs);
    const barColor = css.getPropertyValue(tone === 'green' ? '--al-green' : '--al-gold').trim() || '#E8C36B';
    const capColor = css.getPropertyValue('--al-ink-dim').trim() || '#B7B2AE';

    let freqData: Uint8Array | null = null;
    const peaks = peaksRef.current;
    let running = false;

    const draw = () => {
      if (!running) return;
      rafRef.current = requestAnimationFrame(draw);
      const h = getHandle();
      g.clearRect(0, 0, W, H);
      if (!h) return;
      const n = h.analyser.frequencyBinCount;
      if (!freqData || freqData.length !== n) freqData = new Uint8Array(n);
      h.analyser.getByteFrequencyData(freqData);
      const sr = h.ctx.sampleRate;
      const binHz = sr / h.analyser.fftSize;

      const gap = 1.5;
      const bw = (W - gap * (BANDS - 1)) / BANDS;
      const la = Math.log10(FMIN);
      const lb = Math.log10(Math.min(FMAX, sr / 2));

      for (let i = 0; i < BANDS; i++) {
        // log-spaced band edges → max magnitude in the band (preserves peaks)
        const f0 = Math.pow(10, la + (lb - la) * (i / BANDS));
        const f1 = Math.pow(10, la + (lb - la) * ((i + 1) / BANDS));
        const b0 = Math.max(0, Math.floor(f0 / binHz));
        const b1 = Math.min(n - 1, Math.ceil(f1 / binHz));
        let m = 0;
        for (let b = b0; b <= b1; b++) if (freqData[b] > m) m = freqData[b];
        const v = m / 255;
        const bh = v * (H - 4);
        const x = i * (bw + gap);
        const y = H - bh;
        g.fillStyle = barColor;
        g.globalAlpha = 0.85;
        g.fillRect(x, y, bw, bh);
        // peak-hold cap, falls slowly
        peaks[i] = Math.max(peaks[i] * 0.94, v);
        const py = H - peaks[i] * (H - 4) - 2;
        g.globalAlpha = 1;
        g.fillStyle = capColor;
        g.fillRect(x, py, bw, 1.5);
      }
      g.globalAlpha = 1;
    };
    const start = () => {
      if (running) return;
      running = true;
      rafRef.current = requestAnimationFrame(draw);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
      g.clearRect(0, 0, W, H);
    };
    if (audioEl) {
      audioEl.addEventListener('play', start);
      audioEl.addEventListener('pause', stop);
      audioEl.addEventListener('ended', stop);
      if (!audioEl.paused) start();
    }
    return () => {
      stop();
      if (audioEl) {
        audioEl.removeEventListener('play', start);
        audioEl.removeEventListener('pause', stop);
        audioEl.removeEventListener('ended', stop);
      }
    };
  }, [getHandle, tone, audioEl]);

  return (
    <div className="al-live">
      <canvas ref={cvsRef} width={W} height={H} className="al-live__cvs" aria-label={label} />
      <span className="al-live__label">{label}</span>
    </div>
  );
}
