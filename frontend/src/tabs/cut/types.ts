/* ──────────────────────────────────────────────────────────────────
   Editor (剪輯室) data model — a CapCut-class NLE document.

   A document is a stack of TRACKS; each track holds CLIPS on a shared
   seconds-based timeline. Track kinds: visual (video / image / shape,
   composited top-over-bottom), audio (summed with gain), text (timed
   overlays on top). Clips carry the full pro feature set: transform +
   keyframes, filters/adjustments, blend modes, chroma key, speed,
   transitions, and rich text styling/animation.
   ────────────────────────────────────────────────────────────────── */

export type ClipKind = 'video' | 'image' | 'audio' | 'text' | 'shape';
export type TrackKind = 'visual' | 'audio' | 'text';
export type TextAlign = 'left' | 'center' | 'right';
export type ShapeType = 'rect' | 'ellipse' | 'line';
export type TransType = 'none' | 'fade' | 'slideL' | 'slideR' | 'slideU' | 'slideD' | 'zoom' | 'wipe' | 'spin' | 'blur';
export type TextAnim = 'none' | 'fade' | 'up' | 'down' | 'left' | 'right' | 'pop' | 'type';

/** A keyframe snapshots the animatable transform at a clip-local time. */
export interface Keyframe {
  t: number; // seconds, relative to clip start
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}

export interface Filters {
  brightness: number; // 1 = neutral
  contrast: number; // 1
  saturate: number; // 1
  hue: number; // deg, 0
  blur: number; // px, 0
  sepia: number; // 0..1
  grayscale: number; // 0..1
  invert: number; // 0..1
}

export interface Chroma {
  on: boolean;
  color: string; // key color
  threshold: number; // 0..1
  smooth: number; // 0..1
}

export interface Trans {
  type: TransType;
  dur: number; // seconds
}

export function neutralFilters(): Filters {
  return { brightness: 1, contrast: 1, saturate: 1, hue: 0, blur: 0, sepia: 0, grayscale: 0, invert: 0 };
}

export interface Clip {
  id: string;
  kind: ClipKind;
  name: string;
  src?: string; // object-URL (video/image/audio); undefined for text/shape

  start: number; // timeline position, seconds
  duration: number; // length on the timeline, seconds
  inPoint: number; // source trim head, seconds (video/audio)
  srcDuration: number; // natural source length, seconds (0 for text/shape)

  /* transform (static base; overridden by keyframes when present) */
  x: number;
  y: number;
  scale: number;
  rotation: number; // deg
  opacity: number;
  flipH: boolean;
  flipV: boolean;

  /* look */
  filters: Filters;
  blend: GlobalCompositeOperation;
  chroma: Chroma;
  mask: 'none' | 'circle' | 'rounded';
  glitch: number; // 0..1 digital slice displacement
  scan: number; // 0..1 scanline overlay

  /* timing */
  speed: number; // 1 = normal (video/audio)
  transIn: Trans;
  transOut: Trans;
  keys: Keyframe[]; // animation; empty = static transform

  /* audio */
  gain: number;
  fadeIn: number;
  fadeOut: number;

  /* text */
  text: string;
  fontSize: number;
  color: string;
  align: TextAlign;
  bold: boolean;
  italic: boolean;
  font: string; // css family
  stroke: number; // px outline (0 = none)
  strokeColor: string;
  shadow: number; // 0..1 drop shadow strength
  box: number; // 0..1 backdrop opacity
  letterSpacing: number; // px
  lineHeight: number; // multiple of font size
  posY: number; // vertical anchor, 0 (top) .. 1 (bottom)
  grad: boolean; // gradient fill
  gradColor: string; // gradient bottom colour
  animIn: TextAnim;
  animOut: TextAnim;
  animDur: number;

  /* shape */
  shapeType: ShapeType;
  fill: string;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  hidden: boolean;
  locked: boolean;
  clips: Clip[];
}

export interface EditDoc {
  tracks: Track[];
  width: number;
  height: number;
  fps: number;
  bg: string;
}

/** A media item in the asset bin (resolved metadata, reused by clips). */
export interface Asset {
  id: string;
  name: string;
  kind: ClipKind; // video | image | audio
  src: string;
  duration: number;
  w?: number;
  h?: number;
}

let _seq = 0;
export function uid(prefix: string): string {
  _seq += 1;
  return `${prefix}_${_seq.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export const DEFAULTS = { imageStill: 5, textDur: 3, shapeDur: 4, fps: 30 } as const;

export function makeClip(kind: ClipKind, over: Partial<Clip>): Clip {
  return {
    id: uid('clip'),
    kind,
    name: over.name ?? kind,
    src: over.src,
    start: over.start ?? 0,
    duration: over.duration ?? (kind === 'image' ? DEFAULTS.imageStill : kind === 'text' ? DEFAULTS.textDur : kind === 'shape' ? DEFAULTS.shapeDur : 1),
    inPoint: over.inPoint ?? 0,
    srcDuration: over.srcDuration ?? 0,
    x: over.x ?? 0,
    y: over.y ?? 0,
    scale: over.scale ?? 1,
    rotation: over.rotation ?? 0,
    opacity: over.opacity ?? 1,
    flipH: over.flipH ?? false,
    flipV: over.flipV ?? false,
    filters: over.filters ?? neutralFilters(),
    blend: over.blend ?? 'source-over',
    chroma: over.chroma ?? { on: false, color: '#00ff00', threshold: 0.4, smooth: 0.1 },
    mask: over.mask ?? 'none',
    glitch: over.glitch ?? 0,
    scan: over.scan ?? 0,
    speed: over.speed ?? 1,
    transIn: over.transIn ?? { type: 'none', dur: 0.5 },
    transOut: over.transOut ?? { type: 'none', dur: 0.5 },
    keys: over.keys ?? [],
    gain: over.gain ?? 1,
    fadeIn: over.fadeIn ?? 0,
    fadeOut: over.fadeOut ?? 0,
    text: over.text ?? '',
    fontSize: over.fontSize ?? 56,
    color: over.color ?? '#ffffff',
    align: over.align ?? 'center',
    bold: over.bold ?? true,
    italic: over.italic ?? false,
    font: over.font ?? 'Inter, system-ui, sans-serif',
    stroke: over.stroke ?? 3,
    strokeColor: over.strokeColor ?? '#000000',
    shadow: over.shadow ?? 0.3,
    box: over.box ?? 0,
    letterSpacing: over.letterSpacing ?? 0,
    lineHeight: over.lineHeight ?? 1.25,
    posY: over.posY ?? 0.84,
    grad: over.grad ?? false,
    gradColor: over.gradColor ?? '#b9852f',
    animIn: over.animIn ?? 'none',
    animOut: over.animOut ?? 'none',
    animDur: over.animDur ?? 0.4,
    shapeType: over.shapeType ?? 'rect',
    fill: over.fill ?? '#d8a657',
  };
}

export function docDuration(doc: EditDoc): number {
  let end = 0;
  for (const tr of doc.tracks) for (const c of tr.clips) end = Math.max(end, c.start + c.duration);
  return end;
}
