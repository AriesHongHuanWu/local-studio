/* ──────────────────────────────────────────────────────────────────
   usePlayback — the editor's preview + export engine (pro pipeline).

   POOL  : one <video>/<audio>/Image per media clip, kept in sync.
   MIXER : every element source→gain→master, master→speakers + a
           MediaStreamDestination for export.
   LOOP  : always-on rAF — advances the clock when playing, drives each
           element (speed/seek/play/pause + fade gain), and composites the
           canvas: per visual clip it applies keyframed transform, filters,
           blend mode, chroma key and transitions; text gets styling +
           animation; shapes are drawn vector. Export records that exact
           canvas + mixed audio (MediaRecorder → MP4) — WYSIWYG.
   ────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from 'react';
import { saveBinaryBlob } from '../export/saveFile';
import { useEditor, docDuration } from './useEditor';
import { buildFilter, transformAt, transitionMod, textAnim, chromaKey } from './effects';
import { exportHQ, webcodecsSupported, type AudioDesc } from './exportHQ';
import type { Clip, EditDoc } from './types';

const nowSec = () => performance.now() / 1000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function pickMime(format: 'mp4' | 'webm'): { mime: string; ext: string } {
  const mp4 = [
    { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' as const },
    { mime: 'video/mp4', ext: 'mp4' as const },
  ];
  const webm = [
    { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' as const },
    { mime: 'video/webm', ext: 'webm' as const },
  ];
  const order = format === 'webm' ? [...webm, ...mp4] : [...mp4, ...webm];
  for (const c of order) if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c.mime)) return c;
  return { mime: '', ext: 'webm' };
}

interface PoolEntry {
  kind: Clip['kind'];
  src: string;
  el?: HTMLVideoElement | HTMLAudioElement;
  img?: HTMLImageElement;
  node?: MediaElementAudioSourceNode;
  gain?: GainNode;
  lastGain: number;
  lastRate: number;
}

export interface ExportOpts { name: string; fps: number; bitrate: number; format: 'mp4' | 'webm' }

interface Args {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  poolRef: React.RefObject<HTMLDivElement | null>;
  cursorRef: React.RefObject<HTMLDivElement | null>;
  pxPerSec: number;
  onExported?: (path: string | null) => void;
}

export interface Playback {
  playing: boolean;
  exporting: boolean;
  expPct: number;
  msg: string | null;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seekTo: (t: number) => void;
  exportVideo: (opts: ExportOpts) => Promise<void>;
  exportVideoHQ: (opts: ExportOpts) => Promise<void>;
  hqAvailable: boolean;
  getTime: () => number;
  clearMsg: () => void;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
}

function gainFactor(c: Clip, t: number): number {
  const local = t - c.start;
  let g = c.gain;
  if (c.fadeIn > 0 && local < c.fadeIn) g *= clamp(local / c.fadeIn, 0, 1);
  if (c.fadeOut > 0 && local > c.duration - c.fadeOut) g *= clamp((c.duration - local) / c.fadeOut, 0, 1);
  return clamp(g, 0, 4);
}

export function usePlayback({ canvasRef, poolRef, cursorRef, pxPerSec, onExported }: Args): Playback {
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [expPct, setExpPct] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);

  const pool = useRef<Map<string, PoolEntry>>(new Map());
  const audio = useRef<{ ctx: AudioContext; master: GainNode; dest: MediaStreamAudioDestinationNode } | null>(null);
  const off = useRef<HTMLCanvasElement | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const exportBusyRef = useRef(false);
  const hqRef = useRef(false);
  const tRef = useRef(0);
  const t0Ref = useRef(0);
  const playingRef = useRef(false);
  const exportingRef = useRef(false);
  const onEndRef = useRef<(() => void) | null>(null);
  const rafRef = useRef<number | null>(null);
  const tickRef = useRef(0);
  const pxRef = useRef(pxPerSec);
  pxRef.current = pxPerSec;

  const ensureAudio = useCallback(() => {
    if (audio.current) return audio.current;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const master = ctx.createGain();
    const dest = ctx.createMediaStreamDestination();
    master.connect(ctx.destination);
    master.connect(dest);
    audio.current = { ctx, master, dest };
    return audio.current;
  }, []);

  const destroyEntry = useCallback((e: PoolEntry) => {
    try { e.node?.disconnect(); } catch { /* noop */ }
    try { e.gain?.disconnect(); } catch { /* noop */ }
    if (e.el) { try { e.el.pause(); } catch { /* noop */ } e.el.preload = 'none'; e.el.removeAttribute('src'); e.el.load?.(); e.el.remove(); }
  }, []);

  const createEntry = useCallback((c: Clip): PoolEntry => {
    if (c.kind === 'image') {
      const img = new Image();
      img.src = c.src ?? '';
      return { kind: 'image', src: c.src ?? '', img, lastGain: -1, lastRate: -1 };
    }
    const el = document.createElement(c.kind === 'video' ? 'video' : 'audio') as HTMLVideoElement | HTMLAudioElement;
    el.src = c.src ?? '';
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    if (el instanceof HTMLVideoElement) { el.playsInline = true; el.muted = false; }
    poolRef.current?.appendChild(el);
    const a = ensureAudio();
    let node: MediaElementAudioSourceNode | undefined;
    let gain: GainNode | undefined;
    try {
      node = a.ctx.createMediaElementSource(el);
      gain = a.ctx.createGain();
      gain.gain.value = 0;
      node.connect(gain);
      gain.connect(a.master);
    } catch { /* ignore double-wire */ }
    return { kind: c.kind, src: c.src ?? '', el, node, gain, lastGain: -1, lastRate: -1 };
  }, [ensureAudio, poolRef]);

  const syncPool = useCallback((doc: EditDoc) => {
    const seen = new Set<string>();
    for (const tr of doc.tracks) {
      for (const c of tr.clips) {
        if (c.kind === 'text' || c.kind === 'shape') continue;
        seen.add(c.id);
        const cur = pool.current.get(c.id);
        if (!cur || cur.src !== (c.src ?? '')) {
          if (cur) destroyEntry(cur);
          pool.current.set(c.id, createEntry(c));
        }
      }
    }
    for (const [id, e] of pool.current) if (!seen.has(id)) { destroyEntry(e); pool.current.delete(id); }
  }, [createEntry, destroyEntry]);

  const drive = useCallback((doc: EditDoc) => {
    const t = tRef.current;
    const isPlaying = playingRef.current;
    for (const tr of doc.tracks) {
      const trackMuted = tr.kind === 'audio' && tr.muted;
      for (const c of tr.clips) {
        if (c.kind === 'text' || c.kind === 'shape') continue;
        const e = pool.current.get(c.id);
        if (!e || !e.el) continue;
        const active = t >= c.start && t < c.start + c.duration;
        const sp = Math.max(0.01, c.speed);
        const local = c.inPoint + (t - c.start) * sp;
        if (active) {
          if (e.el.readyState >= 1) {
            const drift = Math.abs(e.el.currentTime - local);
            if (drift > (isPlaying ? 0.35 : 0.05)) { try { e.el.currentTime = local; } catch { /* noop */ } }
          }
          if (e.lastRate !== sp) { try { e.el.playbackRate = sp; } catch { /* noop */ } e.lastRate = sp; }
          if (isPlaying && e.el.paused) e.el.play().catch(() => { /* not ready / gesture */ });
          if (!isPlaying && !e.el.paused) e.el.pause();
          const g = trackMuted || !isPlaying ? 0 : gainFactor(c, t);
          if (e.gain && Math.abs(e.lastGain - g) > 0.001) { e.gain.gain.value = g; e.lastGain = g; }
        } else {
          if (!e.el.paused) e.el.pause();
          if (e.gain && e.lastGain !== 0) { e.gain.gain.value = 0; e.lastGain = 0; }
        }
      }
    }
  }, []);

  const drawMedia = useCallback((ctx: CanvasRenderingContext2D, c: Clip, localT: number, W: number, H: number) => {
    const e = pool.current.get(c.id);
    let source: CanvasImageSource | null = null;
    let sw = 0; let sh = 0;
    if (e?.img && e.img.complete && e.img.naturalWidth > 0) { source = e.img; sw = e.img.naturalWidth; sh = e.img.naturalHeight; }
    else if (e?.el instanceof HTMLVideoElement && e.el.readyState >= 2 && e.el.videoWidth > 0) { source = e.el; sw = e.el.videoWidth; sh = e.el.videoHeight; }
    if (!source) return;
    if (c.chroma.on && off.current) { source = chromaKey(off.current, source, sw, sh, c.chroma.color, c.chroma.threshold, c.chroma.smooth); }
    const tr = transformAt(c, localT);
    const m = transitionMod(c, localT, W, H);
    const alpha = clamp(tr.opacity * m.alpha, 0, 1);
    if (alpha <= 0) return;
    const fit = Math.min(W / sw, H / sh);
    const dw = sw * fit; const dh = sh * fit;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = c.blend;
    ctx.filter = buildFilter(c.filters, m.blur, 0);
    ctx.translate(W / 2 + tr.x + m.tx, H / 2 + tr.y + m.ty);
    ctx.rotate(((tr.rotation + m.rot) * Math.PI) / 180);
    ctx.scale((c.flipH ? -1 : 1) * tr.scale * m.sc, (c.flipV ? -1 : 1) * tr.scale * m.sc);
    // mask: clip the media to a shape (in local space, follows the transform)
    if (c.mask === 'circle') { ctx.beginPath(); ctx.ellipse(0, 0, dw / 2, dh / 2, 0, 0, Math.PI * 2); ctx.clip(); }
    else if (c.mask === 'rounded') { roundRect(ctx, -dw / 2, -dh / 2, dw, dh, Math.min(dw, dh) * 0.12); ctx.clip(); }
    // wipe transition clips in local space
    if (m.clipFrac < 1) { ctx.beginPath(); ctx.rect(-dw / 2, -dh / 2, dw * m.clipFrac, dh); ctx.clip(); }
    if (c.glitch > 0) {
      const bands = 6 + Math.round(c.glitch * 8);
      const bh = dh / bands; const sbh = sh / bands;
      for (let i = 0; i < bands; i++) {
        const jitter = (Math.random() - 0.5) * c.glitch * dw * 0.22;
        try { ctx.drawImage(source, 0, i * sbh, sw, sbh, -dw / 2 + jitter, -dh / 2 + i * bh, dw, bh + 1); } catch { /* skip band */ }
      }
    } else {
      try { ctx.drawImage(source, -dw / 2, -dh / 2, dw, dh); } catch { /* not decodable */ }
    }
    if (c.scan > 0) {
      ctx.filter = 'none';
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgba(0,0,0,${(c.scan * 0.5).toFixed(2)})`;
      for (let y = -dh / 2; y < dh / 2; y += 3) ctx.fillRect(-dw / 2, y, dw, 1.4);
    }
    ctx.restore();
  }, []);

  const drawShape = useCallback((ctx: CanvasRenderingContext2D, c: Clip, localT: number, W: number, H: number) => {
    const tr = transformAt(c, localT);
    const m = transitionMod(c, localT, W, H);
    const alpha = clamp(tr.opacity * m.alpha, 0, 1);
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = c.blend;
    ctx.translate(W / 2 + tr.x + m.tx, H / 2 + tr.y + m.ty);
    ctx.rotate(((tr.rotation + m.rot) * Math.PI) / 180);
    ctx.scale(tr.scale * m.sc, tr.scale * m.sc);
    ctx.fillStyle = c.fill;
    const bw = 420; const bh = 260;
    if (c.shapeType === 'ellipse') { ctx.beginPath(); ctx.ellipse(0, 0, bw / 2, bh / 2, 0, 0, Math.PI * 2); ctx.fill(); }
    else if (c.shapeType === 'line') { ctx.fillRect(-bw / 2, -7, bw, 14); }
    else { ctx.fillRect(-bw / 2, -bh / 2, bw, bh); }
    ctx.restore();
  }, []);

  const drawText = useCallback((ctx: CanvasRenderingContext2D, c: Clip, localT: number, W: number, H: number) => {
    if (!c.text.trim()) return;
    const tr = transformAt(c, localT);
    const an = textAnim(c, localT);
    const alpha = clamp(tr.opacity * an.alpha, 0, 1);
    if (alpha <= 0) return;
    const fs = c.fontSize;
    const lh = fs * (c.lineHeight || 1.25);
    let lines = c.text.split('\n');
    if (an.reveal < 1) {
      const total = c.text.replace(/\n/g, '').length;
      let budget = Math.ceil(total * an.reveal);
      lines = lines.map((ln) => { const take = Math.min(ln.length, budget); budget -= take; return ln.slice(0, take); });
    }
    const anchorX = c.align === 'left' ? W * 0.06 : c.align === 'right' ? W * 0.94 : W / 2;
    const anchorY = H * (c.posY || 0.84);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(anchorX + tr.x + an.tx, anchorY + tr.y + an.ty);
    ctx.rotate((tr.rotation * Math.PI) / 180);
    ctx.scale(tr.scale * an.sc, tr.scale * an.sc);
    ctx.font = `${c.italic ? 'italic ' : ''}${c.bold ? 700 : 500} ${fs}px ${c.font}`;
    ctx.textAlign = c.align;
    ctx.textBaseline = 'middle';
    try { (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${c.letterSpacing || 0}px`; } catch { /* unsupported */ }
    const cy0 = -(lines.length - 1) * lh * 0.5;
    // translucent rounded caption bar
    if (c.box > 0) {
      let maxw = 0;
      for (const ln of lines) maxw = Math.max(maxw, ctx.measureText(ln || ' ').width);
      const padX = fs * 0.5; const padY = fs * 0.34;
      const bw = maxw + padX * 2;
      const bh = lines.length * lh + padY * 2 - (lh - fs);
      const bx = c.align === 'left' ? -padX : c.align === 'right' ? -bw + padX : -bw / 2;
      const by = cy0 - fs / 2 - padY;
      ctx.save();
      ctx.globalAlpha = alpha * c.box;
      ctx.fillStyle = '#000000';
      const r = Math.min(fs * 0.45, bh / 2);
      ctx.beginPath();
      ctx.moveTo(bx + r, by);
      ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
      ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
      ctx.arcTo(bx, by + bh, bx, by, r);
      ctx.arcTo(bx, by, bx + bw, by, r);
      ctx.fill();
      ctx.restore();
    }
    // soft shadow for legibility (drop-shadow keeps the glyphs crisp)
    if (c.shadow > 0) ctx.filter = buildFilter({ brightness: 1, contrast: 1, saturate: 1, hue: 0, blur: 0, sepia: 0, grayscale: 0, invert: 0 }, 0, c.shadow);
    if (c.stroke > 0) { ctx.lineWidth = c.stroke; ctx.strokeStyle = c.strokeColor; ctx.lineJoin = 'round'; }
    // gradient or solid fill
    let fill: string | CanvasGradient = c.color;
    if (c.grad) {
      const g = ctx.createLinearGradient(0, cy0 - fs * 0.6, 0, cy0 + (lines.length - 1) * lh + fs * 0.6);
      g.addColorStop(0, c.color);
      g.addColorStop(1, c.gradColor);
      fill = g;
    }
    lines.forEach((ln, i) => {
      const y = cy0 + i * lh;
      if (c.stroke > 0) ctx.strokeText(ln, 0, y);
      ctx.fillStyle = fill;
      ctx.fillText(ln, 0, y);
    });
    ctx.restore();
  }, []);

  const composite = useCallback((doc: EditDoc) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = doc.width; const H = doc.height;
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const t = tRef.current;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.fillStyle = doc.bg;
    ctx.fillRect(0, 0, W, H);
    const visual = doc.tracks.filter((tr) => tr.kind === 'visual' && !tr.hidden);
    for (let i = visual.length - 1; i >= 0; i--) {
      for (const c of visual[i].clips) {
        if (t < c.start || t >= c.start + c.duration) continue;
        if (c.kind === 'shape') drawShape(ctx, c, t - c.start, W, H);
        else drawMedia(ctx, c, t - c.start, W, H);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const tr of doc.tracks) {
      if (tr.kind !== 'text' || tr.hidden) continue;
      for (const c of tr.clips) if (t >= c.start && t < c.start + c.duration) drawText(ctx, c, t - c.start, W, H);
    }
    ctx.filter = 'none';
  }, [canvasRef, drawMedia, drawShape, drawText]);

  // Seek every active VIDEO clip to its source time at t and wait for the
  // frames to be ready — so an offline render is frame-accurate.
  const seekActiveVideo = useCallback((doc: EditDoc, t: number): Promise<void> => {
    const waits: Promise<void>[] = [];
    for (const tr of doc.tracks) {
      if (tr.kind !== 'visual' || tr.hidden) continue;
      for (const c of tr.clips) {
        if (c.kind !== 'video') continue;
        if (t < c.start || t >= c.start + c.duration) continue;
        const e = pool.current.get(c.id);
        if (!(e?.el instanceof HTMLVideoElement)) continue;
        const el = e.el;
        const local = c.inPoint + (t - c.start) * Math.max(0.01, c.speed);
        if (el.readyState >= 2 && Math.abs(el.currentTime - local) < 0.001) continue;
        waits.push(new Promise<void>((res) => {
          let done = false;
          const finish = () => { if (done) return; done = true; el.removeEventListener('seeked', finish); res(); };
          el.addEventListener('seeked', finish);
          try { el.currentTime = local; } catch { finish(); }
          setTimeout(finish, 220);
        }));
      }
    }
    return Promise.all(waits).then(() => undefined);
  }, []);

  const renderFrameAt = useCallback(async (doc: EditDoc, t: number) => {
    tRef.current = t;
    await seekActiveVideo(doc, t);
    composite(doc);
  }, [seekActiveVideo, composite]);

  useEffect(() => {
    if (!off.current) off.current = document.createElement('canvas');
    const frame = () => {
      if (hqRef.current) { rafRef.current = requestAnimationFrame(frame); return; } // HQ export owns the canvas
      const doc = useEditor.getState().doc;
      const dur = docDuration(doc);
      if (playingRef.current) {
        tRef.current = nowSec() - t0Ref.current;
        if (dur > 0 && tRef.current >= dur) {
          tRef.current = dur;
          if (exportingRef.current) onEndRef.current?.();
          else { playingRef.current = false; setPlaying(false); useEditor.getState().setPlayhead(dur); }
        }
      }
      syncPool(doc);
      drive(doc);
      composite(doc);
      if (cursorRef.current) cursorRef.current.style.transform = `translateX(${tRef.current * pxRef.current}px)`;
      tickRef.current = (tickRef.current + 1) % 6;
      if (tickRef.current === 0 && exportingRef.current && dur > 0) setExpPct(Math.min(99, Math.round((tRef.current / dur) * 100)));
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);
    const poolMap = pool.current;
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      for (const [, e] of poolMap) destroyEntry(e);
      poolMap.clear();
      if (audio.current) { audio.current.ctx.close().catch(() => { /* noop */ }); audio.current = null; }
    };
  }, [syncPool, drive, composite, cursorRef, destroyEntry]);

  const play = useCallback(() => {
    const a = ensureAudio();
    if (a.ctx.state === 'suspended') a.ctx.resume().catch(() => { /* noop */ });
    const dur = docDuration(useEditor.getState().doc);
    if (dur > 0 && tRef.current >= dur) tRef.current = 0;
    t0Ref.current = nowSec() - tRef.current;
    playingRef.current = true;
    setPlaying(true);
  }, [ensureAudio]);

  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    useEditor.getState().setPlayhead(tRef.current);
  }, []);

  const toggle = useCallback(() => { if (playingRef.current) pause(); else play(); }, [play, pause]);

  const seekTo = useCallback((t: number) => {
    const dur = docDuration(useEditor.getState().doc);
    tRef.current = clamp(t, 0, Math.max(0, dur));
    if (playingRef.current) t0Ref.current = nowSec() - tRef.current;
    useEditor.getState().setPlayhead(tRef.current);
  }, []);

  const getTime = useCallback(() => tRef.current, []);
  const clearMsg = useCallback(() => setMsg(null), []);

  const exportVideo = useCallback(async (opts: ExportOpts) => {
    const canvas = canvasRef.current;
    if (!canvas || exportBusyRef.current) return; // ignore if already exporting
    exportBusyRef.current = true; // claim synchronously, before any await
    const doc = useEditor.getState().doc;
    const dur = docDuration(doc);
    if (dur <= 0) { setMsg('empty'); exportBusyRef.current = false; return; }
    const a = ensureAudio();
    if (a.ctx.state === 'suspended') await a.ctx.resume().catch(() => { /* noop */ });
    const { mime, ext } = pickMime(opts.format);
    const canvasStream = canvas.captureStream(opts.fps || 30);
    const combined = new MediaStream([...canvasStream.getVideoTracks(), ...a.dest.stream.getAudioTracks()]);
    const rec = new MediaRecorder(combined, mime ? { mimeType: mime, videoBitsPerSecond: opts.bitrate } : undefined);
    recRef.current = rec;
    const chunks: BlobPart[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise<void>((resolve) => { rec.onstop = () => resolve(); });

    setExporting(true); setExpPct(0); setMsg(null);
    exportingRef.current = true;
    onEndRef.current = () => { try { rec.stop(); } catch { /* noop */ } };
    seekTo(0);
    rec.start(200);
    play();
    await done;

    exportingRef.current = false;
    onEndRef.current = null;
    rec.ondataavailable = null; rec.onstop = null;
    recRef.current = null;
    pause();
    seekTo(0);
    canvasStream.getTracks().forEach((tk) => tk.stop());
    const blob = new Blob(chunks, { type: mime || 'video/webm' });
    const filename = `${opts.name.replace(/[^\w\-]+/g, '_') || 'edit'}.${ext}`;
    let outPath: string | null = null;
    try {
      const out = await saveBinaryBlob(blob, filename, { name: 'Video', extensions: [ext] });
      if (out.kind === 'tauri') { outPath = out.path; setMsg('saved'); }
      else if (out.kind === 'download') setMsg('saved');
      else setMsg(null);
    } catch { setMsg('failed'); }
    setExporting(false); setExpPct(0);
    exportBusyRef.current = false;
    onExported?.(outPath);
  }, [canvasRef, ensureAudio, seekTo, play, pause, onExported]);

  // GPU / high-quality offline export via WebCodecs, with MediaRecorder fallback.
  const exportVideoHQ = useCallback(async (opts: ExportOpts) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!webcodecsSupported()) { await exportVideo(opts); return; }
    if (exportBusyRef.current) return;
    exportBusyRef.current = true;
    const doc = useEditor.getState().doc;
    const dur = docDuration(doc);
    if (dur <= 0) { setMsg('empty'); exportBusyRef.current = false; return; }
    ensureAudio();
    syncPool(doc);
    setExporting(true); setExpPct(0); setMsg(null);
    hqRef.current = true;
    try {
      const audio: AudioDesc[] = [];
      for (const tr of doc.tracks) for (const c of tr.clips) {
        if ((c.kind === 'audio' || c.kind === 'video') && c.src) {
          audio.push({ src: c.src, start: c.start, inPoint: c.inPoint, duration: c.duration, speed: c.speed, gain: c.gain, fadeIn: c.fadeIn, fadeOut: c.fadeOut, muted: tr.kind === 'audio' && tr.muted });
        }
      }
      const buffer = await exportHQ({ canvas, width: doc.width, height: doc.height, fps: opts.fps, bitrate: opts.bitrate, duration: dur, audio, renderAt: (t) => renderFrameAt(doc, t), onProgress: (p) => setExpPct(p) });
      hqRef.current = false;
      const blob = new Blob([buffer], { type: 'video/mp4' });
      const filename = `${opts.name.replace(/[^\w\-]+/g, '_') || 'edit'}.mp4`;
      let outPath: string | null = null;
      const out = await saveBinaryBlob(blob, filename, { name: 'Video', extensions: ['mp4'] });
      if (out.kind === 'tauri') { outPath = out.path; setMsg('saved'); } else if (out.kind === 'download') setMsg('saved'); else setMsg(null);
      setExporting(false); setExpPct(0);
      exportBusyRef.current = false;
      seekTo(0);
      onExported?.(outPath);
    } catch {
      // WebCodecs failed — clean up and fall back to MediaRecorder
      hqRef.current = false;
      setExporting(false); setExpPct(0);
      exportBusyRef.current = false;
      try { await exportVideo(opts); }
      catch { setMsg('failed'); setExporting(false); setExpPct(0); exportBusyRef.current = false; }
    }
  }, [canvasRef, ensureAudio, exportVideo, syncPool, renderFrameAt, seekTo, onExported]);

  return { playing, exporting, expPct, msg, play, pause, toggle, seekTo, exportVideo, exportVideoHQ, hqAvailable: webcodecsSupported(), getTime, clearMsg };
}
