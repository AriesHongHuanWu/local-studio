/* ──────────────────────────────────────────────────────────────────
   VisualizerFlow — audio-reactive music visualizer with publishable
   video export. Drop a song → a Canvas reacts in real time (Web Audio
   AnalyserNode) → pick a template + colors + sensitivity + beat-shake +
   an optional intro card (title/artist, fades out) → Export records the
   canvas + audio (MediaRecorder) to MP4/WebM. All local.
   ────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from 'react';
import { UploadCloud, Play, Pause, Film, Loader2, Sparkles } from 'lucide-react';
import { saveBinaryBlob } from '../export/saveFile';
import { useLang } from '../../i18n';
import { TEMPLATES, resetTemplateState, applyEffects, type VizParams, type VizEffects } from './vizTemplates';
import './visualizer.css';

const ASPECTS: { key: string; label: string; w: number; h: number }[] = [
  { key: '16:9', label: '16:9', w: 1280, h: 720 },
  { key: '9:16', label: '9:16', w: 720, h: 1280 },
  { key: '1:1', label: '1:1', w: 1080, h: 1080 },
];

function pickMime(): { mime: string; ext: string } {
  const cands = [
    { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' },
    { mime: 'video/mp4', ext: 'mp4' },
    { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' },
  ];
  for (const c of cands) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c.mime)) return c;
  }
  return { mime: '', ext: 'webm' };
}

export function VisualizerFlow() {
  const en = useLang() === 'en';
  const [file, setFile] = useState<File | null>(null);
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [tplKey, setTplKey] = useState('radial');
  const [aspect, setAspect] = useState('16:9');
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [expPct, setExpPct] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);

  const [params, setParams] = useState<VizParams>({
    bg: '#0b0b12', accent: '#d8a657', accent2: '#7a5cff', sensitivity: 1, shake: 0.4, glow: 0.5,
  });
  const [intro, setIntro] = useState({ title: '', artist: '', fadeSec: 5, show: true });
  const [fx, setFx] = useState<VizEffects>({ mirror: 'none', vignette: 0, grain: 0, flash: 0 });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const graphRef = useRef<{ ctx: AudioContext; analyser: AnalyserNode; src: MediaElementAudioSourceNode; dest: MediaStreamAudioDestinationNode } | null>(null);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const bassAvgRef = useRef<number>(0);
  const beatRef = useRef<number>(0);

  const aspectDef = ASPECTS.find((a) => a.key === aspect) ?? ASPECTS[0];

  // object-URL lifecycle
  const onFile = useCallback((f: File) => {
    setFile(f);
    setSrcUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(f); });
    if (!intro.title) setIntro((i) => ({ ...i, title: f.name.replace(/\.[^.]+$/, '') }));
  }, [intro.title]);

  useEffect(() => () => { if (srcUrl) URL.revokeObjectURL(srcUrl); }, [srcUrl]);
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  const ensureGraph = useCallback(() => {
    if (graphRef.current || !audioRef.current) return graphRef.current;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const src = ctx.createMediaElementSource(audioRef.current);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.8;
    const dest = ctx.createMediaStreamDestination();
    src.connect(analyser);
    analyser.connect(ctx.destination);   // speakers
    analyser.connect(dest);              // export audio
    graphRef.current = { ctx, analyser, src, dest };
    return graphRef.current;
  }, []);

  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current; const g = graphRef.current;
    if (!canvas || !g) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const { w, h } = aspectDef;
    const freq = new Uint8Array(g.analyser.frequencyBinCount);
    const time = new Uint8Array(g.analyser.fftSize);
    g.analyser.getByteFrequencyData(freq);
    g.analyser.getByteTimeDomainData(time);

    // level + bass + beat envelope
    let sum = 0; for (let i = 0; i < freq.length; i++) sum += freq[i];
    const level = sum / freq.length / 255;
    let bsum = 0; const bn = Math.max(1, Math.floor(freq.length * 0.08));
    for (let i = 0; i < bn; i++) bsum += freq[i];
    const bass = bsum / bn / 255;
    const avg = bassAvgRef.current = bassAvgRef.current * 0.9 + bass * 0.1;
    if (bass > avg * 1.35 + 0.04) beatRef.current = 1; else beatRef.current *= 0.9;
    const beat = beatRef.current;
    const t = (performance.now() - startRef.current) / 1000;

    // background with motion trails (more glow → longer trails)
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `${params.bg}${Math.round((1 - params.glow * 0.55) * 255).toString(16).padStart(2, '0')}`;
    ctx.fillRect(0, 0, w, h);

    const tpl = TEMPLATES.find((x) => x.key === tplKey) ?? TEMPLATES[0];
    ctx.save();
    try { tpl.draw({ ctx, w, h, freq, time, t, level, bass, beat, params }); } catch { /* keep going */ }
    ctx.restore();

    try { applyEffects(ctx, w, h, beat, params.accent, fx); } catch { /* keep going */ }

    // intro card
    if (intro.show && intro.title && t < intro.fadeSec) {
      const fade = t > intro.fadeSec - 1 ? Math.max(0, intro.fadeSec - t) : 1;
      ctx.globalAlpha = fade;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${Math.round(h * 0.072)}px Inter, system-ui, sans-serif`;
      ctx.shadowColor = params.accent; ctx.shadowBlur = 24;
      ctx.fillText(intro.title, w / 2, h * 0.52);
      ctx.shadowBlur = 0;
      if (intro.artist) {
        ctx.fillStyle = params.accent;
        ctx.font = `500 ${Math.round(h * 0.04)}px Inter, system-ui, sans-serif`;
        ctx.fillText(intro.artist, w / 2, h * 0.52 + h * 0.075);
      }
      ctx.globalAlpha = 1;
    }
    rafRef.current = requestAnimationFrame(renderFrame);
  }, [aspectDef, params, tplKey, intro, fx]);

  const play = useCallback(async () => {
    const audio = audioRef.current; if (!audio) return;
    const g = ensureGraph(); if (g && g.ctx.state === 'suspended') await g.ctx.resume();
    resetTemplateState(); startRef.current = performance.now();
    await audio.play();
    setPlaying(true);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(renderFrame);
  }, [ensureGraph, renderFrame]);

  const pause = useCallback(() => {
    audioRef.current?.pause(); setPlaying(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const doExport = useCallback(async () => {
    const audio = audioRef.current; const canvas = canvasRef.current;
    if (!audio || !canvas) return;
    const g = ensureGraph(); if (!g) return;
    if (g.ctx.state === 'suspended') await g.ctx.resume();
    const { mime, ext } = pickMime();
    const canvasStream = canvas.captureStream(30);
    const combined = new MediaStream([...canvasStream.getVideoTracks(), ...g.dest.stream.getAudioTracks()]);
    const rec = new MediaRecorder(combined, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined);
    const chunks: BlobPart[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    setExporting(true); setExpPct(0); setMsg(null);

    const done = new Promise<void>((resolve) => { rec.onstop = () => resolve(); });
    audio.currentTime = 0; resetTemplateState(); startRef.current = performance.now();
    rec.start(200);
    await audio.play(); setPlaying(true);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(renderFrame);
    const onTime = () => { if (audio.duration) setExpPct(Math.min(99, Math.round((audio.currentTime / audio.duration) * 100))); };
    audio.addEventListener('timeupdate', onTime);
    const onEnded = () => rec.stop();
    audio.addEventListener('ended', onEnded, { once: true });

    await done;
    audio.removeEventListener('timeupdate', onTime);
    pause();
    const blob = new Blob(chunks, { type: mime || 'video/webm' });
    const name = `${(intro.title || 'visualizer').replace(/[^\w\-]+/g, '_')}.${ext}`;
    try { await saveBinaryBlob(blob, name, { name: 'Video', extensions: [ext] }); setMsg(en ? 'Saved ✓' : '已儲存 ✓'); }
    catch { setMsg(en ? 'Export failed' : '匯出失敗'); }
    setExporting(false); setExpPct(0);
  }, [ensureGraph, renderFrame, pause, intro.title, en]);

  const upd = (k: keyof VizParams, v: number | string) => setParams((p) => ({ ...p, [k]: v }));

  return (
    <div className="al-tabpage al-viz">
      <div className="al-tabpage__head">
        <h1 className="al-tabpage__title">{en ? 'Visualizer' : '視覺化 Visualizer'}</h1>
        <p className="al-tabpage__lede">{en
          ? 'Turn a song into an audio-reactive video you can publish — pick a template, customize, and export.'
          : '把一首歌變成會跟著音樂抖動的影片,選模板、調參數、匯出可直接發佈。'}</p>
      </div>

      {!file ? (
        <label className="al-master__drop al-viz__drop">
          <input type="file" accept="audio/*,.wav,.mp3,.flac,.m4a,.ogg" className="al-master__file"
                 onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
          <UploadCloud size={22} />
          <span className="al-master__dropmain">{en ? 'Drop or choose a song' : '拖入或選擇歌曲'}</span>
          <span className="al-master__drophint">WAV · MP3 · FLAC · M4A</span>
        </label>
      ) : (
        <div className="al-viz__stage">
          <div className="al-viz__canvaswrap" data-aspect={aspect}>
            <canvas ref={canvasRef} width={aspectDef.w} height={aspectDef.h} className="al-viz__canvas" />
            <div className="al-viz__transport">
              <button type="button" className="al-btn al-btn--primary" onClick={playing ? pause : play} disabled={exporting}>
                {playing ? <Pause size={16} /> : <Play size={16} />} {playing ? (en ? 'Pause' : '暫停') : (en ? 'Play' : '播放')}
              </button>
              <button type="button" className="al-btn al-viz__export" onClick={doExport} disabled={exporting}>
                {exporting ? <Loader2 size={16} className="al-spin" /> : <Film size={16} />}
                {exporting ? `${en ? 'Exporting' : '匯出中'} ${expPct}%` : (en ? 'Export video' : '匯出影片')}
              </button>
              {msg && <span className="al-viz__msg">{msg}</span>}
            </div>
            {exporting && <p className="al-viz__exphint">{en ? 'Recording plays the song through once — keep this tab focused.' : '匯出會把整首歌播放一次來錄製,過程請保持此視窗在前景。'}</p>}
          </div>

          <audio ref={audioRef} src={srcUrl ?? undefined} onEnded={() => setPlaying(false)} hidden />

          <div className="al-viz__controls">
            <div className="al-viz__group">
              <span className="al-viz__glabel">{en ? 'Template' : '模板'}</span>
              <div className="al-viz__tpls">
                {TEMPLATES.map((tp) => (
                  <button key={tp.key} type="button"
                          className={`al-viz__tpl${tplKey === tp.key ? ' is-on' : ''}`}
                          onClick={() => setTplKey(tp.key)}>
                    <Sparkles size={13} /> {en ? tp.labelEn : tp.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="al-viz__group">
              <span className="al-viz__glabel">{en ? 'Aspect' : '比例'}</span>
              <div className="al-viz__tpls">
                {ASPECTS.map((a) => (
                  <button key={a.key} type="button" className={`al-viz__tpl${aspect === a.key ? ' is-on' : ''}`}
                          onClick={() => setAspect(a.key)}>{a.label}</button>
                ))}
              </div>
            </div>

            <div className="al-viz__group al-viz__colors">
              <label>{en ? 'Background' : '背景'} <input type="color" value={params.bg} onChange={(e) => upd('bg', e.target.value)} /></label>
              <label>{en ? 'Accent' : '主色'} <input type="color" value={params.accent} onChange={(e) => upd('accent', e.target.value)} /></label>
              <label>{en ? 'Accent 2' : '副色'} <input type="color" value={params.accent2} onChange={(e) => upd('accent2', e.target.value)} /></label>
            </div>

            <div className="al-viz__group al-viz__sliders">
              <label>{en ? 'Sensitivity' : '靈敏度'} <input type="range" min={0.3} max={2} step={0.05} value={params.sensitivity} onChange={(e) => upd('sensitivity', Number(e.target.value))} /></label>
              <label>{en ? 'Beat shake' : '節拍抖動'} <input type="range" min={0} max={1} step={0.05} value={params.shake} onChange={(e) => upd('shake', Number(e.target.value))} /></label>
              <label>{en ? 'Glow / trails' : '光暈拖尾'} <input type="range" min={0} max={1} step={0.05} value={params.glow} onChange={(e) => upd('glow', Number(e.target.value))} /></label>
            </div>

            <div className="al-viz__group al-viz__intro">
              <span className="al-viz__glabel">{en ? 'Intro card' : '片頭'}</span>
              <input type="text" placeholder={en ? 'Song title' : '歌曲名'} value={intro.title} onChange={(e) => setIntro((i) => ({ ...i, title: e.target.value }))} />
              <input type="text" placeholder={en ? 'Artist (optional)' : '歌手(可選)'} value={intro.artist} onChange={(e) => setIntro((i) => ({ ...i, artist: e.target.value }))} />
              <label className="al-viz__introfade">{en ? 'Fade out after' : '幾秒後淡出'}
                <input type="number" min={0} max={30} step={1} value={intro.fadeSec} onChange={(e) => setIntro((i) => ({ ...i, fadeSec: Number(e.target.value) }))} /> s
              </label>
              <label className="al-viz__introtoggle">
                <input type="checkbox" checked={intro.show} onChange={(e) => setIntro((i) => ({ ...i, show: e.target.checked }))} /> {en ? 'Show intro' : '顯示片頭'}
              </label>
            </div>

            <div className="al-viz__group al-viz__sliders">
              <span className="al-viz__glabel">{en ? 'Effects' : '特效'}</span>
              <div className="al-viz__tpls">
                {(['none', 'h', 'quad'] as const).map((m) => (
                  <button key={m} type="button" className={`al-viz__tpl${fx.mirror === m ? ' is-on' : ''}`}
                          onClick={() => setFx((p) => ({ ...p, mirror: m }))}>
                    {m === 'none' ? (en ? 'No mirror' : '不鏡像') : m === 'h' ? (en ? 'Mirror' : '鏡像') : (en ? 'Kaleido' : '萬花筒')}
                  </button>
                ))}
              </div>
              <label>{en ? 'Vignette' : '暗角'} <input type="range" min={0} max={1} step={0.05} value={fx.vignette} onChange={(e) => setFx((p) => ({ ...p, vignette: Number(e.target.value) }))} /></label>
              <label>{en ? 'Grain' : '顆粒'} <input type="range" min={0} max={1} step={0.05} value={fx.grain} onChange={(e) => setFx((p) => ({ ...p, grain: Number(e.target.value) }))} /></label>
              <label>{en ? 'Beat flash' : '節拍閃光'} <input type="range" min={0} max={1} step={0.05} value={fx.flash} onChange={(e) => setFx((p) => ({ ...p, flash: Number(e.target.value) }))} /></label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
