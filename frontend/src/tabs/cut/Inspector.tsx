/* ──────────────────────────────────────────────────────────────────
   Inspector — the full property panel for the selected clip, organised
   into tabs that adapt to the clip kind: Transform (+ keyframes), Look
   (filters / looks / blend / chroma), Motion (transitions / animation /
   speed), Audio, Text, Shape.
   ────────────────────────────────────────────────────────────────── */

import { useState } from 'react';
import { Copy, Scissors, Trash2, Clipboard, Diamond, FlipHorizontal2, FlipVertical2 } from 'lucide-react';
import { useEditor } from './useEditor';
import { LOOKS, TRANSITIONS, TEXT_ANIMS, BLEND_MODES, FONTS, TEXT_PRESETS, SHAKES, KEN_BURNS, kenBurns } from './effects';
import { neutralFilters } from './types';
import type { Clip } from './types';

/** The list of effects currently applied to a clip, each with a "clear" patch. */
function activeEffects(c: Clip, en: boolean): { key: string; label: string; clear: Partial<Clip> }[] {
  const out: { key: string; label: string; clear: Partial<Clip> }[] = [];
  const f = c.filters;
  if (f.brightness !== 1 || f.contrast !== 1 || f.saturate !== 1 || f.hue !== 0 || f.blur !== 0 || f.sepia !== 0 || f.grayscale !== 0 || f.invert !== 0)
    out.push({ key: 'filter', label: en ? 'Filter' : '濾鏡', clear: { filters: neutralFilters() } });
  if (c.glitch > 0) out.push({ key: 'glitch', label: en ? 'Glitch' : '故障', clear: { glitch: 0 } });
  if (c.scan > 0) out.push({ key: 'scan', label: en ? 'Scanlines' : '掃描線', clear: { scan: 0 } });
  if (c.shake.mode !== 'none') out.push({ key: 'shake', label: en ? 'Shake' : '晃動', clear: { shake: { mode: 'none', amount: 0.3, speed: 1 } } });
  if (c.chroma.on) out.push({ key: 'chroma', label: en ? 'Chroma' : '去背', clear: { chroma: { ...c.chroma, on: false } } });
  if (c.mask !== 'none') out.push({ key: 'mask', label: en ? 'Mask' : '遮罩', clear: { mask: 'none' } });
  if (c.transIn.type !== 'none' || c.transOut.type !== 'none') out.push({ key: 'trans', label: en ? 'Transition' : '轉場', clear: { transIn: { type: 'none', dur: 0.5 }, transOut: { type: 'none', dur: 0.5 } } });
  if (c.frame.shadow > 0 || c.frame.border > 0 || c.frame.radius > 0) out.push({ key: 'frame', label: en ? 'Frame' : '外框', clear: { frame: { shadow: 0, border: 0, borderColor: c.frame.borderColor, radius: 0 } } });
  if (c.keys.length > 0) out.push({ key: 'keys', label: en ? 'Keyframes' : '關鍵影格', clear: { keys: [] } });
  if (c.kind === 'text' && c.karaoke) out.push({ key: 'karaoke', label: en ? 'Karaoke' : '卡拉OK', clear: { karaoke: false } });
  return out;
}

interface Props {
  en: boolean;
  onSplit: () => void;
  getTime: () => number;
}

type Tab = 'transform' | 'look' | 'motion' | 'audio' | 'text';

function Slider({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="al-cut__row">
      <span className="al-cut__rowlabel">{label}<em>{value.toFixed(step < 1 ? 2 : 0)}</em></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function Inspector({ en, onSplit, getTime }: Props) {
  const doc = useEditor((s) => s.doc);
  const selectedId = useEditor((s) => s.selectedId);
  const updateClip = useEditor((s) => s.updateClip);
  const updateFilters = useEditor((s) => s.updateFilters);
  const removeClip = useEditor((s) => s.removeClip);
  const duplicateClip = useEditor((s) => s.duplicateClip);
  const copyClip = useEditor((s) => s.copyClip);
  const setSpeed = useEditor((s) => s.setSpeed);
  const setTransition = useEditor((s) => s.setTransition);
  const setTextAnim = useEditor((s) => s.setTextAnim);
  const addKey = useEditor((s) => s.addKey);
  const clearKeys = useEditor((s) => s.clearKeys);
  const [tab, setTab] = useState<Tab>('transform');

  let clip: Clip | null = null;
  for (const tr of doc.tracks) { const f = tr.clips.find((c) => c.id === selectedId); if (f) { clip = f; break; } }
  if (!clip) return <div className="al-cut__inspector al-cut__inspector--empty">{en ? 'Select a clip to edit.' : '點選片段來編輯。'}</div>;
  const c = clip;
  const up = (patch: Partial<Clip>) => updateClip(c.id, patch);
  const isMedia = c.kind === 'video' || c.kind === 'image';
  const hasAudio = c.kind === 'video' || c.kind === 'audio';
  const transformable = isMedia || c.kind === 'text' || c.kind === 'shape';

  const tabs: Tab[] = [];
  if (transformable) tabs.push('transform');
  if (isMedia) tabs.push('look');
  if (isMedia || c.kind === 'text') tabs.push('motion');
  if (hasAudio) tabs.push('audio');
  if (c.kind === 'text') tabs.push('text');
  const active = tabs.includes(tab) ? tab : tabs[0];
  const localT = Math.max(0, getTime() - c.start);

  const TAB_LABEL: Record<Tab, [string, string]> = {
    transform: ['變形', 'Transform'], look: ['濾鏡', 'Look'], motion: ['動態', 'Motion'],
    audio: ['音訊', 'Audio'], text: ['文字', 'Text'],
  };

  return (
    <div className="al-cut__inspector">
      <div className="al-cut__insphead">
        <strong>{c.kind === 'text' ? (en ? 'Text' : '文字') : c.kind === 'shape' ? (en ? 'Shape' : '形狀') : c.name}</strong>
        <span className="al-cut__inspspan">{c.start.toFixed(2)}s → {(c.start + c.duration).toFixed(2)}s</span>
      </div>
      <div className="al-cut__inspactions">
        <button type="button" className="al-btn al-btn--ghost al-btn--sm" onClick={onSplit}><Scissors size={12} />{en ? 'Split' : '切割'}</button>
        <button type="button" className="al-btn al-btn--ghost al-btn--sm" onClick={() => duplicateClip(c.id)}><Copy size={12} /></button>
        <button type="button" className="al-btn al-btn--ghost al-btn--sm" onClick={() => copyClip(c.id)}><Clipboard size={12} /></button>
        <button type="button" className="al-btn al-btn--danger al-btn--sm" onClick={() => removeClip(c.id)}><Trash2 size={12} /></button>
      </div>

      {(() => {
        const fx = activeEffects(c, en);
        return fx.length > 0 ? (
          <div className="al-cut__fxstack">
            <span className="al-cut__rowlabel">{en ? 'Applied effects' : '已套用特效'}</span>
            <div className="al-cut__fxlist">
              {fx.map((e) => (
                <span key={e.key} className="al-cut__fxchip">{e.label}<button type="button" onClick={() => up(e.clear)} title={en ? 'remove' : '移除'}>×</button></span>
              ))}
            </div>
          </div>
        ) : null;
      })()}

      <div className="al-cut__insptabs">
        {tabs.map((tk) => (
          <button key={tk} type="button" className={`al-cut__insptab${active === tk ? ' is-on' : ''}`} onClick={() => setTab(tk)}>
            {en ? TAB_LABEL[tk][1] : TAB_LABEL[tk][0]}
          </button>
        ))}
      </div>

      <div className="al-cut__inspbody">
        {active === 'transform' && (
          <>
            <Slider label={en ? 'Scale' : '縮放'} min={0.05} max={4} step={0.01} value={c.scale} onChange={(v) => up({ scale: v })} />
            <div className="al-cut__row2">
              <label className="al-cut__rowmini">X <input type="range" min={-960} max={960} step={2} value={c.x} onChange={(e) => up({ x: Number(e.target.value) })} /></label>
              <label className="al-cut__rowmini">Y <input type="range" min={-960} max={960} step={2} value={c.y} onChange={(e) => up({ y: Number(e.target.value) })} /></label>
            </div>
            <Slider label={en ? 'Rotation' : '旋轉'} min={-180} max={180} step={1} value={c.rotation} onChange={(v) => up({ rotation: v })} />
            <Slider label={en ? 'Opacity' : '不透明度'} min={0} max={1} step={0.02} value={c.opacity} onChange={(v) => up({ opacity: v })} />
            {isMedia && (
              <>
                <div className="al-cut__row2">
                  <button type="button" className={`al-btn al-btn--ghost al-btn--sm${c.flipH ? ' is-on' : ''}`} onClick={() => up({ flipH: !c.flipH })}><FlipHorizontal2 size={13} />{en ? 'Flip H' : '水平翻'}</button>
                  <button type="button" className={`al-btn al-btn--ghost al-btn--sm${c.flipV ? ' is-on' : ''}`} onClick={() => up({ flipV: !c.flipV })}><FlipVertical2 size={13} />{en ? 'Flip V' : '垂直翻'}</button>
                </div>
                <span className="al-cut__rowlabel">{en ? 'Position / PiP' : '位置 / 子母畫面'}</span>
                <div className="al-cut__seg">
                  <button type="button" className="al-cut__segbtn" onClick={() => up({ scale: 1, x: 0, y: 0 })} title={en ? 'Center' : '置中'}>◼</button>
                  <button type="button" className="al-cut__segbtn" onClick={() => up({ scale: 0.34, x: -doc.width * 0.32, y: -doc.height * 0.30 })} title="PiP ↖">◤</button>
                  <button type="button" className="al-cut__segbtn" onClick={() => up({ scale: 0.34, x: doc.width * 0.32, y: -doc.height * 0.30 })} title="PiP ↗">◥</button>
                  <button type="button" className="al-cut__segbtn" onClick={() => up({ scale: 0.34, x: -doc.width * 0.32, y: doc.height * 0.30 })} title="PiP ↙">◣</button>
                  <button type="button" className="al-cut__segbtn" onClick={() => up({ scale: 0.34, x: doc.width * 0.32, y: doc.height * 0.30 })} title="PiP ↘">◢</button>
                </div>
              </>
            )}
            <div className="al-cut__kf">
              <button type="button" className="al-btn al-btn--ghost al-btn--sm" onClick={() => addKey(c.id, localT)} title={en ? 'Add keyframe at playhead' : '在播放頭加關鍵影格'}><Diamond size={12} />{en ? 'Keyframe' : '關鍵影格'}</button>
              <span className="al-cut__kfcount">{c.keys.length}</span>
              {c.keys.length > 0 && <button type="button" className="al-btn al-btn--ghost al-btn--sm" onClick={() => clearKeys(c.id)}>{en ? 'Clear' : '清除'}</button>}
            </div>
            <p className="al-cut__hinttiny">{en ? 'Set values, add a keyframe, move the playhead, change values, add another — it animates between.' : '設好數值→加關鍵影格→移動播放頭→改數值→再加一個,中間自動補間。'}</p>
          </>
        )}

        {active === 'look' && (
          <>
            <div className="al-cut__chips">
              {LOOKS.map((l) => (
                <button key={l.key} type="button" className="al-cut__chip" onClick={() => updateFilters(c.id, l.f)}>{en ? l.en : l.label}</button>
              ))}
            </div>
            <Slider label={en ? 'Brightness' : '亮度'} min={0.2} max={2} step={0.02} value={c.filters.brightness} onChange={(v) => updateFilters(c.id, { brightness: v })} />
            <Slider label={en ? 'Contrast' : '對比'} min={0.2} max={2} step={0.02} value={c.filters.contrast} onChange={(v) => updateFilters(c.id, { contrast: v })} />
            <Slider label={en ? 'Saturation' : '飽和'} min={0} max={2.5} step={0.02} value={c.filters.saturate} onChange={(v) => updateFilters(c.id, { saturate: v })} />
            <Slider label={en ? 'Hue' : '色相'} min={-180} max={180} step={1} value={c.filters.hue} onChange={(v) => updateFilters(c.id, { hue: v })} />
            <Slider label={en ? 'Blur' : '模糊'} min={0} max={20} step={0.5} value={c.filters.blur} onChange={(v) => updateFilters(c.id, { blur: v })} />
            <Slider label={en ? 'Glitch' : '故障'} min={0} max={1} step={0.02} value={c.glitch} onChange={(v) => up({ glitch: v })} />
            <Slider label={en ? 'Scanlines' : '掃描線'} min={0} max={1} step={0.02} value={c.scan} onChange={(v) => up({ scan: v })} />
            <label className="al-cut__row">
              <span className="al-cut__rowlabel">{en ? 'Mask' : '遮罩'}</span>
              <div className="al-cut__seg">
                {(['none', 'circle', 'rounded'] as const).map((mk) => (
                  <button key={mk} type="button" className={`al-cut__segbtn${c.mask === mk ? ' is-on' : ''}`} onClick={() => up({ mask: mk })}>{mk === 'none' ? (en ? 'None' : '無') : mk === 'circle' ? '◯' : '▢'}</button>
                ))}
              </div>
            </label>
            <label className="al-cut__row">
              <span className="al-cut__rowlabel">{en ? 'Blend' : '混合'}</span>
              <select className="al-cut__select" value={c.blend} onChange={(e) => up({ blend: e.target.value as GlobalCompositeOperation })}>
                {BLEND_MODES.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
              </select>
            </label>
            <label className="al-cut__rowmini"><input type="checkbox" checked={c.chroma.on} onChange={(e) => up({ chroma: { ...c.chroma, on: e.target.checked } })} /> {en ? 'Chroma key (green screen)' : '去背(綠幕)'}</label>
            {c.chroma.on && (
              <>
                <label className="al-cut__rowmini">{en ? 'Key color' : '去背色'} <input type="color" value={c.chroma.color} onChange={(e) => up({ chroma: { ...c.chroma, color: e.target.value } })} /></label>
                <Slider label={en ? 'Threshold' : '門檻'} min={0.05} max={0.9} step={0.02} value={c.chroma.threshold} onChange={(v) => up({ chroma: { ...c.chroma, threshold: v } })} />
                <Slider label={en ? 'Smooth' : '羽化'} min={0} max={0.5} step={0.02} value={c.chroma.smooth} onChange={(v) => up({ chroma: { ...c.chroma, smooth: v } })} />
              </>
            )}
            <span className="al-cut__rowlabel">{en ? 'PiP frame' : '子母畫面外框'}</span>
            <Slider label={en ? 'Shadow' : '陰影'} min={0} max={1} step={0.05} value={c.frame.shadow} onChange={(v) => up({ frame: { ...c.frame, shadow: v } })} />
            <Slider label={en ? 'Border' : '外框'} min={0} max={24} step={1} value={c.frame.border} onChange={(v) => up({ frame: { ...c.frame, border: v } })} />
            {c.frame.border > 0 && <label className="al-cut__rowmini">{en ? 'Border color' : '外框色'} <input type="color" value={c.frame.borderColor} onChange={(e) => up({ frame: { ...c.frame, borderColor: e.target.value } })} /></label>}
            <Slider label={en ? 'Corner radius' : '圓角'} min={0} max={240} step={2} value={c.frame.radius} onChange={(v) => up({ frame: { ...c.frame, radius: v } })} />
          </>
        )}

        {active === 'motion' && (
          <>
            {isMedia && (
              <>
                <label className="al-cut__row"><span className="al-cut__rowlabel">{en ? 'Transition in' : '入場轉場'}</span>
                  <select className="al-cut__select" value={c.transIn.type} onChange={(e) => setTransition(c.id, 'transIn', { ...c.transIn, type: e.target.value as Clip['transIn']['type'] })}>
                    {TRANSITIONS.map((tt) => <option key={tt.key} value={tt.key}>{en ? tt.en : tt.label}</option>)}
                  </select>
                </label>
                <label className="al-cut__row"><span className="al-cut__rowlabel">{en ? 'Transition out' : '出場轉場'}</span>
                  <select className="al-cut__select" value={c.transOut.type} onChange={(e) => setTransition(c.id, 'transOut', { ...c.transOut, type: e.target.value as Clip['transOut']['type'] })}>
                    {TRANSITIONS.map((tt) => <option key={tt.key} value={tt.key}>{en ? tt.en : tt.label}</option>)}
                  </select>
                </label>
                <Slider label={en ? 'Trans. length' : '轉場時長'} min={0.1} max={3} step={0.1} value={c.transIn.dur} onChange={(v) => { setTransition(c.id, 'transIn', { ...c.transIn, dur: v }); setTransition(c.id, 'transOut', { ...c.transOut, dur: v }); }} />
              </>
            )}
            {(isMedia || c.kind === 'shape') && (
              <>
                <span className="al-cut__rowlabel">{en ? 'Camera shake' : '鏡頭晃動'}</span>
                <div className="al-cut__chips">
                  {SHAKES.map((s) => <button key={s.key} type="button" className={`al-cut__chip${c.shake.mode === s.key ? ' is-on' : ''}`} onClick={() => up({ shake: { ...c.shake, mode: s.key } })}>{en ? s.en : s.label}</button>)}
                </div>
                {c.shake.mode !== 'none' && (
                  <>
                    <Slider label={en ? 'Amount' : '強度'} min={0} max={1} step={0.02} value={c.shake.amount} onChange={(v) => up({ shake: { ...c.shake, amount: v } })} />
                    <Slider label={en ? 'Speed' : '速度'} min={0.2} max={4} step={0.1} value={c.shake.speed} onChange={(v) => up({ shake: { ...c.shake, speed: v } })} />
                  </>
                )}
              </>
            )}
            {isMedia && (
              <>
                <span className="al-cut__rowlabel">{en ? 'Ken Burns' : '緩慢推拉'}</span>
                <div className="al-cut__chips">
                  {KEN_BURNS.map((k) => <button key={k.key} type="button" className="al-cut__chip" onClick={() => updateClip(c.id, { keys: kenBurns(c.duration, k.key) })}>{en ? k.en : k.label}</button>)}
                  {c.keys.length > 0 && <button type="button" className="al-cut__chip" onClick={() => clearKeys(c.id)}>{en ? 'Clear' : '清除'}</button>}
                </div>
              </>
            )}
            {c.kind === 'text' && (
              <>
                <label className="al-cut__row"><span className="al-cut__rowlabel">{en ? 'Animate in' : '入場動畫'}</span>
                  <select className="al-cut__select" value={c.animIn} onChange={(e) => setTextAnim(c.id, 'animIn', e.target.value as Clip['animIn'])}>
                    {TEXT_ANIMS.map((tt) => <option key={tt.key} value={tt.key}>{en ? tt.en : tt.label}</option>)}
                  </select>
                </label>
                <label className="al-cut__row"><span className="al-cut__rowlabel">{en ? 'Animate out' : '出場動畫'}</span>
                  <select className="al-cut__select" value={c.animOut} onChange={(e) => setTextAnim(c.id, 'animOut', e.target.value as Clip['animOut'])}>
                    {TEXT_ANIMS.map((tt) => <option key={tt.key} value={tt.key}>{en ? tt.en : tt.label}</option>)}
                  </select>
                </label>
                <Slider label={en ? 'Anim length' : '動畫時長'} min={0.1} max={2} step={0.05} value={c.animDur} onChange={(v) => up({ animDur: v })} />
              </>
            )}
            {hasAudio && <Slider label={en ? 'Speed' : '速度'} min={0.25} max={4} step={0.05} value={c.speed} onChange={(v) => setSpeed(c.id, v)} />}
          </>
        )}

        {active === 'audio' && (
          <>
            <Slider label={en ? 'Volume' : '音量'} min={0} max={2} step={0.02} value={c.gain} onChange={(v) => up({ gain: v })} />
            <Slider label={en ? 'Fade in' : '淡入'} min={0} max={Math.max(0.5, c.duration / 2)} step={0.05} value={c.fadeIn} onChange={(v) => up({ fadeIn: v })} />
            <Slider label={en ? 'Fade out' : '淡出'} min={0} max={Math.max(0.5, c.duration / 2)} step={0.05} value={c.fadeOut} onChange={(v) => up({ fadeOut: v })} />
          </>
        )}

        {active === 'text' && (
          <>
            <textarea className="al-cut__ta" rows={2} value={c.text} onChange={(e) => up({ text: e.target.value })} />
            <div className="al-cut__chips">
              {TEXT_PRESETS.map((p) => <button key={p.key} type="button" className="al-cut__chip" onClick={() => up(p.over)}>{en ? p.en : p.label}</button>)}
            </div>
            {c.words.length > 0 && (
              <div className="al-cut__row2">
                <label className="al-cut__rowmini"><input type="checkbox" checked={c.karaoke} onChange={(e) => up({ karaoke: e.target.checked })} /> {en ? 'Karaoke (word-sync)' : '卡拉OK 逐字'}</label>
                {c.karaoke && <label className="al-cut__rowmini">{en ? 'Sung color' : '已唱色'} <input type="color" value={c.sungColor} onChange={(e) => up({ sungColor: e.target.value })} /></label>}
              </div>
            )}
            <label className="al-cut__row"><span className="al-cut__rowlabel">{en ? 'Font' : '字體'}</span>
              <select className="al-cut__select" value={c.font} onChange={(e) => up({ font: e.target.value })}>
                {FONTS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </label>
            <Slider label={en ? 'Size' : '字級'} min={16} max={200} step={1} value={c.fontSize} onChange={(v) => up({ fontSize: v })} />
            <div className="al-cut__row2">
              <label className="al-cut__rowmini">{en ? 'Color' : '顏色'} <input type="color" value={c.color} onChange={(e) => up({ color: e.target.value })} /></label>
              <label className="al-cut__rowmini"><input type="checkbox" checked={c.bold} onChange={(e) => up({ bold: e.target.checked })} /> {en ? 'Bold' : '粗'}</label>
              <label className="al-cut__rowmini"><input type="checkbox" checked={c.italic} onChange={(e) => up({ italic: e.target.checked })} /> {en ? 'Italic' : '斜'}</label>
            </div>
            <div className="al-cut__seg">
              {(['left', 'center', 'right'] as const).map((al) => (
                <button key={al} type="button" className={`al-cut__segbtn${c.align === al ? ' is-on' : ''}`} onClick={() => up({ align: al })}>{al === 'left' ? '⟸' : al === 'center' ? '≡' : '⟹'}</button>
              ))}
            </div>
            <div className="al-cut__seg">
              {([['top', 0.15], ['center', 0.5], ['bottom', 0.84]] as const).map(([lab, v]) => (
                <button key={lab} type="button" className={`al-cut__segbtn${Math.abs(c.posY - v) < 0.02 ? ' is-on' : ''}`} onClick={() => up({ posY: v })}>{lab === 'top' ? (en ? 'Top' : '上') : lab === 'center' ? (en ? 'Mid' : '中') : (en ? 'Low' : '下')}</button>
              ))}
            </div>
            <Slider label={en ? 'Letter spacing' : '字距'} min={-2} max={20} step={0.5} value={c.letterSpacing} onChange={(v) => up({ letterSpacing: v })} />
            <Slider label={en ? 'Line height' : '行距'} min={0.9} max={2} step={0.05} value={c.lineHeight} onChange={(v) => up({ lineHeight: v })} />
            <Slider label={en ? 'Outline' : '描邊'} min={0} max={16} step={0.5} value={c.stroke} onChange={(v) => up({ stroke: v })} />
            {c.stroke > 0 && <label className="al-cut__rowmini">{en ? 'Outline color' : '描邊色'} <input type="color" value={c.strokeColor} onChange={(e) => up({ strokeColor: e.target.value })} /></label>}
            <Slider label={en ? 'Shadow' : '陰影'} min={0} max={1} step={0.05} value={c.shadow} onChange={(v) => up({ shadow: v })} />
            <Slider label={en ? 'Backdrop bar' : '字幕條'} min={0} max={1} step={0.05} value={c.box} onChange={(v) => up({ box: v })} />
            <label className="al-cut__rowmini"><input type="checkbox" checked={c.grad} onChange={(e) => up({ grad: e.target.checked })} /> {en ? 'Gradient fill' : '漸層填色'}</label>
            {c.grad && <label className="al-cut__rowmini">{en ? 'Gradient bottom' : '漸層下色'} <input type="color" value={c.gradColor} onChange={(e) => up({ gradColor: e.target.value })} /></label>}
          </>
        )}
      </div>
    </div>
  );
}
