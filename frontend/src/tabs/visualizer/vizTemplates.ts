/* ──────────────────────────────────────────────────────────────────
   Visualizer templates — pure Canvas2D render functions driven by a
   real-time Web Audio AnalyserNode. Each template is `draw(ctx, frame)`;
   the host runs it every rAF for preview AND during the MediaRecorder
   export (same code path → WYSIWYG). High-quality, GPU-free, reliable.
   ────────────────────────────────────────────────────────────────── */

export interface VizParams {
  bg: string;          // background color
  accent: string;      // primary accent
  accent2: string;     // secondary accent (gradients)
  sensitivity: number; // 0.3..2 — reactivity gain
  shake: number;       // 0..1 — beat-driven camera shake
  glow: number;        // 0..1 — bloom amount
}

export interface VizFrame {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  freq: Uint8Array;    // 0..255 spectrum
  time: Uint8Array;    // 0..255 waveform
  t: number;           // elapsed seconds
  level: number;       // 0..1 overall RMS-ish
  bass: number;        // 0..1 low-band energy
  beat: number;        // 0..1 decaying beat envelope (1 right after a hit)
  params: VizParams;
}

export interface VizTemplate {
  key: string;
  label: string;
  labelEn: string;
  draw: (f: VizFrame) => void;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return [255, 255, 255];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}
function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a); const [r2, g2, b2] = hexToRgb(b);
  return `rgb(${Math.round(r1 + (r2 - r1) * t)},${Math.round(g1 + (g2 - g1) * t)},${Math.round(b1 + (b2 - b1) * t)})`;
}

/** Apply a beat-driven shake transform (host wraps the draw between save/restore). */
function applyShake(f: VizFrame): void {
  const s = f.params.shake * f.beat * 18;
  if (s > 0.2) {
    const a = f.t * 53.7;
    f.ctx.translate(Math.sin(a) * s, Math.cos(a * 1.3) * s);
  }
}

// ── Template 1: mirrored spectrum bars ──────────────────────────────
const bars: VizTemplate = {
  key: 'bars', label: '頻譜柱', labelEn: 'Spectrum bars',
  draw: (f) => {
    const { ctx, w, h, freq, params } = f;
    applyShake(f);
    const n = 64;
    const step = Math.floor(freq.length / n);
    const bw = w / n;
    const cy = h * 0.62;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const v = (freq[i * step] / 255) * params.sensitivity;
      const bh = Math.pow(v, 1.4) * h * 0.42;
      const x = i * bw;
      const grad = ctx.createLinearGradient(0, cy - bh, 0, cy + bh);
      grad.addColorStop(0, rgba(params.accent2, 0.95));
      grad.addColorStop(0.5, rgba(params.accent, 0.95));
      grad.addColorStop(1, rgba(params.accent2, 0.95));
      ctx.fillStyle = grad;
      const pad = bw * 0.16;
      ctx.fillRect(x + pad, cy - bh, bw - pad * 2, bh * 2);            // mirrored
    }
    ctx.globalCompositeOperation = 'source-over';
    // floor reflection glow
    if (params.glow > 0) {
      ctx.fillStyle = rgba(params.accent, 0.05 + 0.12 * f.level * params.glow);
      ctx.fillRect(0, cy, w, h - cy);
    }
  },
};

// ── Template 2: radial pulse orb ────────────────────────────────────
const radial: VizTemplate = {
  key: 'radial', label: '脈動光球', labelEn: 'Radial pulse',
  draw: (f) => {
    const { ctx, w, h, freq, params } = f;
    applyShake(f);
    const cx = w / 2, cy = h / 2;
    const base = Math.min(w, h) * 0.16;
    const r = base * (1 + f.bass * 0.6 * params.sensitivity);
    // glow orb
    const og = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * (1.8 + f.beat));
    og.addColorStop(0, rgba(params.accent, 0.9));
    og.addColorStop(0.4, rgba(params.accent, 0.35 + 0.4 * f.beat));
    og.addColorStop(1, rgba(params.accent, 0));
    ctx.fillStyle = og;
    ctx.beginPath(); ctx.arc(cx, cy, r * (1.8 + f.beat), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = mix(params.accent, '#ffffff', 0.5);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    // radial spectrum spokes
    const n = 96;
    const step = Math.floor(freq.length / n);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = Math.max(1.5, w / 600);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + f.t * 0.15;
      const v = (freq[i * step] / 255) * params.sensitivity;
      const len = r * 0.6 + Math.pow(v, 1.3) * Math.min(w, h) * 0.32;
      ctx.strokeStyle = rgba(i % 2 ? params.accent2 : params.accent, 0.85);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r * 1.05), cy + Math.sin(a) * (r * 1.05));
      ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  },
};

// ── Template 3: waveform ribbon ─────────────────────────────────────
const ribbon: VizTemplate = {
  key: 'ribbon', label: '波形帶', labelEn: 'Waveform ribbon',
  draw: (f) => {
    const { ctx, w, h, time, params } = f;
    applyShake(f);
    const cy = h / 2;
    const amp = h * 0.3 * (0.5 + f.level * params.sensitivity);
    ctx.globalCompositeOperation = 'lighter';
    for (let pass = 0; pass < 3; pass++) {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const idx = Math.floor((x / w) * time.length);
        const v = (time[idx] - 128) / 128;
        const y = cy + v * amp * (1 - pass * 0.25) + Math.sin(x * 0.01 + f.t * 2 + pass) * 6;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(pass === 0 ? params.accent : params.accent2, 0.85 - pass * 0.25);
      ctx.lineWidth = (3 - pass) * Math.max(1, w / 900);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  },
};

// ── Template 4: particle field ──────────────────────────────────────
interface P { x: number; y: number; vx: number; vy: number; life: number; }
let particles: P[] = [];
const field: VizTemplate = {
  key: 'particles', label: '粒子場', labelEn: 'Particle field',
  draw: (f) => {
    const { ctx, w, h, params } = f;
    applyShake(f);
    // emit on beat
    const emit = Math.floor(f.beat * 8 + f.level * 3);
    for (let i = 0; i < emit && particles.length < 600; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (1 + f.bass * 6) * (1 + Math.random());
      particles.push({ x: w / 2, y: h / 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1 });
    }
    ctx.globalCompositeOperation = 'lighter';
    particles = particles.filter((p) => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.02; p.life -= 0.012;
      if (p.life <= 0) return false;
      const r = 2 + p.life * 4 * (1 + f.bass);
      ctx.fillStyle = rgba(p.life > 0.5 ? params.accent : params.accent2, p.life * 0.9);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      return true;
    });
    ctx.globalCompositeOperation = 'source-over';
  },
};

// ── Template 5: concentric rings (beat-spawned) ─────────────────────
let rings: { r: number; life: number }[] = [];
const ringsT: VizTemplate = {
  key: 'rings', label: '同心圓環', labelEn: 'Concentric rings',
  draw: (f) => {
    const { ctx, w, h, params } = f;
    applyShake(f);
    const cx = w / 2, cy = h / 2;
    if (f.beat > 0.6) rings.push({ r: Math.min(w, h) * 0.08, life: 1 });
    ctx.globalCompositeOperation = 'lighter';
    rings = rings.filter((rg) => {
      rg.r += (4 + f.level * 10) * (1 + params.sensitivity * 0.5); rg.life -= 0.012;
      if (rg.life <= 0) return false;
      ctx.strokeStyle = rgba(params.accent, rg.life * 0.8);
      ctx.lineWidth = (2 + rg.life * 6) * Math.max(1, w / 900);
      ctx.beginPath(); ctx.arc(cx, cy, rg.r, 0, Math.PI * 2); ctx.stroke();
      return true;
    });
    // steady pulsing core
    const cr = Math.min(w, h) * 0.05 * (1 + f.bass * 1.2 * params.sensitivity);
    ctx.fillStyle = rgba(params.accent2, 0.9);
    ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  },
};

// ── Template 6: beat-reactive object (shaking polygon) ──────────────
const objectT: VizTemplate = {
  key: 'object', label: '抖動物體', labelEn: 'Bouncing object',
  draw: (f) => {
    const { ctx, w, h, params } = f;
    const cx = w / 2, cy = h / 2;
    const sides = 6;
    const base = Math.min(w, h) * 0.18;
    const scale = base * (1 + (f.bass * 0.5 + f.beat * 0.35) * params.sensitivity);
    const rot = f.t * 0.5 + f.beat * 0.5;
    const jitter = f.beat * params.shake * 14;
    ctx.save();
    ctx.translate(cx + (Math.random() - 0.5) * jitter, cy + (Math.random() - 0.5) * jitter);
    ctx.rotate(rot);
    // glow
    ctx.shadowColor = params.accent; ctx.shadowBlur = 30 + 60 * f.beat * params.glow;
    const grad = ctx.createLinearGradient(-scale, -scale, scale, scale);
    grad.addColorStop(0, params.accent); grad.addColorStop(1, params.accent2);
    ctx.fillStyle = grad;
    ctx.beginPath();
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const rr = scale * (1 + 0.12 * Math.sin(a * 3 + f.t * 4) * f.level);
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill();
    // inner ring
    ctx.shadowBlur = 0; ctx.strokeStyle = rgba('#ffffff', 0.5 + 0.5 * f.beat); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, scale * 0.5, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  },
};

// ── Template 7: starfield tunnel ────────────────────────────────────
let stars: { x: number; y: number; z: number }[] = [];
const starfield: VizTemplate = {
  key: 'starfield', label: '星空隧道', labelEn: 'Starfield tunnel',
  draw: (f) => {
    const { ctx, w, h, params } = f;
    applyShake(f);
    const cx = w / 2, cy = h / 2;
    if (stars.length < 320) for (let i = 0; i < 6; i++) stars.push({ x: (Math.random() - 0.5) * w, y: (Math.random() - 0.5) * h, z: Math.random() });
    const speed = 0.004 + (f.level * 0.03 + f.beat * 0.02) * params.sensitivity;
    ctx.globalCompositeOperation = 'lighter';
    stars = stars.filter((s) => {
      s.z -= speed; if (s.z <= 0.02) return false;
      const px = cx + s.x / s.z, py = cy + s.y / s.z;
      if (px < 0 || px > w || py < 0 || py > h) return false;
      const r = (1 - s.z) * 3.2;
      ctx.fillStyle = rgba((s.z < 0.4 ? params.accent : params.accent2), (1 - s.z) * 0.9);
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
      return true;
    });
    ctx.globalCompositeOperation = 'source-over';
  },
};

// ── Template 8: frequency terrain (scrolling) ───────────────────────
let terrainRows: number[][] = [];
const terrain: VizTemplate = {
  key: 'terrain', label: '頻率地形', labelEn: 'Frequency terrain',
  draw: (f) => {
    const { ctx, w, h, freq, params } = f;
    const cols = 48;
    const step = Math.floor(freq.length / cols);
    const row: number[] = [];
    for (let i = 0; i < cols; i++) row.push((freq[i * step] / 255) * params.sensitivity);
    terrainRows.unshift(row);
    if (terrainRows.length > 26) terrainRows.pop();
    ctx.globalCompositeOperation = 'lighter';
    for (let r = terrainRows.length - 1; r >= 0; r--) {
      const depth = r / 26;
      const y0 = h * 0.45 + depth * h * 0.5;
      const sc = 1 - depth * 0.55;
      ctx.beginPath();
      for (let i = 0; i < cols; i++) {
        const x = w / 2 + (i - cols / 2) * (w / cols) * sc;
        const y = y0 - terrainRows[r][i] * h * 0.22 * sc;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(mix(params.accent2, params.accent, 1 - depth), (1 - depth) * 0.7);
      ctx.lineWidth = Math.max(1, (1 - depth) * 2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  },
};

// ── Template 9: spectrum bloom (radial mandala) ─────────────────────
const bloom: VizTemplate = {
  key: 'bloom', label: '光譜花', labelEn: 'Spectrum bloom',
  draw: (f) => {
    const { ctx, w, h, freq, params } = f;
    applyShake(f);
    const cx = w / 2, cy = h / 2;
    const petals = 48;
    const step = Math.floor(freq.length / petals);
    const baseR = Math.min(w, h) * 0.12 * (1 + f.bass * 0.4);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = Math.max(1.5, w / 500);
    for (let mirror = 0; mirror < 2; mirror++) {
      for (let i = 0; i < petals; i++) {
        const v = (freq[i * step] / 255) * params.sensitivity;
        const a = ((mirror ? -i : i) / petals) * Math.PI * 2 + f.t * 0.2;
        const len = baseR + Math.pow(v, 1.2) * Math.min(w, h) * 0.3;
        const x = cx + Math.cos(a) * len, y = cy + Math.sin(a) * len;
        ctx.strokeStyle = rgba(i % 3 === 0 ? params.accent : params.accent2, 0.7);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * baseR, cy + Math.sin(a) * baseR);
        ctx.quadraticCurveTo(cx + Math.cos(a + 0.1) * len * 0.7, cy + Math.sin(a + 0.1) * len * 0.7, x, y);
        ctx.stroke();
      }
    }
    ctx.fillStyle = mix(params.accent, '#ffffff', 0.6);
    ctx.beginPath(); ctx.arc(cx, cy, baseR * 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  },
};

// ── Post-effects layer — applies on top of any template, baked into the
//    bitmap (so it exports). Mirror / kaleidoscope, vignette, grain, flash.
export interface VizEffects {
  mirror: 'none' | 'h' | 'quad';
  vignette: number;  // 0..1
  grain: number;     // 0..1
  flash: number;     // 0..1 beat flash
}

export function applyEffects(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  beat: number, accent: string, fx: VizEffects,
): void {
  if (fx.mirror === 'h' || fx.mirror === 'quad') {
    ctx.save(); ctx.scale(-1, 1);
    ctx.drawImage(ctx.canvas, 0, 0, w / 2, h, -w, 0, w / 2, h);   // left → right
    ctx.restore();
  }
  if (fx.mirror === 'quad') {
    ctx.save(); ctx.scale(1, -1);
    ctx.drawImage(ctx.canvas, 0, 0, w, h / 2, 0, -h, w, h / 2);   // top → bottom
    ctx.restore();
  }
  if (fx.flash > 0 && beat > 0.5) {
    ctx.fillStyle = rgba(accent, beat * fx.flash * 0.3);
    ctx.fillRect(0, 0, w, h);
  }
  if (fx.vignette > 0) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.28, w / 2, h / 2, Math.max(w, h) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${fx.vignette})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
  if (fx.grain > 0) {
    const n = Math.floor(fx.grain * w * h / 3400);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.07 * fx.grain})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
    }
  }
}

export const TEMPLATES: VizTemplate[] = [radial, bars, ribbon, field, ringsT, objectT, starfield, terrain, bloom];

export function resetTemplateState(): void { particles = []; rings = []; stars = []; terrainRows = []; }
