/* ──────────────────────────────────────────────────────────────────
   exportHQ — GPU-accelerated, high-quality, offline export via WebCodecs.

   Unlike the real-time MediaRecorder path, this renders frame-by-frame
   deterministically (no dropped frames, full bitrate control) and uses
   the platform HARDWARE H.264 encoder (`prefer-hardware`). Audio is mixed
   offline in an OfflineAudioContext → AAC, video frames are drawn to the
   same canvas the preview uses → muxed to MP4 (mp4-muxer, MIT).

   The caller supplies `renderAt(t)` which seeks media + composites the
   canvas at time t — so the output is pixel-identical to the preview.
   Throws on any unsupported step; the caller falls back to MediaRecorder.
   ────────────────────────────────────────────────────────────────── */

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

export interface AudioDesc {
  src: string;
  start: number;
  inPoint: number;
  duration: number;
  speed: number;
  gain: number;
  fadeIn: number;
  fadeOut: number;
  muted: boolean;
}

export interface HQParams {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  duration: number;
  audio: AudioDesc[];
  renderAt: (t: number) => Promise<void>;
  onProgress: (pct: number) => void;
}

export function webcodecsSupported(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined'
    && typeof VideoFrame !== 'undefined' && typeof AudioData !== 'undefined'
    && typeof OfflineAudioContext !== 'undefined';
}

async function pickCodec(width: number, height: number, fps: number, bitrate: number): Promise<string> {
  const cands = ['avc1.640028', 'avc1.64002A', 'avc1.640032', 'avc1.4D4028', 'avc1.42E028', 'avc1.42E01E'];
  for (const codec of cands) {
    try {
      const s = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate, framerate: fps });
      if (s.supported) return codec;
    } catch { /* try next */ }
  }
  // verify the last-resort codec too — throw (→ MediaRecorder fallback) if nothing works
  const fb = await VideoEncoder.isConfigSupported({ codec: 'avc1.42E01E', width, height, bitrate, framerate: fps });
  if (!fb.supported) throw new Error('no supported H.264 config for this resolution');
  return 'avc1.42E01E';
}

async function mixAudio(audio: AudioDesc[], duration: number, sampleRate: number): Promise<AudioBuffer> {
  const frames = Math.max(1, Math.ceil(duration * sampleRate));
  const oac = new OfflineAudioContext(2, frames, sampleRate);
  const master = oac.createGain();
  master.connect(oac.destination);
  const decoded = new Map<string, AudioBuffer | null>();
  for (const a of audio) {
    if (a.muted) continue;
    let buf = decoded.get(a.src);
    if (buf === undefined) {
      try { const ab = await (await fetch(a.src)).arrayBuffer(); buf = await oac.decodeAudioData(ab); }
      catch { buf = null; }
      decoded.set(a.src, buf);
    }
    if (!buf) continue;
    const node = oac.createBufferSource();
    node.buffer = buf;
    const rate = Math.max(0.25, a.speed);
    node.playbackRate.value = rate;
    const g = oac.createGain();
    const base = Math.max(0, a.gain);
    const t0 = Math.max(0, a.start);
    const end = a.start + a.duration;
    g.gain.setValueAtTime(a.fadeIn > 0 ? 0 : base, t0);
    if (a.fadeIn > 0) g.gain.linearRampToValueAtTime(base, t0 + a.fadeIn);
    if (a.fadeOut > 0) {
      // start the fade-out no earlier than the fade-in finished, so the ramps don't cancel
      const fs = Math.max(t0 + a.fadeIn, end - a.fadeOut);
      if (fs < end) { g.gain.setValueAtTime(base, fs); g.gain.linearRampToValueAtTime(0, end); }
    }
    node.connect(g); g.connect(master);
    const avail = Math.max(0, buf.duration - a.inPoint);
    const playLen = Math.min(a.duration * rate, avail);
    try { node.start(t0, a.inPoint, Math.max(0.001, playLen)); } catch { try { node.start(t0); } catch { /* skip */ } }
  }
  return oac.startRendering();
}

/** Render the whole timeline to an MP4 ArrayBuffer using WebCodecs. */
export async function exportHQ(p: HQParams): Promise<ArrayBuffer> {
  const { canvas, width, height, fps, bitrate, duration, audio, renderAt, onProgress } = p;
  const SR = 48000;
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height, frameRate: fps },
    audio: { codec: 'aac', numberOfChannels: 2, sampleRate: SR },
    fastStart: 'in-memory',
  });

  // ── audio: offline mix → AAC ──
  const hasAudio = audio.some((a) => !a.muted);
  if (hasAudio) {
    const mixed = await mixAudio(audio, duration, SR);
    const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { throw e; } });
    aenc.configure({ codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: 2, bitrate: 192_000 });
    const ch0 = mixed.getChannelData(0);
    const ch1 = mixed.numberOfChannels > 1 ? mixed.getChannelData(1) : ch0;
    const N = mixed.length;
    const block = 9600;
    for (let i = 0; i < N; i += block) {
      const n = Math.min(block, N - i);
      const planar = new Float32Array(n * 2);
      planar.set(ch0.subarray(i, i + n), 0);
      planar.set(ch1.subarray(i, i + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / SR) * 1e6), data: planar });
      aenc.encode(ad);
      ad.close();
    }
    await aenc.flush();
    aenc.close();
  }

  // ── video: per-frame composite → H.264 ──
  const codec = await pickCodec(width, height, fps, bitrate);
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { throw e; } });
  venc.configure({ codec, width, height, bitrate, framerate: fps, hardwareAcceleration: 'prefer-hardware', latencyMode: 'quality' });
  const totalFrames = Math.max(1, Math.ceil(duration * fps));
  const gop = Math.max(1, Math.round(fps * 2));
  for (let f = 0; f < totalFrames; f++) {
    await renderAt(f / fps);
    const vf = new VideoFrame(canvas, { timestamp: Math.round((f * 1e6) / fps), duration: Math.round(1e6 / fps) });
    venc.encode(vf, { keyFrame: f % gop === 0 });
    vf.close();
    while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 0));
    if (f % 4 === 0) onProgress(Math.min(99, Math.round((f / totalFrames) * 100)));
  }
  await venc.flush();
  venc.close();
  muxer.finalize();
  return (muxer.target as ArrayBufferTarget).buffer;
}
