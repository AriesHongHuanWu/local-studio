/* ──────────────────────────────────────────────────────────────────
   useEditor — the editor document store (singleton, in-memory) with
   full undo/redo history and the complete timeline op set: add / move /
   trim / split / ripple-delete / duplicate / copy-paste clips, keyframes,
   transitions, speed, filters, tracks, and project settings.

   All mutating ops go through `apply()` which snapshots the previous doc
   onto the undo stack — so every edit is reversible. Source-range
   invariants (inPoint within [0, srcDuration]) are enforced on trim and
   split so playback never seeks past the media bounds.
   ────────────────────────────────────────────────────────────────── */

import { create } from 'zustand';
import type { Clip, EditDoc, Filters, Keyframe, Track, TrackKind, Trans, TextAnim } from './types';
import { docDuration, makeClip, uid } from './types';

function defaultDoc(): EditDoc {
  return {
    width: 1280, height: 720, fps: 30, bg: '#000000', markers: [],
    tracks: [
      { id: uid('trk'), kind: 'text', name: 'Text', muted: false, hidden: false, locked: false, clips: [] },
      { id: uid('trk'), kind: 'visual', name: 'V1', muted: false, hidden: false, locked: false, clips: [] },
      { id: uid('trk'), kind: 'audio', name: 'A1', muted: false, hidden: false, locked: false, clips: [] },
    ],
  };
}

const MIN_CLIP = 0.1;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const sortClips = (clips: Clip[]) => [...clips].sort((a, b) => a.start - b.start);

let gestureStartDoc: EditDoc | null = null; // pre-drag snapshot for cancelGesture

interface EditorState {
  doc: EditDoc;
  selectedId: string | null;
  playhead: number;
  past: EditDoc[];
  future: EditDoc[];
  clipboard: Clip | null;

  select: (id: string | null) => void;
  setPlayhead: (t: number) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // gesture coalescing: one undo entry per drag (on-canvas + slider drags)
  gesturing: boolean;
  beginGesture: () => void;
  liveUpdateClip: (id: string, patch: Partial<Clip>) => void;
  endGesture: () => void;
  cancelGesture: () => void;

  addClip: (trackId: string, clip: Clip) => void;
  addClipNewTrack: (kind: TrackKind, clip: Clip) => void;
  updateClip: (id: string, patch: Partial<Clip>) => void;
  updateFilters: (id: string, patch: Partial<Filters>) => void;
  moveClip: (id: string, newStart: number, newTrackId?: string) => void;
  trimClip: (id: string, side: 'left' | 'right', newEdge: number) => void;
  splitClip: (id: string, atTime: number) => void;
  removeClip: (id: string, ripple?: boolean) => void;
  duplicateClip: (id: string) => void;
  copyClip: (id: string) => void;
  paste: (atTime: number) => void;
  setSpeed: (id: string, speed: number) => void;
  setTransition: (id: string, which: 'transIn' | 'transOut', t: Trans) => void;
  setTextAnim: (id: string, which: 'animIn' | 'animOut', a: TextAnim) => void;

  addKey: (id: string, localT: number) => void;
  removeKeyNear: (id: string, localT: number) => void;
  clearKeys: (id: string) => void;

  addTrack: (kind: TrackKind) => void;
  removeTrack: (id: string) => void;
  toggleTrack: (id: string, key: 'muted' | 'hidden' | 'locked') => void;
  renameTrack: (id: string, name: string) => void;
  moveTrack: (id: string, dir: -1 | 1) => void;

  setSize: (w: number, h: number) => void;
  setFps: (fps: number) => void;
  setBg: (bg: string) => void;
  addMarker: (t: number) => void;
  removeMarker: (id: string) => void;
  clearMarkers: () => void;
  reset: () => void;
}

function findClip(doc: EditDoc, id: string): { track: Track; clip: Clip } | null {
  for (const track of doc.tracks) {
    const clip = track.clips.find((c) => c.id === id);
    if (clip) return { track, clip };
  }
  return null;
}

function mapClip(doc: EditDoc, id: string, fn: (c: Clip) => Clip): EditDoc {
  return { ...doc, tracks: doc.tracks.map((tr) => ({ ...tr, clips: tr.clips.map((c) => (c.id === id ? fn(c) : c)) })) };
}

export const useEditor = create<EditorState>((set, get) => {
  /** Apply a doc producer with undo-history; optional selection patch. */
  const apply = (producer: (d: EditDoc) => EditDoc, sel?: string | null) =>
    set((s) => {
      const next = producer(s.doc);
      const patch: Partial<EditorState> = sel !== undefined ? { selectedId: sel } : {};
      if (next === s.doc) return patch;
      // during a drag gesture the pre-drag snapshot is already on the stack — skip per-move history
      if (s.gesturing) return { ...patch, doc: next };
      return { ...patch, doc: next, past: [...s.past, s.doc].slice(-80), future: [] };
    });

  return {
    doc: defaultDoc(),
    selectedId: null,
    playhead: 0,
    past: [],
    future: [],
    clipboard: null,
    gesturing: false,

    select: (id) => set({ selectedId: id }),
    setPlayhead: (t) => set({ playhead: Math.max(0, t) }),
    undo: () => set((s) => { if (!s.past.length) return {}; const prev = s.past[s.past.length - 1]; return { doc: prev, past: s.past.slice(0, -1), future: [s.doc, ...s.future].slice(0, 80) }; }),
    redo: () => set((s) => { if (!s.future.length) return {}; const next = s.future[0]; return { doc: next, future: s.future.slice(1), past: [...s.past, s.doc].slice(-80) }; }),
    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

    // Snapshot once at gesture start (one undo entry); live updates skip history.
    beginGesture: () => set((s) => { gestureStartDoc = s.doc; return { gesturing: true, past: [...s.past, s.doc].slice(-80), future: [] }; }),
    liveUpdateClip: (id, patch) => set((s) => ({ doc: mapClip(s.doc, id, (c) => ({ ...c, ...patch })) })),
    endGesture: () => set({ gesturing: false }),
    cancelGesture: () => set((s) => (gestureStartDoc ? { doc: gestureStartDoc, past: s.past.slice(0, -1), gesturing: false } : { gesturing: false })),

    addClip: (trackId, clip) =>
      apply((d) => ({ ...d, tracks: d.tracks.map((tr) => (tr.id === trackId ? { ...tr, clips: sortClips([...tr.clips, clip]) } : tr)) }), clip.id),

    addClipNewTrack: (kind, clip) =>
      apply((d) => {
        const n = d.tracks.filter((t) => t.kind === kind).length + 1;
        const name = kind === 'visual' ? `V${n}` : kind === 'audio' ? `A${n}` : `Text ${n}`;
        const track: Track = { id: uid('trk'), kind, name, muted: false, hidden: false, locked: false, clips: [clip] };
        const tracks = kind === 'text' ? [track, ...d.tracks] : kind === 'audio' ? [...d.tracks, track] : insertVisual(d.tracks, track);
        return { ...d, tracks };
      }, clip.id),

    updateClip: (id, patch) => apply((d) => mapClip(d, id, (c) => ({ ...c, ...patch }))),
    updateFilters: (id, patch) => apply((d) => mapClip(d, id, (c) => ({ ...c, filters: { ...c.filters, ...patch } }))),

    moveClip: (id, newStart, newTrackId) =>
      apply((d) => {
        const found = findClip(d, id);
        if (!found) return d;
        const start = Math.max(0, newStart);
        if (!newTrackId || newTrackId === found.track.id) {
          return { ...d, tracks: d.tracks.map((tr) => (tr.id === found.track.id ? { ...tr, clips: sortClips(tr.clips.map((c) => (c.id === id ? { ...c, start } : c))) } : tr)) };
        }
        const dest = d.tracks.find((t) => t.id === newTrackId);
        if (!dest || dest.kind !== found.track.kind) return d;
        const moved = { ...found.clip, start };
        return {
          ...d,
          tracks: d.tracks.map((tr) => {
            if (tr.id === found.track.id) return { ...tr, clips: tr.clips.filter((c) => c.id !== id) };
            if (tr.id === newTrackId) return { ...tr, clips: sortClips([...tr.clips, moved]) };
            return tr;
          }),
        };
      }),

    trimClip: (id, side, newEdge) =>
      apply((d) => {
        const found = findClip(d, id);
        if (!found) return d;
        const c = found.clip;
        const hasSource = c.kind === 'video' || c.kind === 'audio';
        const sp = hasSource ? Math.max(0.01, c.speed) : 1;
        if (side === 'left') {
          const maxEdge = c.start + c.duration - MIN_CLIP;
          const edge = Math.min(Math.max(0, newEdge), maxEdge);
          let delta = edge - c.start; // >0 trims head in (source advances by delta*speed)
          if (hasSource) delta = Math.max(delta, -c.inPoint / sp); // can't expand before source 0
          const newStart = c.start + delta;
          const newIn = hasSource ? clamp(c.inPoint + delta * sp, 0, c.srcDuration > 0 ? c.srcDuration : c.inPoint + delta * sp) : c.inPoint;
          return mapClip(d, id, (cc) => ({ ...cc, start: newStart, duration: cc.duration - delta, inPoint: newIn }));
        }
        let dur = Math.max(MIN_CLIP, newEdge - c.start);
        if (hasSource && c.srcDuration > 0) dur = Math.min(dur, Math.max(MIN_CLIP, (c.srcDuration - c.inPoint) / sp));
        return mapClip(d, id, (cc) => ({ ...cc, duration: dur }));
      }),

    splitClip: (id, atTime) =>
      apply((d) => {
        const found = findClip(d, id);
        if (!found) return d;
        const c = found.clip;
        const off = atTime - c.start;
        if (off <= MIN_CLIP || off >= c.duration - MIN_CLIP) return d;
        const hasSource = c.kind === 'video' || c.kind === 'audio';
        const sp = hasSource ? Math.max(0.01, c.speed) : 1;
        // partition keyframes by the cut so each half keeps its animation
        const leftKeys = c.keys.filter((k) => k.t <= off);
        const rightKeys = c.keys.filter((k) => k.t > off).map((k) => ({ ...k, t: k.t - off }));
        const left: Clip = { ...c, duration: off, fadeOut: 0, transOut: { type: 'none', dur: 0.5 }, keys: leftKeys };
        const rightIn = hasSource ? clamp(c.inPoint + off * sp, 0, c.srcDuration > 0 ? c.srcDuration : c.inPoint + off * sp) : c.inPoint;
        const right: Clip = { ...c, id: uid('clip'), start: c.start + off, duration: c.duration - off, inPoint: rightIn, fadeIn: 0, transIn: { type: 'none', dur: 0.5 }, keys: rightKeys };
        return { ...d, tracks: d.tracks.map((tr) => (tr.id === found.track.id ? { ...tr, clips: sortClips([...tr.clips.filter((x) => x.id !== id), left, right]) } : tr)) };
      }, undefined),

    removeClip: (id, ripple) =>
      apply((d) => {
        const found = findClip(d, id);
        if (!found) return d;
        const gap = found.clip.duration;
        const after = found.clip.start;
        return {
          ...d,
          tracks: d.tracks.map((tr) => {
            if (tr.id !== found.track.id) return tr;
            let clips = tr.clips.filter((c) => c.id !== id);
            if (ripple) clips = clips.map((c) => (c.start > after ? { ...c, start: Math.max(0, c.start - gap) } : c));
            return { ...tr, clips: sortClips(clips) };
          }),
        };
      }, null),

    duplicateClip: (id) =>
      apply((d) => {
        const found = findClip(d, id);
        if (!found) return d;
        const copy: Clip = { ...found.clip, id: uid('clip'), start: found.clip.start + found.clip.duration };
        return { ...d, tracks: d.tracks.map((tr) => (tr.id === found.track.id ? { ...tr, clips: sortClips([...tr.clips, copy]) } : tr)) };
      }),

    copyClip: (id) => { const f = findClip(get().doc, id); if (f) set({ clipboard: { ...f.clip } }); },

    paste: (atTime) =>
      apply((d) => {
        const cb = get().clipboard;
        if (!cb) return d;
        const kind: TrackKind = cb.kind === 'audio' ? 'audio' : cb.kind === 'text' ? 'text' : 'visual';
        const track = d.tracks.find((t) => t.kind === kind);
        if (!track) return d;
        const copy: Clip = { ...cb, id: uid('clip'), start: Math.max(0, atTime) };
        return { ...d, tracks: d.tracks.map((tr) => (tr.id === track.id ? { ...tr, clips: sortClips([...tr.clips, copy]) } : tr)) };
      }),

    setSpeed: (id, speed) =>
      apply((d) => mapClip(d, id, (c) => {
        if (c.kind !== 'video' && c.kind !== 'audio') return c;
        const sp = clamp(speed, 0.25, 4);
        const used = c.duration * Math.max(0.01, c.speed); // source seconds consumed
        let dur = used / sp;
        if (c.srcDuration > 0) dur = Math.min(dur, (c.srcDuration - c.inPoint) / sp);
        return { ...c, speed: sp, duration: Math.max(MIN_CLIP, dur) };
      })),

    setTransition: (id, which, t) => apply((d) => mapClip(d, id, (c) => ({ ...c, [which]: t }))),
    setTextAnim: (id, which, a) => apply((d) => mapClip(d, id, (c) => ({ ...c, [which]: a }))),

    addKey: (id, localT) =>
      apply((d) => mapClip(d, id, (c) => {
        const key: Keyframe = { t: Math.max(0, localT), x: c.x, y: c.y, scale: c.scale, rotation: c.rotation, opacity: c.opacity };
        const keys = c.keys.filter((k) => Math.abs(k.t - key.t) > 0.04);
        return { ...c, keys: [...keys, key].sort((a, b) => a.t - b.t) };
      })),
    removeKeyNear: (id, localT) => apply((d) => mapClip(d, id, (c) => ({ ...c, keys: c.keys.filter((k) => Math.abs(k.t - localT) > 0.12) }))),
    clearKeys: (id) => apply((d) => mapClip(d, id, (c) => ({ ...c, keys: [] }))),

    addTrack: (kind) =>
      apply((d) => {
        const n = d.tracks.filter((t) => t.kind === kind).length + 1;
        const name = kind === 'visual' ? `V${n}` : kind === 'audio' ? `A${n}` : `Text ${n}`;
        const track: Track = { id: uid('trk'), kind, name, muted: false, hidden: false, locked: false, clips: [] };
        const tracks = kind === 'text' ? [track, ...d.tracks] : kind === 'audio' ? [...d.tracks, track] : insertVisual(d.tracks, track);
        return { ...d, tracks };
      }),

    removeTrack: (id) => apply((d) => (d.tracks.length <= 1 ? d : { ...d, tracks: d.tracks.filter((t) => t.id !== id) })),
    toggleTrack: (id, key) => apply((d) => ({ ...d, tracks: d.tracks.map((t) => (t.id === id ? { ...t, [key]: !t[key] } : t)) })),
    renameTrack: (id, name) => apply((d) => ({ ...d, tracks: d.tracks.map((t) => (t.id === id ? { ...t, name } : t)) })),
    moveTrack: (id, dir) => apply((d) => {
      const i = d.tracks.findIndex((t) => t.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.tracks.length) return d;
      const tracks = [...d.tracks];
      [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
      return { ...d, tracks };
    }),

    setSize: (w, h) => apply((d) => ({ ...d, width: w, height: h })),
    setFps: (fps) => apply((d) => ({ ...d, fps })),
    setBg: (bg) => apply((d) => ({ ...d, bg })),
    addMarker: (t) => apply((d) => ({ ...d, markers: [...d.markers, { id: uid('mk'), t: Math.max(0, t), label: '', color: '#d8a657' }].sort((a, b) => a.t - b.t) })),
    removeMarker: (id) => apply((d) => ({ ...d, markers: d.markers.filter((mk) => mk.id !== id) })),
    clearMarkers: () => apply((d) => ({ ...d, markers: [] })),
    reset: () => set({ doc: defaultDoc(), selectedId: null, playhead: 0, past: [], future: [] }),
  };
});

function insertVisual(tracks: Track[], track: Track): Track[] {
  const lastVisual = tracks.map((t) => t.kind).lastIndexOf('visual');
  if (lastVisual < 0) {
    const firstAudio = tracks.findIndex((t) => t.kind === 'audio');
    const at = firstAudio < 0 ? tracks.length : firstAudio;
    return [...tracks.slice(0, at), track, ...tracks.slice(at)];
  }
  return [...tracks.slice(0, lastVisual + 1), track, ...tracks.slice(lastVisual + 1)];
}

export { docDuration, makeClip };
