/* ──────────────────────────────────────────────────────────────────
   AddToProject — a small button + inline picker that drops an artifact
   (a downloaded beat, an analysis, a master…) into a Catalog project,
   creating a new one or adding to an existing. Used across the flows so
   each mode's output flows into "my songs".
   ────────────────────────────────────────────────────────────────── */

import { useState } from 'react';
import { FolderPlus, Check } from 'lucide-react';
import { useProjects, type ProjectItem } from '../../state/useProjects';
import { useLang } from '../../i18n';

interface Props {
  item: Omit<ProjectItem, 'id' | 'ts'>;
  defaultName?: string;
}

export function AddToProject({ item, defaultName }: Props) {
  const en = useLang() === 'en';
  const projects = useProjects((s) => s.projects);
  const create = useProjects((s) => s.create);
  const addItem = useProjects((s) => s.addItem);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName ?? '');
  const [done, setDone] = useState(false);

  const flash = () => { setDone(true); setOpen(false); setTimeout(() => setDone(false), 1800); };
  const addTo = (projectId: string) => { addItem(projectId, item); flash(); };
  const createAndAdd = () => {
    const p = create((name || defaultName || 'Untitled').trim());
    addItem(p.id, item);
    setName(defaultName ?? '');
    flash();
  };

  return (
    <div className="al-addproj">
      <button type="button" className="al-btn al-addproj__btn" onClick={() => setOpen((o) => !o)}>
        {done ? <Check size={14} /> : <FolderPlus size={14} />}
        {done ? (en ? 'Added' : '已加入') : (en ? 'Add to project' : '加入作品集')}
      </button>
      {open && (
        <div className="al-addproj__pop">
          <div className="al-addproj__new">
            <input
              type="text" placeholder={en ? 'New project name…' : '新作品名稱…'}
              value={name} maxLength={60} autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') createAndAdd(); }}
            />
            <button type="button" className="al-btn al-btn--primary" onClick={createAndAdd}>
              {en ? 'Create' : '新增'}
            </button>
          </div>
          {projects.length > 0 && (
            <div className="al-addproj__list">
              <div className="al-addproj__listlabel">{en ? 'or add to' : '或加入既有'}</div>
              {projects.slice(0, 12).map((p) => (
                <button key={p.id} type="button" className="al-addproj__item" onClick={() => addTo(p.id)}>
                  <span>{p.name}</span>
                  <small>{p.items.length}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
