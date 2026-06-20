/* ──────────────────────────────────────────────────────────────────
   Goniometer — stereo vectorscope (the 音場 imager). Plots (L,R) rotated
   45° so mid is vertical, side horizontal. Live off the split L/R
   analysers; correlation meter + per-band width bars from analysis.
   ────────────────────────────────────────────────────────────────── */

import { useEffect, useRef } from 'react';
import { useAudioAnalyser } from './useAudioAnalyser';
import type { GoniometerData } from '../../../api/master';
import { useT } from '../../../i18n';

interface Props {
  audioEl: HTMLAudioElement | null;
  /** Static goniometer payload (correlation + per-band width) from the master meta. */
  data?: GoniometerData | null;
}

const SIZE = 200;
const RAD = SIZE / 2 - 8;

export function Goniometer({ audioEl, data }: Props) {
  const t = useT();
  const { getHandle } = useAudioAnalyser(audioEl, { fftSize: 2048 });
  const cvsRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const corrRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const cvs = cvsRef.current;
    if (!cvs) return;
    const g = cvs.getContext('2d');
    if (!g) return;
    const css = getComputedStyle(cvs);
    const dot = css.getPropertyValue('--al-gold').trim() || '#E8C36B';
    const bg = css.getPropertyValue('--al-bg').trim() || '#121013';
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    let L: Float32Array | null = null;
    let R: Float32Array | null = null;
    let running = false;

    const draw = () => {
      if (!running) return;
      rafRef.current = requestAnimationFrame(draw);
      const h = getHandle();
      if (!h) return;
      const n = h.left.fftSize;
      if (!L || L.length !== n) {
        L = new Float32Array(n);
        R = new Float32Array(n);
      }
      h.left.getFloatTimeDomainData(L);
      h.right.getFloatTimeDomainData(R!);

      // persistence trail (translucent wash instead of hard clear)
      g.globalAlpha = 0.2;
      g.fillStyle = bg;
      g.fillRect(0, 0, SIZE, SIZE);
      g.globalAlpha = 0.55;
      g.fillStyle = dot;

      let sLR = 0;
      let sLL = 0;
      let sRR = 0;
      for (let i = 0; i < n; i += 2) {
        const l = L![i];
        const r = R![i];
        sLR += l * r;
        sLL += l * l;
        sRR += r * r;
        const mid = (l + r) * 0.7071;
        const side = (l - r) * 0.7071;
        g.fillRect(cx + side * RAD, cy - mid * RAD, 1.4, 1.4);
      }
      g.globalAlpha = 1;
      const denom = Math.sqrt(sLL * sRR) || 1;
      if (corrRef.current && sLL + sRR > 1e-7) {
        corrRef.current.textContent = (sLR / denom).toFixed(2);
      }
    };
    const start = () => {
      if (running) return;
      running = true;
      rafRef.current = requestAnimationFrame(draw);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
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
  }, [getHandle, audioEl]);

  const corr = data?.correlation ?? 0;
  const bands = data?.bands ?? [];

  return (
    <div className="al-gonio">
      <div className="al-gonio__scope">
        <canvas ref={cvsRef} width={SIZE} height={SIZE} className="al-gonio__cvs"
                aria-label={t('master.viz.gonioAria')} />
        <span className="al-gonio__axis al-gonio__axis--m">M</span>
        <span className="al-gonio__axis al-gonio__axis--s">S</span>
      </div>
      <div className="al-gonio__meters">
        <div className="al-gonio__corr">
          <span className="al-gonio__corrlbl">{t('master.imager.correlation')}</span>
          <span className="al-gonio__corrval" ref={corrRef}>{corr.toFixed(2)}</span>
        </div>
        <div className="al-gonio__bands">
          {bands.map((b) => {
            const pct = Math.min(100, Math.max(0, b.width_index * 80));
            const warn = b.correlation < 0.1 || b.width_index > 1.0;
            return (
              <div key={b.name} className="al-gonio__band">
                <span className="al-gonio__bandname">{t(`master.imager.${b.name}`)}</span>
                <div className="al-gonio__bartrack">
                  <div className={`al-gonio__barfill${warn ? ' al-gonio__barfill--warn' : ''}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="al-gonio__bandval">{b.width_index.toFixed(2)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
