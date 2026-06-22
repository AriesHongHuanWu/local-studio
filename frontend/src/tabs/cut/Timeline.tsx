/* ──────────────────────────────────────────────────────────────────
   Timeline — the multi-track editing surface. Click the ruler to seek,
   drag clips to reposition (snapping to edges + playhead, and across
   tracks of the same kind), trim by the edges. Clips show keyframe
   diamonds and transition badges. The playhead is moved imperatively.
   ────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Volume2, VolumeX, Trash2, Lock, Unlock, Film, Music2, Image as ImageIcon, Type, Square, ChevronUp, ChevronDown } from 'lucide-react';
import { useEditor, docDuration } from './useEditor';
import { getPeaks, onWaveformReady } from './waveform';
import { makeClip, DEFAULTS } from './types';
import type { Clip, ClipKind, Track } from './types';

/** Audio waveform drawn inside an audio/video clip on the timeline. */
function ClipWave({ src, inPoint, dur, speed, srcDuration, width }: { src: string; inPoint: number; dur: number; speed: number; srcDuration: number; width: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [ver, setVer] = useState(0);
  useEffect(() => onWaveformReady(() => setVer((v) => v + 1)), []);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const W = Math.max(1, Math.floor(width));
    cv.width = W; cv.height = 34;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, 34);
    const peaks = getPeaks(src);
    if (!peaks || !peaks.length || srcDuration <= 0) return;
    const i0 = Math.max(0, Math.min(peaks.length - 1, Math.floor((inPoint / srcDuration) * peaks.length)));
    const i1 = Math.max(i0 + 1, Math.min(peaks.length, Math.floor(Math.min(1, (inPoint + dur * Math.max(0.01, speed)) / srcDuration) * peaks.length)));
    const n = i1 - i0;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    for (let x = 0; x < W; x++) {
      const a = peaks[i0 + Math.floor((x / W) * n)] || 0;
      const h = Math.max(1, a * 30);
      ctx.fillRect(x, 17 - h / 2, 1, h);
    }
  }, [src, inPoint, dur, speed, srcDuration, width, ver]);
  return <canvas ref={ref} className="al-cut__wave" />;
}

const KIND_ICON: Record<ClipKind, typeof Film> = { video: Film, image: ImageIcon, audio: Music2, text: Type, shape: Square };

interface Props {
  pxPerSec: number;
  onSeek: (t: number) => void;
  cursorRef: React.RefObject<HTMLDivElement | null>;
  tool: 'select' | 'razor';
  en: boolean;
}

type DragMode = 'move' | 'left' | 'right';
const SNAP_PX = 8;

export function Timeline({ pxPerSec, onSeek, cursorRef, tool, en }: Props) {
  const doc = useEditor((s) => s.doc);
  const selectedId = useEditor((s) => s.selectedId);
  const select = useEditor((s) => s.select);
  const moveClip = useEditor((s) => s.moveClip);
  const trimClip = useEditor((s) => s.trimClip);
  const splitClip = useEditor((s) => s.splitClip);
  const removeMarker = useEditor((s) => s.removeMarker);
  const addClip = useEditor((s) => s.addClip);
  const addClipNewTrack = useEditor((s) => s.addClipNewTrack);
  const toggleTrack = useEditor((s) => s.toggleTrack);
  const removeTrack = useEditor((s) => s.removeTrack);
  const renameTrack = useEditor((s) => s.renameTrack);
  const moveTrack = useEditor((s) => s.moveTrack);

  const dur = docDuration(doc);
  const laneW = Math.max(640, (dur + 4) * pxPerSec);
  const drag = useRef<{ id: string; mode: DragMode; kind: string; startX: number; origStart: number; origDur: number } | null>(null);

  const pxRef = useRef(pxPerSec);
  pxRef.current = pxPerSec;

  // snap a time to nearby clip edges / playhead / markers / 0. Reads the store
  // live + pxRef so it has a STABLE identity (deps []), which keeps the drag
  // listeners alive across mid-drag re-renders.
  const snapTime = useCallback((t: number, selfId: string) => {
    const thr = SNAP_PX / pxRef.current;
    const st = useEditor.getState();
    const points = [0, st.playhead];
    for (const mk of st.doc.markers) points.push(mk.t);
    for (const tr of st.doc.tracks) for (const c of tr.clips) { if (c.id === selfId) continue; points.push(c.start); points.push(c.start + c.duration); }
    let best = t; let bestD = thr;
    for (const p of points) { const d = Math.abs(p - t); if (d < bestD) { bestD = d; best = p; } }
    return best;
  }, []);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dt = (e.clientX - d.startX) / pxRef.current;
    if (d.mode === 'move') {
      let start = Math.max(0, d.origStart + dt);
      const snappedStart = snapTime(start, d.id);
      const snappedEnd = snapTime(start + d.origDur, d.id) - d.origDur;
      start = Math.abs(snappedStart - start) <= Math.abs(snappedEnd - start) ? snappedStart : snappedEnd;
      start = Math.max(0, start);
      const lane = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('[data-trackid]') as HTMLElement | null;
      const destId = lane?.dataset.trackid;
      const destKind = lane?.dataset.kind;
      if (destId && destKind === d.kind) moveClip(d.id, start, destId);
      else moveClip(d.id, start);
    } else if (d.mode === 'left') {
      trimClip(d.id, 'left', snapTime(d.origStart + dt, d.id));
    } else {
      trimClip(d.id, 'right', snapTime(d.origStart + d.origDur + dt, d.id));
    }
  }, [moveClip, trimClip, snapTime]);

  const endDrag = useCallback(() => {
    drag.current = null;
    useEditor.getState().endGesture();
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endDrag);
  }, [onPointerMove]);

  useEffect(() => () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endDrag);
  }, [onPointerMove, endDrag]);

  const startDrag = (e: React.PointerEvent, c: Clip, mode: DragMode, kind: string, locked: boolean) => {
    e.stopPropagation();
    select(c.id);
    if (locked) return;
    // razor tool: a click on a clip body splits it at the click point
    if (mode === 'move' && tool === 'razor') {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      splitClip(c.id, c.start + (e.clientX - rect.left) / pxPerSec);
      return;
    }
    useEditor.getState().beginGesture(); // coalesce the whole drag into one undo step
    drag.current = { id: c.id, mode, kind, startX: e.clientX, origStart: c.start, origDur: c.duration };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
  };

  const seekAt = (e: React.MouseEvent, lane: HTMLElement | null) => {
    if (!lane) return;
    const rect = lane.getBoundingClientRect();
    onSeek(Math.max(0, (e.clientX - rect.left) / pxPerSec));
  };

  const onDropAsset = (e: React.DragEvent, tr: Track) => {
    const raw = e.dataTransfer.getData('application/al-asset');
    if (!raw) return;
    e.preventDefault();
    let a: { kind: ClipKind; name: string; src: string; srcDuration: number; duration: number };
    try { a = JSON.parse(raw); } catch { return; }
    const wantKind = a.kind === 'audio' ? 'audio' : 'visual';
    const rect = e.currentTarget.getBoundingClientRect();
    const t = Math.max(0, snapTime((e.clientX - rect.left) / pxRef.current, ''));
    const clip = makeClip(a.kind, { name: a.name, src: a.src, srcDuration: a.srcDuration, duration: a.kind === 'image' ? DEFAULTS.imageStill : a.duration, start: t });
    // drop on a matching track → add there; otherwise auto-create the right track
    if (tr.kind === wantKind && !tr.locked) addClip(tr.id, clip);
    else addClipNewTrack(wantKind, clip);
  };

  // drop a filter / effect / transition from the library onto a clip → apply it there
  const onDropFx = (e: React.DragEvent, c: Clip) => {
    const raw = e.dataTransfer.getData('application/al-fx');
    if (!raw) return;
    e.preventDefault();
    e.stopPropagation();
    let fx: { kind: string; f?: Clip['filters']; patch?: Partial<Clip>; type?: string };
    try { fx = JSON.parse(raw); } catch { return; }
    const st = useEditor.getState();
    if (fx.kind === 'filter' && fx.f) st.updateFilters(c.id, fx.f);
    else if (fx.kind === 'fx' && fx.patch) st.updateClip(c.id, fx.patch);
    else if (fx.kind === 'trans' && fx.type) {
      st.setTransition(c.id, 'transIn', { type: fx.type as Clip['transIn']['type'], dur: 0.6 });
      st.setTransition(c.id, 'transOut', { type: fx.type as Clip['transOut']['type'], dur: 0.6 });
    }
    st.select(c.id);
  };

  // drop onto the empty strip below the tracks → auto-create a track for it
  const onDropNewTrack = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData('application/al-asset');
    if (!raw) return;
    e.preventDefault();
    let a: { kind: ClipKind; name: string; src: string; srcDuration: number; duration: number };
    try { a = JSON.parse(raw); } catch { return; }
    const wantKind = a.kind === 'audio' ? 'audio' : 'visual';
    const rect = e.currentTarget.getBoundingClientRect();
    const t = Math.max(0, snapTime((e.clientX - rect.left) / pxRef.current, ''));
    addClipNewTrack(wantKind, makeClip(a.kind, { name: a.name, src: a.src, srcDuration: a.srcDuration, duration: a.kind === 'image' ? DEFAULTS.imageStill : a.duration, start: t }));
  };

  const step = pxPerSec < 14 ? 10 : pxPerSec < 30 ? 5 : pxPerSec < 70 ? 2 : 1;
  const ticks: number[] = [];
  for (let s = 0; s <= dur + 4; s += step) ticks.push(s);

  return (
    <div className={`al-cut__timeline${tool === 'razor' ? ' al-cut__timeline--razor' : ''}`}>
      <div className="al-cut__tlscroll">
        <div className="al-cut__lanes" style={{ width: laneW }}>
          <div className="al-cut__ruler" onMouseDown={(e) => seekAt(e, e.currentTarget)}>
            {ticks.map((s) => <span key={s} className="al-cut__tick" style={{ left: s * pxPerSec }}>{fmtTick(s)}</span>)}
            {doc.markers.map((mk) => (
              <span key={mk.id} className="al-cut__marker" style={{ left: mk.t * pxPerSec, background: mk.color }}
                    title="click = seek · double-click = remove"
                    onMouseDown={(e) => { e.stopPropagation(); onSeek(mk.t); }}
                    onDoubleClick={(e) => { e.stopPropagation(); removeMarker(mk.id); }} />
            ))}
          </div>

          {doc.tracks.map((tr) => (
            <div key={tr.id} className={`al-cut__lane al-cut__lane--${tr.kind}`}>
              <div className="al-cut__lanebg" data-trackid={tr.id} data-kind={tr.kind}
                   onMouseDown={(e) => { if (e.target === e.currentTarget) { select(null); seekAt(e, e.currentTarget); } }}
                   onDragOver={(e) => { if (e.dataTransfer.types.includes('application/al-asset')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; (e.currentTarget as HTMLElement).classList.add('is-drop'); } }}
                   onDragLeave={(e) => (e.currentTarget as HTMLElement).classList.remove('is-drop')}
                   onDrop={(e) => { (e.currentTarget as HTMLElement).classList.remove('is-drop'); onDropAsset(e, tr); }}>
                {tr.clips.map((c) => {
                  const Icon = KIND_ICON[c.kind];
                  const sel = c.id === selectedId;
                  const w = Math.max(8, c.duration * pxPerSec);
                  return (
                    <div key={c.id} className={`al-cut__clip${sel ? ' is-sel' : ''}${tr.locked ? ' is-locked' : ''}`}
                         style={{ left: c.start * pxPerSec, width: w }}
                         onPointerDown={(e) => startDrag(e, c, 'move', tr.kind, tr.locked)} title={c.name}
                         onDragOver={(e) => { if (e.dataTransfer.types.includes('application/al-fx')) { e.preventDefault(); e.stopPropagation(); (e.currentTarget as HTMLElement).classList.add('is-fxdrop'); } }}
                         onDragLeave={(e) => (e.currentTarget as HTMLElement).classList.remove('is-fxdrop')}
                         onDrop={(e) => { (e.currentTarget as HTMLElement).classList.remove('is-fxdrop'); onDropFx(e, c); }}>
                      {(c.kind === 'audio' || c.kind === 'video') && c.src && c.srcDuration > 0 && (
                        <ClipWave src={c.src} inPoint={c.inPoint} dur={c.duration} speed={c.speed} srcDuration={c.srcDuration} width={w} />
                      )}
                      <span className="al-cut__cliphandle al-cut__cliphandle--l" onPointerDown={(e) => startDrag(e, c, 'left', tr.kind, tr.locked)} />
                      {c.transIn.type !== 'none' && <span className="al-cut__trans al-cut__trans--l" />}
                      <span className="al-cut__cliplabel"><Icon size={12} /> {c.kind === 'text' ? (c.text || 'text').slice(0, 22) : c.name}</span>
                      {c.transOut.type !== 'none' && <span className="al-cut__trans al-cut__trans--r" />}
                      {c.keys.map((k, i) => <span key={i} className="al-cut__kfdot" style={{ left: Math.min(w - 4, k.t * pxPerSec) }} />)}
                      <span className="al-cut__cliphandle al-cut__cliphandle--r" onPointerDown={(e) => startDrag(e, c, 'right', tr.kind, tr.locked)} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="al-cut__droptrack"
               onDragOver={(e) => { if (e.dataTransfer.types.includes('application/al-asset')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; (e.currentTarget as HTMLElement).classList.add('is-drop'); } }}
               onDragLeave={(e) => (e.currentTarget as HTMLElement).classList.remove('is-drop')}
               onDrop={(e) => { (e.currentTarget as HTMLElement).classList.remove('is-drop'); onDropNewTrack(e); }}>
            <span>＋ {en ? 'Drop media here to add a track' : '把媒體拖到這裡自動新增軌道'}</span>
          </div>

          <div ref={cursorRef} className="al-cut__playhead" />
        </div>
      </div>

      <div className="al-cut__heads">
        <div className="al-cut__headspacer" />
        {doc.tracks.map((tr, i) => (
          <div key={tr.id} className={`al-cut__head al-cut__head--${tr.kind}`}>
            <input className="al-cut__headname" value={tr.name} onChange={(e) => renameTrack(tr.id, e.target.value)} spellCheck={false} />
            <div className="al-cut__headbtns">
              <button type="button" className="al-cut__headbtn" onClick={() => moveTrack(tr.id, -1)} disabled={i === 0} title="up"><ChevronUp size={12} /></button>
              <button type="button" className="al-cut__headbtn" onClick={() => moveTrack(tr.id, 1)} disabled={i === doc.tracks.length - 1} title="down"><ChevronDown size={12} /></button>
              <button type="button" className="al-cut__headbtn" onClick={() => toggleTrack(tr.id, tr.kind === 'audio' ? 'muted' : 'hidden')} title="toggle">
                {tr.kind === 'audio' ? (tr.muted ? <VolumeX size={12} /> : <Volume2 size={12} />) : (tr.hidden ? <EyeOff size={12} /> : <Eye size={12} />)}
              </button>
              <button type="button" className="al-cut__headbtn" onClick={() => toggleTrack(tr.id, 'locked')} title="lock">
                {tr.locked ? <Lock size={12} /> : <Unlock size={12} />}
              </button>
              <button type="button" className="al-cut__headbtn" onClick={() => removeTrack(tr.id)} title="remove"><Trash2 size={12} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function fmtTick(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m > 0 ? `${m}:${sec.toString().padStart(2, '0')}` : `${sec}s`;
}
