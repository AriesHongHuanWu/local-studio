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

export const TEMPLATES: VizTemplate[] = [radial, bars, ribbon, field];

export function resetTemplateState(): void { particles = []; }
