/* ──────────────────────────────────────────────────────────────────
   LibraryPanel — the CapCut-style tabbed left library. A top tab bar
   switches the panel between 媒體 (media import, drag to timeline),
   文字 (title styles), 濾鏡 (looks), 特效 (effects) and 轉場
   (transitions). The library tabs apply to the selected clip; the
   right Inspector keeps the fine per-clip controls.
   ────────────────────────────────────────────────────────────────── */

import { useState } from 'react';
import { Film, Type, Sparkles, Shuffle, Aperture } from 'lucide-react';
import { useEditor, makeClip } from './useEditor';
import { AssetBin } from './AssetBin';
import { LOOKS, TRANSITIONS, TEXT_PRESETS } from './effects';
import type { Clip } from './types';

interface Props { en: boolean; getTime: () => number; }
type LibTab = 'media' | 'text' | 'filter' | 'fx' | 'trans';

const FX: { key: string; zh: string; en: string; patch: Partial<Clip> }[] = [
  { key: 'none', zh: '清除', en: 'Clear', patch: { glitch: 0, scan: 0, shake: { mode: 'none', amount: 0.3, speed: 1 } } },
  { key: 'glitch', zh: '故障', en: 'Glitch', patch: { glitch: 0.55 } },
  { key: 'scan', zh: '掃描線', en: 'Scanlines', patch: { scan: 0.5 } },
  { key: 'handheld', zh: '手持晃動', en: 'Handheld', patch: { shake: { mode: 'handheld', amount: 0.45, speed: 1.3 } } },
  { key: 'quake', zh: '地震', en: 'Earthquake', patch: { shake: { mode: 'earthquake', amount: 0.5, speed: 1.5 } } },
  { key: 'bounce', zh: '彈跳', en: 'Bounce', patch: { shake: { mode: 'bounce', amount: 0.5, speed: 1.2 } } },
];

export function LibraryPanel({ en, getTime }: Props) {
  const [tab, setTab] = useState<LibTab>('media');
  const doc = useEditor((s) => s.doc);
  const selectedId = useEditor((s) => s.selectedId);

  let sel: Clip | null = null; let selKind = '';
  for (const tr of doc.tracks) { const c = tr.clips.find((x) => x.id === selectedId); if (c) { sel = c; selKind = c.kind; break; } }
  const isMediaSel = selKind === 'video' || selKind === 'image';

  const applyFilters = (f: Partial<Clip['filters']>) => { if (sel && isMediaSel) useEditor.getState().updateFilters(sel.id, f); };
  const applyClip = (patch: Partial<Clip>) => { if (sel) useEditor.getState().updateClip(sel.id, patch); };
  const applyTrans = (type: string) => { if (sel) { const st = useEditor.getState(); st.setTransition(sel.id, 'transIn', { type: type as Clip['transIn']['type'], dur: 0.6 }); st.setTransition(sel.id, 'transOut', { type: type as Clip['transOut']['type'], dur: 0.6 }); } };

  const addStyledText = (over: Partial<Clip>) => {
    const st = useEditor.getState();
    let t = st.doc.tracks.find((x) => x.kind === 'text');
    if (!t) { st.addTrack('text'); t = useEditor.getState().doc.tracks.find((x) => x.kind === 'text'); }
    if (!t) return;
    const clip = makeClip('text', { ...over, text: en ? 'Title' : '標題', start: Math.max(0, getTime()) });
    st.addClip(t.id, clip);
    st.select(clip.id);
  };

  const TABS: { key: LibTab; icon: typeof Film; zh: string; en: string }[] = [
    { key: 'media', icon: Film, zh: '媒體', en: 'Media' },
    { key: 'text', icon: Type, zh: '文字', en: 'Text' },
    { key: 'filter', icon: Aperture, zh: '濾鏡', en: 'Filters' },
    { key: 'fx', icon: Sparkles, zh: '特效', en: 'Effects' },
    { key: 'trans', icon: Shuffle, zh: '轉場', en: 'Transitions' },
  ];


  return (
    <div className="al-cut__lib">
      <div className="al-cut__libtabs">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.key} type="button" className={`al-cut__libtab${tab === t.key ? ' is-on' : ''}`} onClick={() => setTab(t.key)}>
              <Icon size={16} /><span>{en ? t.en : t.zh}</span>
            </button>
          );
        })}
      </div>

      <div className="al-cut__libbody">
        {tab === 'media' && <AssetBin en={en} getTime={getTime} />}

        {tab === 'text' && (
          <>
            <div className="al-cut__libsub">{en ? 'Title styles' : '文字樣式'}</div>
            <div className="al-cut__libgrid">
              {TEXT_PRESETS.map((p) => (
                <button key={p.key} type="button" className="al-cut__libcard" onClick={() => addStyledText(p.over)}>
                  <span className="al-cut__libcardtxt" style={{ color: p.over.color as string, textShadow: p.over.stroke ? '0 0 1px #000' : 'none' }}>Aa</span>
                  <span className="al-cut__libcardlbl">{en ? p.en : p.label}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {tab === 'filter' && (
          <>
            <p className="al-cut__libhint">{en ? 'Drag onto a clip, or select a clip and click.' : '拖到片段上,或選片段後點擊。'}</p>
            <div className="al-cut__libgrid">
              {LOOKS.map((l) => (
                <button key={l.key} type="button" className="al-cut__libcard" draggable
                  onDragStart={(e) => { e.dataTransfer.setData('application/al-fx', JSON.stringify({ kind: 'filter', f: l.f })); e.dataTransfer.effectAllowed = 'copy'; }}
                  onClick={() => applyFilters(l.f)}>
                  <span className="al-cut__libcardsw" data-look={l.key} />
                  <span className="al-cut__libcardlbl">{en ? l.en : l.label}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {tab === 'fx' && (
          <>
            <p className="al-cut__libhint">{en ? 'Drag onto a clip, or select a clip and click.' : '拖到片段上,或選片段後點擊。'}</p>
            <div className="al-cut__libgrid">
              {FX.map((f) => (
                <button key={f.key} type="button" className="al-cut__libcard" draggable
                  onDragStart={(e) => { e.dataTransfer.setData('application/al-fx', JSON.stringify({ kind: 'fx', patch: f.patch })); e.dataTransfer.effectAllowed = 'copy'; }}
                  onClick={() => applyClip(f.patch)}>
                  <Sparkles size={18} />
                  <span className="al-cut__libcardlbl">{en ? f.en : f.zh}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {tab === 'trans' && (
          <>
            <p className="al-cut__libhint">{en ? 'Drag onto a clip, or select a clip and click.' : '拖到片段上,或選片段後點擊。'}</p>
            <div className="al-cut__libgrid">
              {TRANSITIONS.filter((t) => t.key !== 'none').map((t) => (
                <button key={t.key} type="button" className="al-cut__libcard" draggable
                  onDragStart={(e) => { e.dataTransfer.setData('application/al-fx', JSON.stringify({ kind: 'trans', type: t.key })); e.dataTransfer.effectAllowed = 'copy'; }}
                  onClick={() => applyTrans(t.key)}>
                  <Shuffle size={18} />
                  <span className="al-cut__libcardlbl">{en ? t.en : t.label}</span>
                </button>
              ))}
              <button type="button" className="al-cut__libcard" disabled={!sel} onClick={() => applyTrans('none')}>
                <span className="al-cut__libcardlbl">{en ? 'None' : '無'}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
