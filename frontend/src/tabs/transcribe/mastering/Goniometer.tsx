/* ──────────────────────────────────────────────────────────────────
   Goniometer — stereo vectorscope (the 音場 imager), drawn STATICALLY
   from the backend's sampled (L,R) scatter on the final master. Points
   are rotated 45° so mid is vertical, side horizontal. Plus a phase
   correlation readout and per-band width bars.

   NOTE: this intentionally does NOT tap the playing <audio> via WebAudio.
   createMediaElementSource reroutes the element's output into the audio
   graph and, with a suspended AudioContext, silences playback — so the
   imager is rendered from backend data instead, never touching playback.
   ────────────────────────────────────────────────────────────────── */

import { useEffect, useRef } from 'react';
import type { GoniometerData } from '../../../api/master';
import { useT } from '../../../i18n';

interface Props {
  /** Static goniometer payload (L/R scatter + correlation + per-band width). */
  data?: GoniometerData | null;
}

const SIZE = 200;
const RAD = SIZE / 2 - 8;

export function Goniometer({ data }: Props) {
  const t = useT();
  const cvsRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const cvs = cvsRef.current;
    if (!cvs) return;
    const g = cvs.getContext('2d');
    if (!g) return;
    const css = getComputedStyle(cvs);
    const dot = css.getPropertyValue('--al-gold').trim() || '#E8C36B';
    const cx = SIZE / 2;
    const cy = SIZE / 2;

    g.clearRect(0, 0, SIZE, SIZE);
    const pts = data?.points ?? [];
    g.fillStyle = dot;
    g.globalAlpha = 0.5;
    for (let i = 0; i < pts.length; i++) {
      const l = pts[i][0];
      const r = pts[i][1];
      const mid = (l + r) * 0.7071;
      const side = (l - r) * 0.7071;
      g.fillRect(cx + side * RAD, cy - mid * RAD, 1.5, 1.5);
    }
    g.globalAlpha = 1;
  }, [data]);

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
          <span className="al-gonio__corrval">{corr.toFixed(2)}</span>
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
