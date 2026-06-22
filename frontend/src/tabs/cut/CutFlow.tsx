/* ──────────────────────────────────────────────────────────────────
   CutFlow — the in-app video editor (剪輯室). A CapCut-class multitrack
   NLE that ties the whole studio together: media + audio + subtitles +
   shapes + stickers on a timeline, with keyframes, transitions, filters,
   chroma key, speed, animated text, undo/redo and keyboard shortcuts.
   The preview canvas IS the render (MediaRecorder → MP4).
   ────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, Film, Loader2, Scissors, ZoomIn, ZoomOut, Plus, RotateCcw, Undo2, Redo2, Keyboard, Slice, Flag, Camera, MousePointer2 } from 'lucide-react';
import { useLang } from '../../i18n';
import { useEditor, docDuration } from './useEditor';
import { usePlayback } from './usePlayback';
import { useShortcuts } from './useShortcuts';
import { Timeline } from './Timeline';
import { Inspector } from './Inspector';
import { LibraryPanel } from './LibraryPanel';
import { PreviewOverlay } from './PreviewOverlay';
import { AddToProject } from '../catalog/AddToProject';
import './cut.css';

const ASPECTS = ['16:9', '9:16', '1:1'] as const;
type AspectKey = typeof ASPECTS[number];

function sizeFor(aspect: AspectKey, quality: number): { w: number; h: number } {
  if (aspect === '9:16') return { w: Math.round((quality * 9) / 16), h: quality };
  if (aspect === '1:1') return { w: quality, h: quality };
  return { w: Math.round((quality * 16) / 9), h: quality };
}
function aspectOf(w: number, h: number): AspectKey {
  const r = w / h;
  if (Math.abs(r - 9 / 16) < 0.05) return '9:16';
  if (Math.abs(r - 1) < 0.05) return '1:1';
  return '16:9';
}

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t % 1) * 100);
  return `${m}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

function Clock({ getTime, total }: { getTime: () => number; total: number }) {
  const [t, setT] = useState(0);
  useEffect(() => { const id = window.setInterval(() => setT(getTime()), 100); return () => window.clearInterval(id); }, [getTime]);
  return <span className="al-cut__clock">{fmt(t)} <span className="al-cut__clockdim">/ {fmt(total)}</span></span>;
}

const SHORTCUTS: [string, string, string][] = [
  ['Space', '播放 / 暫停', 'Play / pause'],
  ['S', '切割', 'Split at playhead'],
  ['Del', '刪除片段', 'Delete clip'],
  ['⌘/Ctrl + Z', '復原', 'Undo'],
  ['⌘/Ctrl + ⇧ + Z', '重做', 'Redo'],
  ['⌘/Ctrl + C / V', '複製 / 貼上', 'Copy / paste'],
  ['⌘/Ctrl + D', '製作副本', 'Duplicate'],
  ['← / →', '移動播放頭', 'Nudge playhead'],
  ['+ / −', '縮放時間軸', 'Zoom timeline'],
  ['?', '快捷鍵說明', 'This help'],
];

export function CutFlow() {
  const en = useLang() === 'en';
  const doc = useEditor((s) => s.doc);
  const setSize = useEditor((s) => s.setSize);
  const setBg = useEditor((s) => s.setBg);
  const addTrack = useEditor((s) => s.addTrack);
  const reset = useEditor((s) => s.reset);
  const addMarker = useEditor((s) => s.addMarker);
  const clearMarkers = useEditor((s) => s.clearMarkers);
  const markerCount = useEditor((s) => s.doc.markers.length);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);

  const [pxPerSec, setPxPerSec] = useState(40);
  const [name, setName] = useState('edit');
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [quality, setQuality] = useState(720);
  const [fps, setFps] = useState(30);
  const [format, setFormat] = useState<'mp4' | 'webm'>('mp4');
  const [help, setHelp] = useState(false);
  const [tool, setTool] = useState<'select' | 'razor'>('select');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const poolRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef<HTMLDivElement | null>(null);

  const pb = usePlayback({ canvasRef, poolRef, cursorRef, pxPerSec, onExported: setExportPath });

  const aspect = aspectOf(doc.width, doc.height);
  const setAspect = (a: AspectKey) => { const s = sizeFor(a, quality); setSize(s.w, s.h); };
  const setQ = (q: number) => { setQuality(q); const s = sizeFor(aspect, q); setSize(s.w, s.h); };

  const onSplit = useCallback(() => {
    const id = useEditor.getState().selectedId;
    if (id) useEditor.getState().splitClip(id, pb.getTime());
  }, [pb]);

  const bitrate = Math.round(Math.min(48_000_000, Math.max(6_000_000, doc.width * doc.height * fps * 0.12)));
  const doExport = useCallback(() => { void pb.exportVideoHQ({ name, fps, bitrate, format }); }, [pb, name, fps, format, bitrate]);
  const doQuick = useCallback(() => { void pb.exportVideo({ name, fps, bitrate, format }); }, [pb, name, fps, format, bitrate]);

  const handlers = useMemo(() => ({
    togglePlay: pb.toggle,
    split: onSplit,
    del: () => { const id = useEditor.getState().selectedId; if (id) useEditor.getState().removeClip(id); },
    undo, redo,
    copy: () => { const id = useEditor.getState().selectedId; if (id) useEditor.getState().copyClip(id); },
    paste: () => useEditor.getState().paste(pb.getTime()),
    duplicate: () => { const id = useEditor.getState().selectedId; if (id) useEditor.getState().duplicateClip(id); },
    nudge: (dir: number, big: boolean) => pb.seekTo(pb.getTime() + dir * (big ? 1 : 1 / (useEditor.getState().doc.fps || 30))),
    zoom: (dir: number) => setPxPerSec((p) => Math.max(8, Math.min(200, dir > 0 ? p * 1.4 : p / 1.4))),
    help: () => setHelp((h) => !h),
  }), [pb, onSplit, undo, redo]);
  useShortcuts(handlers, true);

  return (
    <div className="al-tabpage al-cut">
      <div className="al-tabpage__head">
        <h1 className="al-tabpage__title">{en ? 'Editor' : '剪輯室 Editor'}</h1>
        <p className="al-tabpage__lede">{en
          ? 'A full multitrack video editor — keyframes, transitions, filters, chroma key, animated captions, shapes, speed and keyboard shortcuts. All local.'
          : '完整多軌影片剪輯 — 關鍵影格、轉場、濾鏡、去背、動畫字幕、形狀、變速、快捷鍵。全程本機。'}</p>
      </div>

      <div className="al-cut__main">
        <aside className="al-cut__side"><LibraryPanel en={en} getTime={pb.getTime} /></aside>

        <section className="al-cut__stage">
          <div className="al-cut__canvaswrap" data-aspect={aspect}>
            <canvas ref={canvasRef} width={doc.width} height={doc.height} className="al-cut__canvas" onClick={pb.toggle} />
            <PreviewOverlay getBox={pb.getSelectedBox} canvasRef={canvasRef} />
          </div>
          <div className="al-cut__transport">
            <button type="button" className="al-cut__icbtn" onClick={undo} disabled={!canUndo} title={en ? 'Undo' : '復原'}><Undo2 size={15} /></button>
            <button type="button" className="al-cut__icbtn" onClick={redo} disabled={!canRedo} title={en ? 'Redo' : '重做'}><Redo2 size={15} /></button>
            <button type="button" className="al-btn al-btn--primary al-btn--sm" onClick={pb.toggle} disabled={pb.exporting}>
              {pb.playing ? <Pause size={15} /> : <Play size={15} />}{pb.playing ? (en ? 'Pause' : '暫停') : (en ? 'Play' : '播放')}
            </button>
            <button type="button" className="al-btn al-btn--ghost al-btn--sm" onClick={onSplit} disabled={pb.exporting}><Scissors size={14} />{en ? 'Split' : '切割'}</button>
            <Clock getTime={pb.getTime} total={docDuration(doc)} />
            <button type="button" className="al-cut__icbtn" onClick={() => setHelp(true)} title={en ? 'Shortcuts' : '快捷鍵'}><Keyboard size={15} /></button>
            <span className="al-cut__spacer" />
            {!pb.exporting && (
              <button type="button" className="al-btn al-btn--ghost al-btn--sm" onClick={doQuick} title={en ? 'Quick real-time export' : '快速即時匯出'}>{en ? 'Quick' : '快速'}</button>
            )}
            <button type="button" className="al-btn al-cut__export al-btn--sm" onClick={doExport} disabled={pb.exporting}>
              {pb.exporting ? <Loader2 size={14} className="al-spin" /> : <Film size={14} />}
              {pb.exporting ? `${en ? 'Exporting' : '匯出中'} ${pb.expPct}%` : `${en ? 'Export' : '匯出'}${pb.hqAvailable ? ' · GPU' : ''}`}
            </button>
          </div>
          <div className="al-cut__exprow">
            <input className="al-cut__namein" value={name} onChange={(e) => setName(e.target.value)} aria-label="export name" />
            <select className="al-cut__select al-cut__select--sm" value={quality} onChange={(e) => setQ(Number(e.target.value))}>
              <option value={720}>720p</option><option value={1080}>1080p</option>
            </select>
            <select className="al-cut__select al-cut__select--sm" value={fps} onChange={(e) => setFps(Number(e.target.value))}>
              <option value={24}>24fps</option><option value={30}>30fps</option><option value={60}>60fps</option>
            </select>
            <select className="al-cut__select al-cut__select--sm" value={format} onChange={(e) => setFormat(e.target.value as 'mp4' | 'webm')}>
              <option value="mp4">MP4</option><option value="webm">WebM</option>
            </select>
            <button type="button" className="al-btn al-btn--ghost al-btn--sm" onClick={() => void pb.exportAudio(name)} disabled={pb.exporting} title={en ? 'Export audio only (WAV)' : '只匯出音訊 (WAV)'}>WAV</button>
          </div>
          {pb.exporting && <p className="al-cut__exphint">{en ? 'Rendering at full quality — keep this window focused. GPU export renders offline (faster than real-time for stills/captions).' : '正在以最高品質輸出 — 請保持此視窗在前景。GPU 匯出為離線算圖(靜態/字幕快於即時)。'}</p>}
          {pb.msg === 'saved' && !pb.exporting && (
            <div className="al-cut__saved">
              <span>{en ? 'Exported ✓' : '已匯出 ✓'}</span>
              {exportPath && <AddToProject item={{ kind: 'video', label: `${name}.${format}`, path: exportPath, format }} defaultName={name} />}
            </div>
          )}
          {pb.msg === 'failed' && <p className="al-cut__exphint">{en ? 'Export failed — try a shorter timeline.' : '匯出失敗 — 試試較短的時間軸。'}</p>}
          {pb.msg === 'empty' && <p className="al-cut__exphint">{en ? 'Add some clips first.' : '先加入一些片段。'}</p>}
        </section>

        <aside className="al-cut__side"><Inspector en={en} onSplit={onSplit} getTime={pb.getTime} /></aside>
      </div>

      <div className="al-cut__tools">
        <div className="al-cut__toolgroup">
          <button type="button" className={`al-cut__tbtn${tool === 'select' ? ' is-on' : ''}`} onClick={() => setTool('select')} title={en ? 'Select tool' : '選取工具'}><MousePointer2 size={14} /></button>
          <button type="button" className={`al-cut__tbtn${tool === 'razor' ? ' is-on' : ''}`} onClick={() => setTool('razor')} title={en ? 'Razor — click a clip to split' : '刀片 — 點片段切割'}><Slice size={14} /></button>
        </div>
        <div className="al-cut__toolgroup">
          <button type="button" className="al-cut__tbtn" onClick={() => addMarker(pb.getTime())} title={en ? 'Add marker at playhead' : '在播放頭加標記'}><Flag size={13} /> {markerCount > 0 ? markerCount : ''}</button>
          {markerCount > 0 && <button type="button" className="al-cut__tbtn" onClick={clearMarkers} title={en ? 'Clear markers' : '清除標記'}><RotateCcw size={12} /></button>}
          <button type="button" className="al-cut__tbtn" onClick={() => void pb.snapshot()} title={en ? 'Save current frame (PNG)' : '存目前畫格 (PNG)'}><Camera size={13} /></button>
        </div>
        <div className="al-cut__toolgroup">
          <button type="button" className="al-cut__tbtn" onClick={() => setPxPerSec((p) => Math.max(8, p / 1.4))} title="zoom out"><ZoomOut size={14} /></button>
          <button type="button" className="al-cut__tbtn" onClick={() => setPxPerSec((p) => Math.min(200, p * 1.4))} title="zoom in"><ZoomIn size={14} /></button>
        </div>
        <div className="al-cut__toolgroup">
          <button type="button" className="al-cut__tbtn" onClick={() => addTrack('visual')}><Plus size={13} /> {en ? 'Video' : '影片軌'}</button>
          <button type="button" className="al-cut__tbtn" onClick={() => addTrack('audio')}><Plus size={13} /> {en ? 'Audio' : '音訊軌'}</button>
          <button type="button" className="al-cut__tbtn" onClick={() => addTrack('text')}><Plus size={13} /> {en ? 'Text' : '文字軌'}</button>
        </div>
        <span className="al-cut__spacer" />
        <div className="al-cut__toolgroup">
          {ASPECTS.map((a) => <button key={a} type="button" className={`al-cut__tbtn${aspect === a ? ' is-on' : ''}`} onClick={() => setAspect(a)}>{a}</button>)}
          <label className="al-cut__bg">{en ? 'BG' : '背景'} <input type="color" value={doc.bg} onChange={(e) => setBg(e.target.value)} /></label>
          <button type="button" className="al-cut__tbtn" onClick={() => { if (confirm(en ? 'Clear the timeline?' : '清空時間軸?')) reset(); }} title="reset"><RotateCcw size={13} /></button>
        </div>
      </div>

      <Timeline pxPerSec={pxPerSec} onSeek={pb.seekTo} cursorRef={cursorRef} tool={tool} en={en} />

      <div ref={poolRef} className="al-cut__pool" aria-hidden="true" />

      {help && (
        <div className="al-cut__overlay" onClick={() => setHelp(false)}>
          <div className="al-cut__sheet" onClick={(e) => e.stopPropagation()}>
            <h3>{en ? 'Keyboard shortcuts' : '鍵盤快捷鍵'}</h3>
            <table className="al-cut__sclist">
              <tbody>
                {SHORTCUTS.map(([key, zh, eng]) => (
                  <tr key={key}><td className="al-cut__sckey">{key}</td><td>{en ? eng : zh}</td></tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="al-btn al-btn--ghost al-btn--sm" onClick={() => setHelp(false)}>{en ? 'Close' : '關閉'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
