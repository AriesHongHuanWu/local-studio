/* ──────────────────────────────────────────────────────────────────
   CatalogFlow — the Catalog "home": your songs as projects. A grid of
   project cards (key/BPM/genre + item count); open one to see its
   collected artifacts (beat / analysis / master / vocal) with reveal &
   drag-to-DAW. The connective tissue that makes the app "my songs".
   ────────────────────────────────────────────────────────────────── */

import { useState } from 'react';
import {
  FolderPlus, Music, Activity, Disc3, Mic2, FileText, ChevronLeft,
  FolderOpen, Move, Trash2, Disc,
} from 'lucide-react';
import { useProjects, type Project, type ProjectItemKind } from '../../state/useProjects';
import { hasTauri, revealPath, dragOutPath } from '../export/saveFile';
import { useLang } from '../../i18n';
import './catalog.css';

const KIND_ICON: Record<ProjectItemKind, typeof Music> = {
  beat: Music, analysis: Activity, master: Disc3, vocal: Mic2, note: FileText,
};

export function CatalogFlow() {
  const en = useLang() === 'en';
  const projects = useProjects((s) => s.projects);
  const create = useProjects((s) => s.create);
  const rename = useProjects((s) => s.rename);
  const remove = useProjects((s) => s.remove);
  const removeItem = useProjects((s) => s.removeItem);

  const [openId, setOpenId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const open = projects.find((p) => p.id === openId) ?? null;

  const fmtDate = (ts: number) => new Date(ts).toLocaleDateString();
  const headline = (p: Project) => [p.key, p.bpm ? `${p.bpm} BPM` : null, p.genre].filter(Boolean).join(' · ');

  const onDrag = (e: React.DragEvent, path?: string) => { if (path) { e.preventDefault(); void dragOutPath(path); } };

  // ── project detail ─────────────────────────────────────────────────
  if (open) {
    return (
      <div className="al-tabpage al-catalog">
        <button type="button" className="al-catalog__back" onClick={() => setOpenId(null)}>
          <ChevronLeft size={16} /> {en ? 'All projects' : '所有作品'}
        </button>
        <div className="al-catalog__dethead">
          <Disc size={20} className="al-catalog__deticon" />
          <input className="al-catalog__detname" defaultValue={open.name}
                 onBlur={(e) => rename(open.id, e.target.value)} />
          <button type="button" className="al-catalog__del" title={en ? 'Delete project' : '刪除作品'}
                  onClick={() => { remove(open.id); setOpenId(null); }}>
            <Trash2 size={15} />
          </button>
        </div>
        {headline(open) && <div className="al-catalog__dethl">{headline(open)}</div>}

        {open.items.length === 0 ? (
          <p className="al-catalog__empty">{en ? 'No items yet — add a beat, analysis or master from the other modes.' : '還沒有東西 —— 從下載器/母帶等模式按「加入作品集」收進來。'}</p>
        ) : (
          <ul className="al-catalog__items">
            {open.items.map((it) => {
              const Icon = KIND_ICON[it.kind] ?? FileText;
              return (
                <li key={it.id} className="al-catalog__item">
                  <span className={`al-catalog__itemicon al-catalog__itemicon--${it.kind}`}><Icon size={15} /></span>
                  <span className="al-catalog__itemtext">
                    <span className="al-catalog__itemlabel">{it.label}</span>
                    <span className="al-catalog__itemmeta">
                      {[it.key, it.bpm ? `${it.bpm} BPM` : null, it.genre, it.format?.toUpperCase()].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="al-catalog__itemactions">
                    {it.path && hasTauri() && (
                      <>
                        <button type="button" className="al-catalog__ibtn" draggable title={en ? 'Drag to DAW' : '拖到 DAW'}
                                onDragStart={(e) => onDrag(e, it.path)}><Move size={13} /></button>
                        <button type="button" className="al-catalog__ibtn" title={en ? 'Show in folder' : '在資料夾顯示'}
                                onClick={() => revealPath(it.path!)}><FolderOpen size={13} /></button>
                      </>
                    )}
                    <button type="button" className="al-catalog__ibtn" title={en ? 'Remove' : '移除'}
                            onClick={() => removeItem(open.id, it.id)}><Trash2 size={13} /></button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  // ── catalog grid ───────────────────────────────────────────────────
  return (
    <div className="al-tabpage al-catalog">
      <div className="al-tabpage__head">
        <h1 className="al-tabpage__title">{en ? 'Catalog — my songs' : '作品集 — 我的歌'}</h1>
        <p className="al-tabpage__lede">{en
          ? 'Each project gathers a song\'s beat, analysis, masters and processed vocals in one place.'
          : '每個作品把一首歌的 beat、分析、母帶、處理過的人聲收在一起。'}</p>
      </div>

      <div className="al-catalog__newrow">
        <input type="text" className="al-catalog__newinput"
               placeholder={en ? 'New project name…' : '新作品名稱…'}
               value={newName} maxLength={60}
               onChange={(e) => setNewName(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) { create(newName); setNewName(''); } }} />
        <button type="button" className="al-btn al-btn--primary al-catalog__newbtn"
                disabled={!newName.trim()} onClick={() => { create(newName); setNewName(''); }}>
          <FolderPlus size={15} /> {en ? 'New project' : '新增作品'}
        </button>
      </div>

      {projects.length === 0 ? (
        <p className="al-catalog__empty">{en
          ? 'No projects yet. Create one, then add beats/analyses/masters to it from the Downloader and Mastering.'
          : '還沒有作品。先新增一個,再從下載器、母帶等按「加入作品集」收東西進來。'}</p>
      ) : (
        <div className="al-catalog__grid">
          {projects.map((p) => (
            <button key={p.id} type="button" className="al-catalog__card" onClick={() => setOpenId(p.id)}>
              <span className="al-catalog__cardname"><Disc size={15} /> {p.name}</span>
              {headline(p) && <span className="al-catalog__cardhl">{headline(p)}</span>}
              <span className="al-catalog__cardmeta">
                {p.items.length} {en ? 'items' : '項'} · {fmtDate(p.updatedTs)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
